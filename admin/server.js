/**
 * Balkan Medical Journal — Admin Panel Server
 * Usage: cd admin && npm install && node server.js
 */

const express = require('express');
const multer = require('multer');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const dio = require('./lib/data-io');
const { createBackup, listBackups, zipBackup } = require('./lib/backup');
const { parseJatsXml } = require('./lib/jats-parser');
const zipImporter = require('./lib/zip-importer');
const pageTpl = require('./lib/page-template');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
// Trust the first proxy (Cloudflare Tunnel / nginx) so req.secure + rate-limit IPs work.
app.set('trust proxy', 1);

// --- Auth config ---
const AUTH_CONFIG_PATH = path.join(__dirname, 'auth-config.json');
function loadAuthConfig() {
  if (!fs.existsSync(AUTH_CONFIG_PATH)) {
    console.error('[fatal] auth-config.json not found. Run the setup command to create it.');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(AUTH_CONFIG_PATH, 'utf-8'));
  if (!cfg.passwordHash || !cfg.sessionSecret || cfg.sessionSecret === 'change-me') {
    console.error('[fatal] auth-config.json is missing passwordHash or has a default sessionSecret. Regenerate it.');
    process.exit(1);
  }
  return cfg;
}
const authConfig = loadAuthConfig();

app.use(express.json({ limit: '50mb' }));

// --- Session ---
app.use(cookieSession({
  name: 'bmj_session',
  secret: authConfig.sessionSecret,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  httpOnly: true,
  sameSite: 'strict',
  secure: IS_PROD,
}));

// --- Rate limit login to blunt brute-force attempts ---
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.' },
});

// --- Auth endpoints (before auth middleware) ---
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });

  if (username !== authConfig.username) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
  }

  if (!bcrypt.compareSync(password, authConfig.passwordHash)) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
  }

  req.session.user = username;
  res.json({ ok: true, user: username });
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (req.session?.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

app.post('/api/auth/change-password', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Mevcut ve yeni şifre gerekli' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı' });

  if (!bcrypt.compareSync(currentPassword, authConfig.passwordHash)) {
    return res.status(401).json({ error: 'Mevcut şifre hatalı' });
  }

  authConfig.passwordHash = bcrypt.hashSync(newPassword, 10);
  fs.writeFileSync(AUTH_CONFIG_PATH, JSON.stringify(authConfig, null, 2), 'utf-8');
  res.json({ ok: true });
});

// --- Serve login page (before auth middleware) ---
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Test-only auth bypass. Active only when BMJ_TEST_BYPASS_AUTH=1 is set in the
// environment. Used by the headless browser test harness so it doesn't need the
// real admin password. Refuses to activate when NODE_ENV=production.
const TEST_BYPASS_AUTH = process.env.BMJ_TEST_BYPASS_AUTH === '1' && !IS_PROD;
if (TEST_BYPASS_AUTH) {
  console.warn('[bypass] BMJ_TEST_BYPASS_AUTH is set — all requests are auto-authenticated as "test"');
}

// --- Auth middleware ---
function requireAuth(req, res, next) {
  // Test bypass — populate a fake session so downstream code that checks
  // req.session.user keeps working.
  if (TEST_BYPASS_AUTH) {
    req.session = req.session || {};
    req.session.user = req.session.user || 'test';
    return next();
  }
  // Allow login page and its assets
  if (req.path === '/login' || req.path === '/login.html' || req.path.startsWith('/api/auth/')) {
    return next();
  }
  // Check session
  if (req.session?.user) {
    return next();
  }
  // Redirect HTML requests to login, reject API requests
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Oturum süresi doldu. Lütfen tekrar giriş yapın.' });
  }
  res.redirect('/login');
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));
// Mount the main site read-only under /site/ so the admin can preview articles
// (article.html, js/data/**, images/**, css/**) without leaving the authed panel.
app.use('/site', express.static(dio.ROOT));
// Also expose /images and /js/data/supplementary directly so the contenteditable
// full-text editor can resolve <img src="images/articles/..."> previews against
// the main site (matching what the saved HTML will see on the public site).
app.use('/images', express.static(path.join(dio.ROOT, 'images')));
app.use('/js/data/supplementary', express.static(path.join(dio.ROOT, 'js/data/supplementary')));

// File upload setup
const ALLOWED_MIME = {
  pdf: new Set(['application/pdf']),
  image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']),
  xml: new Set(['application/xml', 'text/xml']),
  zip: new Set(['application/zip', 'application/x-zip-compressed', 'application/octet-stream']),
  // figures = images + pdf; supplementary = broadly allowed (video/audio/doc/csv/zip)
  figure: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/tiff', 'application/pdf']),
  supplementary: new Set([
    'application/pdf', 'application/zip', 'application/x-zip-compressed',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/ogg',
    'text/csv', 'text/plain',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
  docx: new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
  ]),
};
const ALLOWED_EXT = {
  pdf: /\.pdf$/i,
  image: /\.(jpe?g|png|webp|gif|svg)$/i,
  xml: /\.xml$/i,
  zip: /\.zip$/i,
  figure: /\.(jpe?g|png|webp|gif|svg|tiff?|pdf)$/i,
  supplementary: /\.(pdf|zip|jpe?g|png|webp|gif|svg|mp4|mov|webm|mp3|wav|ogg|csv|txt|docx?|xlsx?)$/i,
  docx: /\.docx$/i,
};
function makeUploader(kind) {
  return multer({
    dest: path.join(__dirname, 'uploads'),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
      const mimeOk = ALLOWED_MIME[kind] && ALLOWED_MIME[kind].has(file.mimetype);
      const extOk = ALLOWED_EXT[kind] && ALLOWED_EXT[kind].test(file.originalname || '');
      if (mimeOk && extOk) return cb(null, true);
      cb(new Error(`Desteklenmeyen dosya türü: ${file.originalname} (${file.mimetype})`));
    },
  });
}
const uploadPdf = makeUploader('pdf');
const uploadImage = makeUploader('image');
const uploadXml = makeUploader('xml');
const uploadZip = makeUploader('zip');
const uploadFigure = makeUploader('figure');
const uploadSupp = makeUploader('supplementary');
const uploadDocx = makeUploader('docx');

// ===========================================================================
//  UTILITY
// ===========================================================================

app.get('/api/stats', (_req, res) => {
  try {
    const articles = dio.readArticles();
    const aip = dio.readArticlesInPress();
    const archive = dio.readArchiveIssues();
    const news = dio.readNews();

    const typeCounts = {};
    for (const a of articles) {
      typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
    }

    const totalIssues = archive.reduce((s, y) => s + y.issues.length, 0);

    res.json({
      articleCount: articles.length,
      articlesInPressCount: aip.length,
      issueCount: totalIssues,
      newsCount: news.length,
      typeCounts,
      yearRange: archive.length
        ? { from: archive[archive.length - 1].year, to: archive[0].year }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Top articles by views/downloads
app.get('/api/stats/top-articles', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const articles = dio.readArticles();

    const topViewed = [...articles]
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, limit)
      .map((a) => ({ id: a.id, title: a.title, type: a.type, doi: a.doi, volume: a.volume, issue: a.issue, views: a.views || 0, downloads: a.downloads || 0, citations: a.citations || 0 }));

    const topDownloaded = [...articles]
      .sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
      .slice(0, limit)
      .map((a) => ({ id: a.id, title: a.title, type: a.type, doi: a.doi, volume: a.volume, issue: a.issue, views: a.views || 0, downloads: a.downloads || 0, citations: a.citations || 0 }));

    const topCited = [...articles]
      .sort((a, b) => (b.citations || 0) - (a.citations || 0))
      .slice(0, limit)
      .map((a) => ({ id: a.id, title: a.title, type: a.type, doi: a.doi, volume: a.volume, issue: a.issue, views: a.views || 0, downloads: a.downloads || 0, citations: a.citations || 0 }));

    const totalViews = articles.reduce((s, a) => s + (a.views || 0), 0);
    const totalDownloads = articles.reduce((s, a) => s + (a.downloads || 0), 0);
    const totalCitations = articles.reduce((s, a) => s + (a.citations || 0), 0);

    res.json({ topViewed, topDownloaded, topCited, totals: { views: totalViews, downloads: totalDownloads, citations: totalCitations, articles: articles.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update article metrics (views/downloads/citations)
app.put('/api/articles/:id/metrics', (req, res) => {
  try {
    const articles = dio.readArticles();
    const idx = articles.findIndex((a) => a.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Article not found' });

    const { views, downloads, citations } = req.body;
    if (views != null) articles[idx].views = Math.max(0, parseInt(views) || 0);
    if (downloads != null) articles[idx].downloads = Math.max(0, parseInt(downloads) || 0);
    if (citations != null) articles[idx].citations = Math.max(0, parseInt(citations) || 0);

    dio.writeArticles(articles);
    res.json({ id: articles[idx].id, views: articles[idx].views, downloads: articles[idx].downloads, citations: articles[idx].citations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup', (_req, res) => {
  try {
    const result = createBackup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backups', (_req, res) => {
  res.json(listBackups());
});

// Download a stored backup as a ZIP archive (includes a README.txt manifest
// describing exactly what the archive contains and what is out of scope).
app.get('/api/backups/:name/download', (req, res) => {
  try {
    const { buffer, filename } = zipBackup(req.params.name);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ===========================================================================
//  ARTICLES
// ===========================================================================

app.get('/api/articles', (req, res) => {
  try {
    let articles = dio.readArticles();
    const { type, volume, issue, search, page = 1, limit = 50 } = req.query;

    if (type) articles = articles.filter((a) => a.type === type);
    if (volume) articles = articles.filter((a) => a.volume === Number(volume));
    if (issue) articles = articles.filter((a) => String(a.issue) === String(issue));
    if (search) {
      const q = search.toLowerCase();
      articles = articles.filter(
        (a) =>
          (a.title || '').toLowerCase().includes(q) ||
          (a.doi || '').toLowerCase().includes(q) ||
          (a.authors || []).some((au) => (au.name || '').toLowerCase().includes(q))
      );
    }

    const total = articles.length;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(200, Math.max(1, parseInt(limit)));
    const paged = articles.slice((p - 1) * l, p * l);

    res.json({ total, page: p, limit: l, articles: paged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/articles/:id', (req, res) => {
  try {
    const articles = dio.readArticles();
    const article = articles.find((a) => a.id === Number(req.params.id));
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(article);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/articles', (req, res) => {
  try {
    createBackup();
    const articles = dio.readArticles();
    const newArticle = {
      id: dio.nextArticleId(articles),
      type: '',
      title: '',
      authors: [],
      abstract: '',
      abstractHtml: '',
      previewText: '',
      keywords: [],
      doi: '',
      received: '',
      accepted: '',
      published: '',
      volume: null,
      issue: '',
      pages: '',
      views: 0,
      downloads: 0,
      citations: 0,
      featured: false,
      imageCorner: false,
      hasFullText: false,
      sourceIssueId: '',
      sourceArticleId: '',
      sourceAbstractUrl: '',
      sourceTextUrl: '',
      sourcePdfUrl: '',
      localPdfUrl: '',
      pdfUrl: '',
      pmid: '',
      relatedArticles: [],
      ...req.body,
    };
    newArticle.id = newArticle.id || dio.nextArticleId(articles);
    articles.unshift(newArticle);
    dio.writeArticles(articles);

    if (newArticle.volume && newArticle.issue) {
      dio.rebuildVolumeJson(newArticle.volume, newArticle.issue, articles);
    }

    res.status(201).json(newArticle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/articles/:id', (req, res) => {
  try {
    createBackup();
    const articles = dio.readArticles();
    const idx = articles.findIndex((a) => a.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Article not found' });

    const old = articles[idx];
    articles[idx] = { ...old, ...req.body, id: old.id };
    dio.writeArticles(articles);

    // Rebuild volume JSON if issue changed
    const updated = articles[idx];
    if (updated.volume && updated.issue) {
      dio.rebuildVolumeJson(updated.volume, updated.issue, articles);
    }
    if (old.volume && old.issue && (old.volume !== updated.volume || old.issue !== updated.issue)) {
      dio.rebuildVolumeJson(old.volume, old.issue, articles);
    }

    res.json(articles[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move articles to a different issue
app.post('/api/articles/move', (req, res) => {
  try {
    const { articleIds, targetVolume, targetIssue } = req.body;
    if (!Array.isArray(articleIds) || !articleIds.length) return res.status(400).json({ error: 'articleIds gerekli' });
    if (targetVolume == null || !targetIssue) return res.status(400).json({ error: 'Hedef cilt ve sayı gerekli' });

    createBackup();
    const articles = dio.readArticles();
    const vol = Number(targetVolume);
    const iss = String(targetIssue);
    const rebuildSet = new Set();
    let moved = 0;

    for (const id of articleIds) {
      const idx = articles.findIndex((a) => a.id === Number(id));
      if (idx === -1) continue;
      const old = articles[idx];
      if (old.volume && old.issue) rebuildSet.add(`${old.volume}|${old.issue}`);
      articles[idx].volume = vol;
      articles[idx].issue = iss;
      moved++;
    }

    rebuildSet.add(`${vol}|${iss}`);
    dio.writeArticles(articles);
    for (const key of rebuildSet) {
      const [v, i] = key.split('|');
      dio.rebuildVolumeJson(Number(v), i, articles);
    }

    res.json({ moved, targetVolume: vol, targetIssue: iss });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/articles/:id', (req, res) => {
  try {
    createBackup();
    const articles = dio.readArticles();
    const idx = articles.findIndex((a) => a.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Article not found' });

    const removed = articles.splice(idx, 1)[0];
    dio.writeArticles(articles);

    if (removed.volume && removed.issue) {
      dio.rebuildVolumeJson(removed.volume, removed.issue, articles);
    }

    res.json({ deleted: true, id: removed.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Article full text ---

app.get('/api/articles/:id/fulltext', (req, res) => {
  try {
    const html = dio.readFullText(Number(req.params.id));
    res.json({ id: Number(req.params.id), html: html || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/articles/:id/fulltext', (req, res) => {
  try {
    createBackup();
    const id = Number(req.params.id);
    dio.writeFullText(id, req.body.html || '');

    // Mark hasFullText on whichever list contains this id (main articles or in-press)
    const articles = dio.readArticles();
    const idx = articles.findIndex((a) => a.id === id);
    if (idx !== -1) {
      if (!articles[idx].hasFullText) {
        articles[idx].hasFullText = true;
        dio.writeArticles(articles);
      }
    } else {
      const aip = dio.readArticlesInPress();
      const aipIdx = aip.findIndex((a) => a.id === id);
      if (aipIdx !== -1 && !aip[aipIdx].hasFullText) {
        aip[aipIdx].hasFullText = true;
        dio.writeArticlesInPress(aip);
      }
    }

    res.json({ id, saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Article links (erratum/retraction) ---

app.post('/api/articles/:id/link', (req, res) => {
  try {
    createBackup();
    const articles = dio.readArticles();
    const id = Number(req.params.id);
    const sourceIdx = articles.findIndex((a) => a.id === id);
    if (sourceIdx === -1) return res.status(404).json({ error: 'Source article not found' });

    const { type, targetId, targetDoi, targetPmid, label } = req.body;
    if (!type || !targetId) return res.status(400).json({ error: 'type and targetId required' });

    const targetIdx = articles.findIndex((a) => a.id === Number(targetId));
    if (targetIdx === -1) return res.status(404).json({ error: 'Target article not found' });

    // Add forward link
    if (!articles[sourceIdx].relatedArticles) articles[sourceIdx].relatedArticles = [];
    articles[sourceIdx].relatedArticles.push({
      type,
      targetId: Number(targetId),
      targetDoi: targetDoi || articles[targetIdx].doi || '',
      targetPmid: targetPmid || '',
      label: label || articles[targetIdx].title || '',
    });

    // Add reverse link
    const reverseMap = {
      'erratum-for': 'has-erratum',
      'has-erratum': 'erratum-for',
      'retraction-of': 'is-retracted',
      'is-retracted': 'retraction-of',
      'reply-to': 'has-reply',
      'has-reply': 'reply-to',
      'comment-on': 'has-comment',
      'has-comment': 'comment-on',
      'related-to': 'related-to',
    };

    if (!articles[targetIdx].relatedArticles) articles[targetIdx].relatedArticles = [];
    const reverseType = reverseMap[type] || 'related-to';
    const alreadyLinked = articles[targetIdx].relatedArticles.some(
      (r) => r.targetId === id && r.type === reverseType
    );
    if (!alreadyLinked) {
      articles[targetIdx].relatedArticles.push({
        type: reverseType,
        targetId: id,
        targetDoi: articles[sourceIdx].doi || '',
        targetPmid: '',
        label: articles[sourceIdx].title || '',
      });
    }

    dio.writeArticles(articles);
    res.json({ source: articles[sourceIdx], target: articles[targetIdx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/articles/:id/link/:targetId', (req, res) => {
  try {
    createBackup();
    const articles = dio.readArticles();
    const id = Number(req.params.id);
    const targetId = Number(req.params.targetId);

    const sourceIdx = articles.findIndex((a) => a.id === id);
    const targetIdx = articles.findIndex((a) => a.id === targetId);

    if (sourceIdx !== -1 && articles[sourceIdx].relatedArticles) {
      articles[sourceIdx].relatedArticles = articles[sourceIdx].relatedArticles.filter(
        (r) => r.targetId !== targetId
      );
    }
    if (targetIdx !== -1 && articles[targetIdx].relatedArticles) {
      articles[targetIdx].relatedArticles = articles[targetIdx].relatedArticles.filter(
        (r) => r.targetId !== id
      );
    }

    dio.writeArticles(articles);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  ARTICLES IN PRESS
// ===========================================================================

app.get('/api/articles-in-press', (_req, res) => {
  try {
    res.json(dio.readArticlesInPress());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/articles-in-press/:id', (req, res) => {
  try {
    const aip = dio.readArticlesInPress();
    const art = aip.find((a) => a.id === Number(req.params.id));
    if (!art) return res.status(404).json({ error: 'Not found' });
    res.json(art);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/articles-in-press', (req, res) => {
  try {
    createBackup();
    const aip = dio.readArticlesInPress();

    // Required-field validation. Earlier the endpoint accepted records with
    // empty title or type silently; those records showed up as blank rows in
    // both the admin list and the public page, with no way to tell what was
    // wrong without diving into the JSON.
    const title = String(req.body?.title || '').trim();
    const type = String(req.body?.type || '').trim();
    if (!title) return res.status(400).json({ error: 'Başlık zorunludur' });
    if (!type) return res.status(400).json({ error: 'Makale türü zorunludur' });

    // DOI uniqueness check across BOTH lists. JATS import path already does
    // this but the manual endpoint did not — leading to duplicate DOIs when
    // a paper was added by hand after the AIP version was imported earlier.
    const doi = String(req.body?.doi || '').trim();
    if (doi) {
      const dupAip = aip.find((a) => String(a.doi || '').trim().toLowerCase() === doi.toLowerCase());
      if (dupAip) return res.status(409).json({ error: `Bu DOI baskıda makalede zaten kayıtlı (#${dupAip.id})` });
      const mainArticles = dio.readArticles();
      const dupMain = mainArticles.find((a) => String(a.doi || '').trim().toLowerCase() === doi.toLowerCase());
      if (dupMain) return res.status(409).json({ error: `Bu DOI yayınlanmış makalede zaten kayıtlı (#${dupMain.id})` });
    }

    const newId = dio.nextArticleId();
    // Wipe any orphan files for this ID before creating the record. Without
    // this, manual AIP creation can inherit leftover figures / PDF / full
    // text from a previously-deleted article that lived at the same ID —
    // the user sees Tam Metin and Dosyalar mysteriously pre-populated.
    const wiped = zipImporter.cleanArticleAssets(newId, { wipePdf: true, wipeFullText: true });
    const newArt = {
      id: newId,
      order: aip.length + 1,
      aheadOfPrint: true,
      volume: null,
      issue: '',
      pages: '',
      published: '',
      ...req.body,
      title,
      type,
      doi,
    };
    aip.push(newArt);
    dio.writeArticlesInPress(aip);
    // Include cleanup report so the front-end can show a notice if any
    // leftover files were found and removed (helps diagnose mysteries).
    res.status(201).json({ ...newArt, _cleanedOrphans: wiped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/articles-in-press/:id', (req, res) => {
  try {
    createBackup();
    const aip = dio.readArticlesInPress();
    const id = Number(req.params.id);
    const idx = aip.findIndex((a) => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    // Validate the same fields that POST does, but only for the keys actually
    // present in the request body — partial updates remain supported.
    if (Object.prototype.hasOwnProperty.call(req.body, 'title')) {
      const title = String(req.body.title || '').trim();
      if (!title) return res.status(400).json({ error: 'Başlık boş olamaz' });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'type')) {
      const type = String(req.body.type || '').trim();
      if (!type) return res.status(400).json({ error: 'Makale türü boş olamaz' });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'doi')) {
      const doi = String(req.body.doi || '').trim();
      if (doi) {
        const lowerDoi = doi.toLowerCase();
        const dupAip = aip.find((a) => a.id !== id && String(a.doi || '').trim().toLowerCase() === lowerDoi);
        if (dupAip) return res.status(409).json({ error: `Bu DOI baskıda makalede zaten kayıtlı (#${dupAip.id})` });
        const mainArticles = dio.readArticles();
        const dupMain = mainArticles.find((a) => String(a.doi || '').trim().toLowerCase() === lowerDoi);
        if (dupMain) return res.status(409).json({ error: `Bu DOI yayınlanmış makalede zaten kayıtlı (#${dupMain.id})` });
      }
    }

    aip[idx] = { ...aip[idx], ...req.body, id: aip[idx].id };
    dio.writeArticlesInPress(aip);
    res.json(aip[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder the AIP array by providing a full ordered list of IDs.
// Any IDs not in the provided list are appended at the end (no silent drops).
app.post('/api/articles-in-press/reorder', (req, res) => {
  try {
    createBackup();
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
    const aip = dio.readArticlesInPress();
    const indexed = {};
    aip.forEach((a) => { indexed[a.id] = a; });
    const reordered = ids.map((id) => indexed[id]).filter(Boolean);
    // Append any articles missing from the provided ids list (defensive)
    const idSet = new Set(ids);
    aip.forEach((a) => { if (!idSet.has(a.id)) reordered.push(a); });
    dio.writeArticlesInPress(reordered);
    res.json({ ok: true, count: reordered.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/articles-in-press/:id', (req, res) => {
  try {
    createBackup();
    const aip = dio.readArticlesInPress();
    const id = Number(req.params.id);
    const idx = aip.findIndex((a) => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    aip.splice(idx, 1);
    dio.writeArticlesInPress(aip);
    // Also remove on-disk artefacts so the next ID re-use doesn't inherit
    // figures / PDF / full text. Without this, deleting AIP #2867 leaves
    // js/data/articles/2867.html + images/articles/2867/ + the PDF behind,
    // and they get auto-loaded when a brand-new AIP gets ID 2867 next.
    const wiped = zipImporter.cleanArticleAssets(id, { wipePdf: true, wipeFullText: true });
    res.json({ deleted: true, _cleanedOrphans: wiped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Publish: move from in-press to articles
app.post('/api/articles-in-press/:id/publish', (req, res) => {
  try {
    createBackup();
    const aip = dio.readArticlesInPress();
    const idx = aip.findIndex((a) => a.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const { volume, issue, pages, published } = req.body;
    if (!volume || !issue) return res.status(400).json({ error: 'volume and issue required' });

    const article = { ...aip[idx], volume: Number(volume), issue: String(issue), pages: pages || '', published: published || new Date().toISOString().slice(0, 10), aheadOfPrint: false };
    aip.splice(idx, 1);
    dio.writeArticlesInPress(aip);

    const articles = dio.readArticles();
    articles.unshift(article);
    dio.writeArticles(articles);
    dio.rebuildVolumeJson(article.volume, article.issue, articles);

    res.json(article);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extract AIP metadata from a Galenos-template Word submission. Returns
// parsed fields (type, doi, title, authors[], abstract, keywords, dates,
// correspondingEmail, warnings[]) for the admin client to pre-fill the
// "Yeni Baskıda Makale" form. The file lands in /uploads but is removed
// right after parsing — we only need the extracted metadata.
const docxParser = require('./lib/docx-parser');
app.post('/api/articles-in-press/parse-docx', uploadDocx.single('file'), (req, res) => {
  const tmpPath = req.file?.path;
  try {
    if (!tmpPath) return res.status(400).json({ error: 'Dosya yüklenmedi' });
    const buffer = fs.readFileSync(tmpPath);
    const meta = docxParser.parseAipDocx(buffer);
    res.json(meta);
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch { /* ignore */ } }
  }
});

// ===========================================================================
//  ISSUES / ARCHIVE
// ===========================================================================

app.get('/api/issues', (_req, res) => {
  try {
    res.json(dio.readArchiveIssues());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/issues', (req, res) => {
  try {
    createBackup();
    const { year, volume, issue, label } = req.body;
    if (!year || !volume || !issue) return res.status(400).json({ error: 'year, volume, issue required' });

    const archive = dio.readArchiveIssues();
    let yearGroup = archive.find((y) => y.year === String(year));
    if (!yearGroup) {
      yearGroup = { year: String(year), volume: Number(volume), issues: [] };
      archive.unshift(yearGroup);
      archive.sort((a, b) => Number(b.year) - Number(a.year));
    }

    const exists = yearGroup.issues.some((i) => String(i.issue) === String(issue));
    if (exists) return res.status(409).json({ error: 'Issue already exists' });

    const newIssue = {
      label: label || `Volume ${volume}, Issue ${issue}`,
      sourceId: '',
      sourceUrl: '',
      volume: Number(volume),
      issue: String(issue),
      articleCount: 0,
      hasLocalData: true,
    };
    yearGroup.issues.unshift(newIssue);
    dio.writeArchiveIssues(archive);

    // Create empty volume JSON
    dio.writeVolumeJson(volume, issue, []);

    res.status(201).json(newIssue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/issues/:volume/:issue/rebuild', (req, res) => {
  try {
    const { volume, issue } = req.params;
    const count = dio.rebuildVolumeJson(volume, issue);

    // Update article count in archive
    const archive = dio.readArchiveIssues();
    for (const y of archive) {
      const iss = y.issues.find((i) => i.volume === Number(volume) && String(i.issue) === String(issue));
      if (iss) {
        iss.articleCount = count;
        iss.hasLocalData = true;
        break;
      }
    }
    dio.writeArchiveIssues(archive);

    res.json({ volume: Number(volume), issue, articleCount: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/issues/:volume/:issue/articles', (req, res) => {
  try {
    const { volume, issue } = req.params;
    const articles = dio.readArticles().filter(
      (a) => a.volume === Number(volume) && String(a.issue) === String(issue)
    );
    articles.sort((a, b) => {
      const pa = parseInt(a.pages) || 9999;
      const pb = parseInt(b.pages) || 9999;
      return pa - pb;
    });
    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/issues/:volume/:issue/set-current', (req, res) => {
  try {
    createBackup();
    const { volume, issue } = req.params;
    const vol = Number(volume);
    const articles = dio.readArticles().filter(
      (a) => a.volume === vol && String(a.issue) === String(issue)
    );

    // Find year from archive
    const archive = dio.readArchiveIssues();
    let year = '';
    for (const y of archive) {
      const iss = y.issues.find((i) => i.volume === vol && String(i.issue) === String(issue));
      if (iss) { year = y.year; break; }
    }

    // Build homepage data
    const featured = articles.filter((a) => a.featured);
    const imageCorner = articles.filter((a) => a.imageCorner);
    const mostCited = [...articles].sort((a, b) => (b.citations || 0) - (a.citations || 0)).slice(0, 5);

    const mapArticle = (a) => ({
      id: a.id, type: a.type, title: a.title,
      authors: (a.authors || []).map((au) => ({ name: au.name })),
      doi: a.doi, volume: a.volume, issue: a.issue,
      pages: a.pages, published: a.published,
      previewText: a.previewText || '',
      imageUrl: a.imageUrl || '',
    });

    const homepageData = {
      generatedAt: new Date().toISOString().slice(0, 10),
      currentIssue: { volume: vol, issue: String(issue), year },
      featuredArticles: featured.map(mapArticle),
      imageCornerArticles: imageCorner.map(mapArticle),
      mostCitedArticles: mostCited.map(mapArticle),
      latestArticles: articles.slice(0, 10).map(mapArticle),
    };

    dio.writeHomepageData(homepageData);
    res.json({ updated: true, articleCount: articles.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/issues/:year/:volume/:issue', (req, res) => {
  try {
    createBackup();
    const archive = dio.readArchiveIssues();
    const yearGroup = archive.find((y) => y.year === String(req.params.year));
    if (!yearGroup) return res.status(404).json({ error: 'Year not found' });

    const idx = yearGroup.issues.findIndex(
      (i) => i.volume === Number(req.params.volume) && String(i.issue) === String(req.params.issue)
    );
    if (idx === -1) return res.status(404).json({ error: 'Issue not found' });

    yearGroup.issues.splice(idx, 1);
    if (!yearGroup.issues.length) {
      archive.splice(archive.indexOf(yearGroup), 1);
    }
    dio.writeArchiveIssues(archive);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  EDITORIAL BOARD
// ===========================================================================

app.get('/api/editorial', (_req, res) => {
  try {
    res.json(dio.readEditorialBoard());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/editorial', (req, res) => {
  try {
    createBackup();
    dio.writeEditorialBoard(req.body);
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/editorial/extended', (_req, res) => {
  try {
    res.json(dio.readEditorialExtended());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/editorial/extended', (req, res) => {
  try {
    createBackup();
    dio.writeEditorialExtended(req.body);
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  NEWS
// ===========================================================================

app.get('/api/news', (_req, res) => {
  try {
    res.json(dio.readNews());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/news/:id', (req, res) => {
  try {
    const news = dio.readNews();
    const item = news.find((n) => n.id === Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/news', (req, res) => {
  try {
    createBackup();
    const news = dio.readNews();
    const item = { id: dio.nextNewsId(), featured: false, ...req.body };
    news.unshift(item);
    dio.writeNews(news);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/news/:id', (req, res) => {
  try {
    createBackup();
    const news = dio.readNews();
    const idx = news.findIndex((n) => n.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    news[idx] = { ...news[idx], ...req.body, id: news[idx].id };
    dio.writeNews(news);
    res.json(news[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/news/:id', (req, res) => {
  try {
    createBackup();
    const news = dio.readNews();
    const idx = news.findIndex((n) => n.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    news.splice(idx, 1);
    dio.writeNews(news);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  HOMEPAGE
// ===========================================================================

app.get('/api/homepage', (_req, res) => {
  try {
    res.json(dio.readHomepageData());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/homepage', (req, res) => {
  try {
    createBackup();
    dio.writeHomepageData(req.body);
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  ARTICLE TYPES
// ===========================================================================

// Manual type list (types the user wants available even if no article uses them yet).
// Stored alongside other admin data so backups pick it up automatically.
const TYPES_PATH = path.join(__dirname, 'data', 'article-types.json');
function readManualTypes() {
  if (!fs.existsSync(TYPES_PATH)) return [];
  try {
    const text = fs.readFileSync(TYPES_PATH, 'utf-8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch { return []; }
}
function writeManualTypes(list) {
  const dir = path.dirname(TYPES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = TYPES_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8');
  fs.renameSync(tmp, TYPES_PATH);
}

app.get('/api/article-types', (_req, res) => {
  try {
    const articles = dio.readArticles();
    const aip = dio.readArticlesInPress();
    const typeCounts = {};
    for (const a of articles) typeCounts[a.type || 'Unknown'] = (typeCounts[a.type || 'Unknown'] || 0) + 1;
    for (const a of aip) {
      if (a.type) typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
    }
    // Merge manually-defined types (count 0 if no article uses them yet)
    const manual = readManualTypes();
    for (const name of manual) {
      if (!typeCounts.hasOwnProperty(name)) typeCounts[name] = 0;
    }
    const manualSet = new Set(manual);
    const types = Object.entries(typeCounts)
      .map(([name, count]) => ({ name, count, manual: manualSet.has(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new (manual) type. Idempotent — adding an existing name is a no-op.
app.post('/api/article-types', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Tür adı gerekli' });
    if (name.length > 80) return res.status(400).json({ error: 'Tür adı çok uzun (maks 80)' });
    const manual = readManualTypes();
    if (!manual.includes(name)) {
      manual.push(name);
      writeManualTypes(manual);
    }
    res.json({ name, ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a type. Only allowed if no article currently uses it (count = 0).
app.delete('/api/article-types/:name', (req, res) => {
  try {
    const name = String(req.params.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Tür adı gerekli' });
    const articles = dio.readArticles();
    const aip = dio.readArticlesInPress();
    const inUse = articles.some(a => a.type === name) || aip.some(a => a.type === name);
    if (inUse) return res.status(409).json({ error: 'Bu tür şu anda en az bir makalede kullanılıyor — önce makaleleri başka bir türe taşıyın veya yeniden adlandırın.' });
    const manual = readManualTypes();
    const next = manual.filter(t => t !== name);
    if (next.length !== manual.length) writeManualTypes(next);
    res.json({ removed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/article-types/rename', (req, res) => {
  try {
    createBackup();
    const { oldName, newName } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' });
    const trimmed = String(newName).trim();
    if (!trimmed) return res.status(400).json({ error: 'Yeni ad boş olamaz' });

    const articles = dio.readArticles();
    let count = 0;
    for (const a of articles) {
      if (a.type === oldName) { a.type = trimmed; count++; }
    }
    dio.writeArticles(articles);
    // Rename in AIP too
    const aip = dio.readArticlesInPress();
    let aipCount = 0;
    for (const a of aip) {
      if (a.type === oldName) { a.type = trimmed; aipCount++; }
    }
    if (aipCount) dio.writeArticlesInPress(aip);
    // Update manual list if old name was manual
    const manual = readManualTypes();
    if (manual.includes(oldName)) {
      const next = manual.filter(t => t !== oldName);
      if (!next.includes(trimmed)) next.push(trimmed);
      writeManualTypes(next);
    }
    res.json({ renamed: count + aipCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  JATS XML IMPORT
// ===========================================================================

app.post('/api/jats/parse', uploadXml.single('xml'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No XML file uploaded' });
    const xmlContent = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path);

    const parsed = await parseJatsXml(xmlContent);
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jats/import', async (req, res) => {
  try {
    createBackup();
    const { parsedArticle, fullTextHtml, createIssue: shouldCreate, year } = req.body;
    if (!parsedArticle) return res.status(400).json({ error: 'parsedArticle required' });

    const articles = dio.readArticles();

    // Check for duplicate DOI
    if (parsedArticle.doi) {
      const existing = articles.find((a) => a.doi === parsedArticle.doi);
      if (existing) {
        return res.status(409).json({
          error: `Bu DOI zaten mevcut: #${existing.id} "${existing.title?.slice(0, 60)}"`,
          existingId: existing.id,
        });
      }
    }

    const id = dio.nextArticleId(articles);

    const article = {
      id,
      type: parsedArticle.type || '',
      title: parsedArticle.title || '',
      authors: parsedArticle.authors || [],
      abstract: parsedArticle.abstract || '',
      abstractHtml: parsedArticle.abstractHtml || '',
      previewText: parsedArticle.previewText || '',
      keywords: parsedArticle.keywords || [],
      doi: parsedArticle.doi || '',
      received: parsedArticle.received || '',
      accepted: parsedArticle.accepted || '',
      published: parsedArticle.published || '',
      volume: parsedArticle.volume || null,
      issue: parsedArticle.issue || '',
      pages: parsedArticle.pages || '',
      views: 0,
      downloads: 0,
      citations: 0,
      featured: false,
      imageCorner: false,
      hasFullText: !!(fullTextHtml || parsedArticle.fullTextHtml),
      sourceIssueId: '',
      sourceArticleId: '',
      sourceAbstractUrl: '',
      sourceTextUrl: '',
      sourcePdfUrl: '',
      localPdfUrl: '',
      pdfUrl: '',
      pmid: parsedArticle.pmid || '',
      elocationId: parsedArticle.elocationId || '',
      supplementary: parsedArticle.supplementary || [],
      funding: parsedArticle.funding || [],
      permissions: parsedArticle.permissions || null,
      relatedArticles: parsedArticle.relatedArticles || [],
    };

    articles.unshift(article);
    dio.writeArticles(articles);

    // Write full text
    const ftHtml = fullTextHtml || parsedArticle.fullTextHtml || '';
    if (ftHtml) {
      dio.writeFullText(id, ftHtml);
    }

    // Write author metadata (ORCID, corresponding author)
    if (parsedArticle.authorMetadata) {
      const allMeta = dio.readAuthorMetadata();
      allMeta[id] = parsedArticle.authorMetadata;
      dio.writeAuthorMetadata(allMeta);
    }

    // Rebuild volume JSON + sync archive
    if (article.volume && article.issue) {
      const archive = dio.readArchiveIssues();
      ensureArchiveEntry(archive, article.volume, article.issue, year, shouldCreate);
      const count = dio.rebuildVolumeJson(article.volume, article.issue, articles);
      updateArchiveArticleCount(archive, article.volume, article.issue, count);
      dio.writeArchiveIssues(archive);
    }

    // Handle erratum bidirectional links
    if (article.relatedArticles?.length) {
      handleRelatedArticleLinks(articles, article);
      dio.writeArticles(articles);
    }

    res.status(201).json(article);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jats/parse-batch', uploadXml.array('xml', 100), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No XML files uploaded' });

    const results = [];
    for (const file of req.files) {
      try {
        const xmlContent = fs.readFileSync(file.path, 'utf-8');
        fs.unlinkSync(file.path);
        const parsed = await parseJatsXml(xmlContent);
        results.push({ filename: file.originalname, success: true, article: parsed });
      } catch (err) {
        results.push({ filename: file.originalname, success: false, error: err.message });
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jats/import-batch', async (req, res) => {
  try {
    createBackup();
    const { parsedArticles, targetVolume, targetIssue, createIssue: shouldCreate, year } = req.body;
    if (!Array.isArray(parsedArticles) || !parsedArticles.length) {
      return res.status(400).json({ error: 'parsedArticles array required' });
    }

    const articles = dio.readArticles();
    const allMeta = dio.readAuthorMetadata();
    const imported = [];
    const errors = [];
    // Track every (volume, issue) pair that received articles so we can rebuild
    // each one — even if articles came from different XMLs with different metadata.
    const touchedIssues = new Map(); // key: `${vol}|${iss}` → { volume, issue }

    for (const pa of parsedArticles) {
      try {
        // Check duplicate DOI
        if (pa.doi && articles.find((a) => a.doi === pa.doi)) {
          errors.push({ title: pa.title, error: `DOI zaten mevcut: ${pa.doi}` });
          continue;
        }

        const id = dio.nextArticleId(articles);
        const article = {
          id,
          type: pa.type || '',
          title: pa.title || '',
          authors: pa.authors || [],
          abstract: pa.abstract || '',
          abstractHtml: pa.abstractHtml || '',
          previewText: pa.previewText || '',
          keywords: pa.keywords || [],
          doi: pa.doi || '',
          received: pa.received || '',
          accepted: pa.accepted || '',
          published: pa.published || '',
          volume: targetVolume != null ? Number(targetVolume) : (pa.volume || null),
          issue: targetIssue != null ? String(targetIssue) : (pa.issue || ''),
          pages: pa.pages || '',
          views: 0, downloads: 0, citations: 0,
          featured: false, imageCorner: false,
          hasFullText: !!pa.fullTextHtml,
          sourceIssueId: '', sourceArticleId: '', sourceAbstractUrl: '',
          sourceTextUrl: '', sourcePdfUrl: '', localPdfUrl: '', pdfUrl: '',
          pmid: pa.pmid || '',
          elocationId: pa.elocationId || '',
          supplementary: pa.supplementary || [],
          funding: pa.funding || [],
          permissions: pa.permissions || null,
          relatedArticles: pa.relatedArticles || [],
        };

        articles.unshift(article);

        // Write full text
        if (pa.fullTextHtml) {
          dio.writeFullText(id, pa.fullTextHtml);
        }

        // Author metadata
        if (pa.authorMetadata) {
          allMeta[id] = pa.authorMetadata;
        }

        // Track every (vol, iss) we touched so volume.json + archive stay in sync
        // even when target is "auto" and articles come from multiple issues.
        if (article.volume && article.issue) {
          touchedIssues.set(`${article.volume}|${article.issue}`, {
            volume: article.volume,
            issue: String(article.issue),
          });
        }

        imported.push({ id, title: pa.title, doi: pa.doi });
      } catch (err) {
        errors.push({ title: pa.title, error: err.message });
      }
    }

    // Write all at once
    dio.writeArticles(articles);
    if (Object.keys(allMeta).length) {
      dio.writeAuthorMetadata(allMeta);
    }

    // Rebuild volume JSON + archive for every touched issue. Previously only the
    // explicit targetVolume/targetIssue case was synced, so "auto" mode imports
    // (and mixed-issue batches) silently left volume JSONs and archive counts stale.
    if (touchedIssues.size) {
      const archive = dio.readArchiveIssues();
      for (const { volume, issue } of touchedIssues.values()) {
        ensureArchiveEntry(archive, volume, issue, year, shouldCreate);
        const count = dio.rebuildVolumeJson(volume, issue, articles);
        updateArchiveArticleCount(archive, volume, issue, count);
      }
      dio.writeArchiveIssues(archive);
    }

    // Handle related article links
    for (const imp of imported) {
      const article = articles.find((a) => a.id === imp.id);
      if (article?.relatedArticles?.length) {
        handleRelatedArticleLinks(articles, article);
      }
    }
    if (imported.some((imp) => articles.find((a) => a.id === imp.id)?.relatedArticles?.length)) {
      dio.writeArticles(articles);
    }

    res.status(201).json({ imported, errors, totalImported: imported.length, totalErrors: errors.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import JATS as articles-in-press
app.post('/api/jats/import-in-press', async (req, res) => {
  try {
    createBackup();
    const { parsedArticles } = req.body;
    if (!Array.isArray(parsedArticles) || !parsedArticles.length) {
      return res.status(400).json({ error: 'parsedArticles array required' });
    }

    const aip = dio.readArticlesInPress();
    const mainArticles = dio.readArticles();
    const imported = [];
    const errors = [];

    for (const pa of parsedArticles) {
      try {
        if (pa.doi) {
          const dupMain = mainArticles.find((a) => a.doi === pa.doi);
          const dupAip = aip.find((a) => a.doi === pa.doi);
          if (dupMain || dupAip) {
            errors.push({ title: pa.title, error: `DOI zaten mevcut: ${pa.doi}` });
            continue;
          }
        }

        const id = dio.nextArticleId(mainArticles.concat(aip));
        const article = {
          id,
          type: pa.type || '',
          title: pa.title || '',
          authors: pa.authors || [],
          abstract: pa.abstract || '',
          abstractHtml: pa.abstractHtml || '',
          previewText: pa.previewText || '',
          keywords: pa.keywords || [],
          doi: pa.doi || '',
          received: pa.received || '',
          accepted: pa.accepted || '',
          published: pa.published || '',
          volume: null, issue: '',
          pages: pa.pages || '',
          pmid: pa.pmid || '',
          elocationId: pa.elocationId || '',
          hasFullText: !!pa.fullTextHtml,
        };

        aip.unshift(article);

        if (pa.fullTextHtml) {
          dio.writeFullText(id, pa.fullTextHtml);
        }

        imported.push({ id, title: pa.title, doi: pa.doi });
      } catch (err) {
        errors.push({ title: pa.title, error: err.message });
      }
    }

    dio.writeArticlesInPress(aip);
    res.status(201).json({ imported, errors, totalImported: imported.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move articles from in-press to a specific issue
app.post('/api/articles-in-press/publish', (req, res) => {
  try {
    createBackup();
    const { articleIds, volume, issue, pages, published } = req.body;
    if (!articleIds?.length || !volume || !issue) {
      return res.status(400).json({ error: 'articleIds, volume, issue required' });
    }

    const aip = dio.readArticlesInPress();
    const articles = dio.readArticles();
    const moved = [];

    // Shared published date for the batch (defaults to today). Use the same
    // contract as the single-article publish endpoint (:725) so AIP records
    // moved through either path leave the "Ahead of Print" state cleanly.
    const publishedDate = published || new Date().toISOString().slice(0, 10);

    for (const id of articleIds) {
      const idx = aip.findIndex((a) => a.id === id);
      if (idx === -1) continue;

      const article = aip.splice(idx, 1)[0];
      article.volume = Number(volume);
      article.issue = String(issue);
      article.pages = article.pages || pages || '';
      article.published = article.published || publishedDate;
      article.aheadOfPrint = false;
      delete article.order; // AIP-specific ordering hint, no longer relevant
      articles.unshift(article);
      moved.push(article.id);
    }

    dio.writeArticlesInPress(aip);
    dio.writeArticles(articles);

    // Rebuild volume JSON
    const count = dio.rebuildVolumeJson(volume, issue, articles);
    const archive = dio.readArchiveIssues();
    for (const y of archive) {
      const issObj = y.issues.find((i) => i.volume === Number(volume) && String(i.issue) === String(issue));
      if (issObj) { issObj.articleCount = count; issObj.hasLocalData = true; break; }
    }
    dio.writeArchiveIssues(archive);

    res.json({ moved, count: moved.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Find an archive issue entry across all years.
function findArchiveIssue(archive, volume, issue) {
  const vol = Number(volume);
  const iss = String(issue);
  for (const y of archive) {
    const found = y.issues.find((i) => i.volume === vol && String(i.issue) === iss);
    if (found) return { yearGroup: y, issue: found };
  }
  return null;
}

// Update articleCount on the archive entry for (volume, issue) if it exists.
function updateArchiveArticleCount(archive, volume, issue, count) {
  const found = findArchiveIssue(archive, volume, issue);
  if (found) {
    found.issue.articleCount = count;
    found.issue.hasLocalData = true;
  }
}

// Make sure an archive entry exists for (volume, issue). When missing AND
// shouldCreate is truthy (or auto mode), inserts a new entry under the given
// year (defaults to current year). Mutates `archive` in place.
function ensureArchiveEntry(archive, volume, issue, year, shouldCreate) {
  if (findArchiveIssue(archive, volume, issue)) return;
  if (!shouldCreate) return;
  const vol = Number(volume);
  const iss = String(issue);
  const yr = String(year || new Date().getFullYear());
  let yearGroup = archive.find((y) => y.year === yr);
  if (!yearGroup) {
    yearGroup = { year: yr, volume: vol, issues: [] };
    archive.unshift(yearGroup);
    archive.sort((a, b) => Number(b.year) - Number(a.year));
  }
  yearGroup.issues.unshift({
    label: `Volume ${vol}, Issue ${iss}`,
    sourceId: '',
    sourceUrl: '',
    volume: vol,
    issue: iss,
    articleCount: 0,
    hasLocalData: true,
  });
  // Initialize an empty volume JSON so the archive page can navigate to it.
  if (!fs.existsSync(dio.volumeJsonPath(vol, iss))) {
    dio.writeVolumeJson(vol, iss, []);
  }
}

function handleRelatedArticleLinks(articles, source) {
  const reverseMap = {
    'erratum-for': 'has-erratum',
    'retraction-of': 'is-retracted',
    'reply-to': 'has-reply',
    'comment-on': 'has-comment',
    'related-to': 'related-to',
  };

  for (const link of source.relatedArticles) {
    // Try to find target by PMID, DOI, or volume+pages
    let target = null;
    if (link.targetId) {
      target = articles.find((a) => a.id === link.targetId);
    }
    if (!target && link.targetPmid) {
      target = articles.find((a) => a.pmid === link.targetPmid);
    }
    if (!target && link.targetDoi) {
      target = articles.find((a) => a.doi === link.targetDoi);
    }
    if (!target && link.targetVolume && link.targetPages) {
      target = articles.find(
        (a) =>
          a.volume === link.targetVolume &&
          a.pages &&
          a.pages.startsWith(String(link.targetPages))
      );
    }

    if (target) {
      link.targetId = target.id;
      if (!target.relatedArticles) target.relatedArticles = [];
      const reverseType = reverseMap[link.type] || 'related-to';
      const already = target.relatedArticles.some(
        (r) => r.targetId === source.id && r.type === reverseType
      );
      if (!already) {
        target.relatedArticles.push({
          type: reverseType,
          targetId: source.id,
          targetDoi: source.doi || '',
          targetPmid: '',
          label: source.title || '',
        });
      }
    }
  }
}

// ===========================================================================
//  ZIP IMPORT
// ===========================================================================

// Scan imports directory for available ZIPs (FTP watch)
app.get('/api/imports/scan', (_req, res) => {
  try {
    const files = zipImporter.scanImportsDir();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload a ZIP file to the imports directory
app.post('/api/imports/upload', uploadZip.single('zip'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No ZIP file' });
    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(zipImporter.IMPORTS_DIR, safeName);
    fs.renameSync(req.file.path, dest);
    res.json({ filename: safeName, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview/analyze a ZIP without importing
app.get('/api/imports/preview/:filename', async (req, res) => {
  try {
    const safeName = path.basename(req.params.filename);
    const zipPath = path.join(zipImporter.IMPORTS_DIR, safeName);
    if (!fs.existsSync(zipPath)) return res.status(404).json({ error: 'ZIP dosyası bulunamadı' });

    const preview = await zipImporter.previewZip(zipPath);
    // Strip full parsed data to reduce response size
    preview.articles = preview.articles.map(({ parsed, ...rest }) => rest);
    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import a ZIP: parse all XMLs, save PDFs/images/supplementary, create articles
app.post('/api/imports/process/:filename', async (req, res) => {
  try {
    createBackup();
    const safeName = path.basename(req.params.filename);
    const zipPath = path.join(zipImporter.IMPORTS_DIR, safeName);
    if (!fs.existsSync(zipPath)) return res.status(404).json({ error: 'ZIP dosyası bulunamadı' });

    const { targetVolume, targetIssue, setAsCurrent, createIssue: shouldCreate } = req.body || {};

    // Optionally create the issue if it doesn't exist
    if (shouldCreate && targetVolume && targetIssue) {
      const archive = dio.readArchiveIssues();
      let found = false;
      for (const y of archive) {
        if (y.issues.some((i) => i.volume === Number(targetVolume) && String(i.issue) === String(targetIssue))) {
          found = true;
          break;
        }
      }
      if (!found) {
        const year = req.body.year || String(new Date().getFullYear());
        let yearGroup = archive.find((y) => y.year === year);
        if (!yearGroup) {
          yearGroup = { year, volume: Number(targetVolume), issues: [] };
          archive.unshift(yearGroup);
          archive.sort((a, b) => Number(b.year) - Number(a.year));
        }
        yearGroup.issues.unshift({
          label: `Volume ${targetVolume}, Issue ${targetIssue}`,
          sourceId: '', sourceUrl: '',
          volume: Number(targetVolume),
          issue: String(targetIssue),
          articleCount: 0,
          hasLocalData: true,
        });
        dio.writeArchiveIssues(archive);
        dio.writeVolumeJson(targetVolume, targetIssue, []);
      }
    }

    const result = await zipImporter.importZip(zipPath, {
      targetVolume: targetVolume != null ? Number(targetVolume) : null,
      targetIssue: targetIssue != null ? String(targetIssue) : null,
      setAsCurrent: !!setAsCurrent,
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a ZIP from imports
app.delete('/api/imports/:filename', (req, res) => {
  try {
    const safeName = path.basename(req.params.filename);
    const zipPath = path.join(zipImporter.IMPORTS_DIR, safeName);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  MEDIA UPLOAD
// ===========================================================================

app.post('/api/media/upload/pdf', uploadPdf.single('pdf'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const rawId = req.body.articleId || path.parse(req.file.originalname).name;
    const articleId = String(rawId).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(dio.PATHS.pdfsDir, `${articleId}.pdf`);
    fs.renameSync(req.file.path, dest);

    const pdfUrl = `js/data/pdfs/${articleId}.pdf`;
    res.json({ pdfUrl, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/media/upload/image', uploadImage.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    // Sanitize filename: only allow alphanumeric, dash, underscore, dot
    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(dio.PATHS.imagesDir, safeName);
    fs.renameSync(req.file.path, dest);
    res.json({ url: `images/${safeName}`, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload editorial board member photo into images/editorial-board/
app.post('/api/media/upload/editorial-photo', uploadImage.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const editorialDir = path.join(dio.PATHS.imagesDir, 'editorial-board');
    if (!fs.existsSync(editorialDir)) fs.mkdirSync(editorialDir, { recursive: true });
    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(editorialDir, safeName);
    fs.renameSync(req.file.path, dest);
    res.json({ url: `images/editorial-board/${safeName}`, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload editorial board member CV / document (PDF, JPG, PNG…) into
// images/editorial-board/cv/. Used by the per-member link rows.
app.post('/api/media/upload/editorial-cv', uploadFigure.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const cvDir = path.join(dio.PATHS.imagesDir, 'editorial-board', 'cv');
    if (!fs.existsSync(cvDir)) fs.mkdirSync(cvDir, { recursive: true });
    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(cvDir, safeName);
    fs.renameSync(req.file.path, dest);
    res.json({ url: `images/editorial-board/cv/${safeName}`, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch PDF upload — match to articles by filename (e.g., 2805.pdf → article #2805).
// Searches BOTH the main articles list and the AIP list; previously only the main
// articles list was checked, so AIP-id PDFs always ended up in "unmatched" even
// though the upload itself succeeded.
app.post('/api/media/upload/pdf-batch', uploadPdf.array('pdf', 200), (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files' });

    const articles = dio.readArticles();
    const aip = dio.readArticlesInPress();
    const matched = [];
    const unmatched = [];
    let articlesDirty = false;
    let aipDirty = false;

    for (const file of req.files) {
      const baseName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const articleId = parseInt(baseName);
      const dest = path.join(dio.PATHS.pdfsDir, `${baseName}.pdf`);
      fs.renameSync(file.path, dest);

      const pdfUrl = `js/data/pdfs/${baseName}.pdf`;

      // Try to match to a main article by ID first, then AIP
      const article = articleId ? articles.find((a) => a.id === articleId) : null;
      const aipArticle = !article && articleId ? aip.find((a) => a.id === articleId) : null;

      if (article) {
        article.pdfUrl = pdfUrl;
        article.localPdfUrl = pdfUrl;
        articlesDirty = true;
        matched.push({ id: article.id, title: article.title, pdfUrl, list: 'articles' });
      } else if (aipArticle) {
        aipArticle.pdfUrl = pdfUrl;
        aipArticle.localPdfUrl = pdfUrl;
        aipDirty = true;
        matched.push({ id: aipArticle.id, title: aipArticle.title, pdfUrl, list: 'aip' });
      } else {
        unmatched.push({ filename: file.originalname, pdfUrl });
      }
    }

    if (articlesDirty) dio.writeArticles(articles);
    if (aipDirty) dio.writeArticlesInPress(aip);

    res.json({ matched, unmatched, totalMatched: matched.length, totalUnmatched: unmatched.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Figure caption/source metadata: stored as _figure-meta.json alongside the
// image files so captions survive page reloads and are pre-filled next open.
const FIGURE_META_FILE = '_figure-meta.json';

app.get('/api/media/article/:articleId/figure-meta', requireAuth, (req, res) => {
  try {
    const articleId = String(req.params.articleId).replace(/[^a-zA-Z0-9._-]/g, '_');
    const metaPath = path.join(dio.PATHS.articleImagesDir, articleId, FIGURE_META_FILE);
    if (!fs.existsSync(metaPath)) return res.json({});
    res.json(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a single uploaded figure file (and its metadata entry, if any).
app.delete('/api/media/article/:articleId/figures/:filename', requireAuth, (req, res) => {
  try {
    const articleId = String(req.params.articleId).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename  = path.basename(req.params.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!filename || filename === FIGURE_META_FILE) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const articleDir = path.join(dio.PATHS.articleImagesDir, articleId);
    const filePath = path.join(articleDir, filename);
    // Defense in depth: make sure the resolved path is inside the article dir
    if (!filePath.startsWith(articleDir + path.sep)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Remove matching metadata entry too so the meta file doesn't accumulate
    // orphan caption records for files that no longer exist.
    const metaPath = path.join(articleDir, FIGURE_META_FILE);
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta && Object.prototype.hasOwnProperty.call(meta, filename)) {
          delete meta[filename];
          if (Object.keys(meta).length === 0) fs.unlinkSync(metaPath);
          else fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        }
      } catch { /* ignore */ }
    }
    res.json({ ok: true, deleted: filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Allowed size values for figure/table presentation. Anything else is coerced
// to 'auto' so the metadata file stays clean.
const FIGURE_SIZE_VALUES = new Set(['auto', 'small', 'medium', 'large', 'full']);

app.put('/api/media/article/:articleId/figure-meta', requireAuth, (req, res) => {
  try {
    const articleId = String(req.params.articleId).replace(/[^a-zA-Z0-9._-]/g, '_');
    const { filename, caption, source, size } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename required' });
    const safeSize = FIGURE_SIZE_VALUES.has(size) ? size : 'auto';

    const articleDir = path.join(dio.PATHS.articleImagesDir, articleId);
    if (!fs.existsSync(articleDir)) fs.mkdirSync(articleDir, { recursive: true });
    const metaPath = path.join(articleDir, FIGURE_META_FILE);

    let meta = {};
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { /* start fresh */ }
    }
    meta[filename] = {
      caption: caption || '',
      source:  source  || '',
      size:    safeSize,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List existing figures and supplementary files for an article
app.get('/api/media/article/:articleId/assets', (req, res) => {
  try {
    const articleId = String(req.params.articleId).replace(/[^a-zA-Z0-9._-]/g, '_');
    const articleDir = path.join(dio.PATHS.articleImagesDir, articleId);
    const suppDir = path.join(dio.PATHS.supplementaryDir, articleId);
    // Load saved figure captions/sources to include in each figure entry
    let figureMeta = {};
    const metaPath = path.join(articleDir, FIGURE_META_FILE);
    if (fs.existsSync(metaPath)) {
      try { figureMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { /* ignore */ }
    }
    const figures = fs.existsSync(articleDir)
      ? fs.readdirSync(articleDir).filter((f) => !f.startsWith('.') && f !== FIGURE_META_FILE).map((f) => ({
          filename: f,
          url: `images/articles/${articleId}/${f}`,
          caption: (figureMeta[f] || {}).caption || '',
          source:  (figureMeta[f] || {}).source  || '',
          size:    (figureMeta[f] || {}).size    || 'auto',
        }))
      : [];
    const supplementary = fs.existsSync(suppDir)
      ? fs.readdirSync(suppDir).filter((f) => !f.startsWith('.')).map((f) => ({ filename: f, url: `js/data/supplementary/${articleId}/${f}` }))
      : [];
    res.json({ articleId, figures, supplementary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Figure placeholder status: parse full text, extract figure refs, match against uploaded files.
// Supports two formats found in this corpus:
//   - Modern:  <img src="fig1">  or  <img src="images/articles/123/fig1.png">
//   - Legacy:  <a href="javascript:openWin('uploads/grafik/figure_BMJ_2780_0.jpg', 640, 480)">Figure 1</a>
app.get('/api/media/article/:articleId/figure-status', (req, res) => {
  try {
    const articleIdRaw = req.params.articleId;
    const articleId = String(articleIdRaw).replace(/[^a-zA-Z0-9._-]/g, '_');
    const { normalizeFigureKey } = require('./lib/zip-importer');

    const html = dio.readFullText(articleId) || '';
    const articleDir = path.join(dio.PATHS.articleImagesDir, articleId);
    const uploaded = fs.existsSync(articleDir)
      ? fs.readdirSync(articleDir).filter((f) => !f.startsWith('.') && f !== FIGURE_META_FILE).map((f) => ({
          filename: f,
          url: `images/articles/${articleId}/${f}`,
          key: normalizeFigureKey(f),
        }))
      : [];

    // Index uploaded files by both normalized key and exact basename, so legacy
    // refs like "figure_BMJ_2780_0.jpg" still match when the user uploads a file
    // with the same name.
    const uploadedByKey = new Map();
    const uploadedByName = new Map();
    for (const u of uploaded) {
      if (u.key && !uploadedByKey.has(u.key)) uploadedByKey.set(u.key, u);
      uploadedByName.set(u.filename.toLowerCase(), u);
      const base = u.filename.replace(/\.[^.]+$/, '').toLowerCase();
      if (!uploadedByName.has(base)) uploadedByName.set(base, u);
    }

    const placeholders = [];
    const seen = new Set();

    // 1) Modern: src="..." values
    const srcRegex = /src="([^"]+)"/g;
    let m;
    while ((m = srcRegex.exec(html)) !== null) {
      const ref = m[1];
      const dedupeKey = 'src:' + ref;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const isResolvedPath = /^(images\/|\/|https?:\/\/|data:)/.test(ref);
      const key = normalizeFigureKey(ref);
      // Identify which uploaded file this src points to (for both unresolved
      // placeholders AND resolved paths like "images/articles/2867/foo.png" —
      // matching the basename lets the wizard mark this file as "in full text").
      let match = null;
      if (!isResolvedPath) {
        match = uploadedByKey.get(key) || uploadedByName.get(ref.toLowerCase());
      } else {
        // Resolved path: extract basename and look it up against uploads.
        const baseName = ref.split('/').pop() || '';
        match = uploadedByName.get(baseName.toLowerCase());
      }
      placeholders.push({
        ref,
        format: 'modern',
        key,
        status: isResolvedPath ? 'resolved' : (match ? 'fuzzy-match' : 'missing'),
        resolvedUrl: isResolvedPath ? ref : (match ? match.url : null),
        suggestedFile: match ? match.filename : null,
      });
    }

    // 2) Legacy: javascript:openWin('path/to/file.jpg', ...) inside href values
    const legacyRegex = /openWin\(\s*['"]([^'"]+)['"]/g;
    while ((m = legacyRegex.exec(html)) !== null) {
      const ref = m[1];
      const dedupeKey = 'legacy:' + ref;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const baseName = path.basename(ref);
      const baseNoExt = baseName.replace(/\.[^.]+$/, '').toLowerCase();
      const key = normalizeFigureKey(baseName);
      const match = uploadedByName.get(baseName.toLowerCase()) || uploadedByName.get(baseNoExt) || (key ? uploadedByKey.get(key) : null);
      placeholders.push({
        ref,
        format: 'legacy',
        key,
        suggestedName: baseName,
        status: match ? 'fuzzy-match' : 'missing',
        resolvedUrl: match ? match.url : null,
        suggestedFile: match ? match.filename : null,
      });
    }

    // For each uploaded file, indicate whether it's matched to *any* placeholder
    const matchedFilenames = new Set(placeholders.filter((p) => p.suggestedFile).map((p) => p.suggestedFile));
    const figures = uploaded.map((u) => ({
      filename: u.filename,
      url: u.url,
      key: u.key,
      matchedTo: matchedFilenames.has(u.filename) ? u.key || u.filename : null,
    }));

    res.json({
      articleId,
      hasFullText: !!html,
      placeholders,
      figures,
      stats: {
        totalPlaceholders: placeholders.length,
        resolved: placeholders.filter((p) => p.status === 'resolved').length,
        fuzzyMatch: placeholders.filter((p) => p.status === 'fuzzy-match').length,
        missing: placeholders.filter((p) => p.status === 'missing').length,
        legacyCount: placeholders.filter((p) => p.format === 'legacy').length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload figures for an article
app.post('/api/media/upload/figures/:articleId', uploadFigure.array('figures', 50), (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files' });
    const articleId = String(req.params.articleId).replace(/[^a-zA-Z0-9._-]/g, '_');

    // Create article images directory
    const articleDir = path.join(dio.PATHS.articleImagesDir, articleId);
    if (!fs.existsSync(articleDir)) fs.mkdirSync(articleDir, { recursive: true });

    const uploaded = [];
    for (const file of req.files) {
      const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(articleDir, safeName);
      fs.renameSync(file.path, dest);
      uploaded.push({ filename: safeName, url: `images/articles/${articleId}/${safeName}` });
    }

    const articleKnown = dio.readArticles().some((a) => String(a.id) === articleId)
      || dio.readArticlesInPress().some((a) => String(a.id) === articleId);
    res.json({ articleId, uploaded, articleKnown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update article full text HTML to use uploaded figure paths.
// Two modes:
//   1) Legacy: client supplies explicit { mappings: [{originalHref, newUrl}] }
//   2) Auto:   client omits mappings — server scans uploaded figures + full text,
//              normalizes filenames (fig1 ~ figure1 ~ fig_01 ~ Figure 1) and replaces.
app.post('/api/media/figures/:articleId/apply', (req, res) => {
  try {
    const { normalizeFigureKey } = require('./lib/zip-importer');
    const articleId = String(req.params.articleId).replace(/[^a-zA-Z0-9._-]/g, '_');

    let html = dio.readFullText(articleId);
    if (!html) return res.status(404).json({ error: 'Full text not found' });

    let replaced = 0;
    const replacements = [];

    if (req.body?.mappings?.length) {
      // Legacy explicit mode
      for (const m of req.body.mappings) {
        const escaped = m.originalHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`src="${escaped}"`, 'g');
        if (html.includes(`src="${m.originalHref}"`)) {
          html = html.replace(regex, `src="${m.newUrl}"`);
          replaced++;
          replacements.push({ from: m.originalHref, to: m.newUrl });
        }
      }
    }

    // Auto mode: walk uploaded figures, find matching unresolved placeholders by normalized key.
    const articleDir = path.join(dio.PATHS.articleImagesDir, articleId);
    if (fs.existsSync(articleDir)) {
      const uploaded = fs.readdirSync(articleDir)
        .filter((f) => !f.startsWith('.') && f !== FIGURE_META_FILE)
        .map((f) => ({ filename: f, url: `images/articles/${articleId}/${f}`, key: normalizeFigureKey(f) }));

      // Index uploaded by key and by basename
      const byKey = new Map();
      const byName = new Map();
      for (const u of uploaded) {
        if (u.key && !byKey.has(u.key)) byKey.set(u.key, u);
        byName.set(u.filename.toLowerCase(), u);
        const base = u.filename.replace(/\.[^.]+$/, '').toLowerCase();
        if (!byName.has(base)) byName.set(base, u);
      }

      // 1) Modern src="..." replacements
      const modernRefs = new Set();
      const reSrc = /src="([^"]+)"/g;
      let mm;
      while ((mm = reSrc.exec(html)) !== null) {
        const ref = mm[1];
        if (!/^(images\/|\/|https?:\/\/|data:)/.test(ref)) modernRefs.add(ref);
      }
      for (const ref of modernRefs) {
        const refKey = normalizeFigureKey(ref);
        const match = byKey.get(refKey) || byName.get(ref.toLowerCase());
        if (match) {
          const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          html = html.replace(new RegExp(`src="${escaped}"`, 'g'), `src="${match.url}"`);
          replaced++;
          replacements.push({ from: ref, to: match.url, format: 'modern' });
        }
      }

      // 2) Legacy <a href="javascript:openWin('path/file.jpg', ...)">label</a>
      //    → replace the whole anchor with a real <img>+caption block. We pull
      //    label text from inside the anchor for the figcaption.
      const legacyAnchor = /<a[^>]*href="javascript:openWin\(\s*['"]([^'"]+)['"][^)]*\)"[^>]*>([\s\S]*?)<\/a>/gi;
      html = html.replace(legacyAnchor, (full, refPath, inner) => {
        const baseName = path.basename(refPath);
        const baseNoExt = baseName.replace(/\.[^.]+$/, '').toLowerCase();
        const match = byName.get(baseName.toLowerCase()) || byName.get(baseNoExt) || byKey.get(normalizeFigureKey(baseName));
        if (!match) return full; // leave unresolved legacy untouched
        const label = String(inner).replace(/<[^>]+>/g, '').trim() || baseName;
        replaced++;
        replacements.push({ from: refPath, to: match.url, format: 'legacy' });
        return `<figure class="article-figure"><img src="${match.url}" alt="${label.replace(/"/g, '&quot;')}"><figcaption>${label}</figcaption></figure>`;
      });
    }

    dio.writeFullText(articleId, html);
    res.json({ replaced, replacements, articleId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload supplementary files for an article
app.post('/api/media/upload/supplementary/:articleId', uploadSupp.array('files', 20), (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files' });
    const articleId = String(req.params.articleId).replace(/[^a-zA-Z0-9._-]/g, '_');

    const suppDir = path.join(dio.PATHS.supplementaryDir, articleId);
    if (!fs.existsSync(suppDir)) fs.mkdirSync(suppDir, { recursive: true });

    const uploaded = [];
    for (const file of req.files) {
      const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(suppDir, safeName);
      fs.renameSync(file.path, dest);
      uploaded.push({ filename: safeName, url: `js/data/supplementary/${articleId}/${safeName}` });
    }

    // Auto-link uploaded files into the article's supplementary[] list so they
    // render on the public site ("Supplementary Materials") with no extra step.
    const articles = dio.readArticles();
    const aips = dio.readArticlesInPress();
    let target = articles.find((a) => String(a.id) === articleId);
    let inAip = false;
    if (!target) { target = aips.find((a) => String(a.id) === articleId); inAip = !!target; }
    const articleKnown = !!target;
    const added = [];
    let supplementary = [];
    if (target) {
      target.supplementary = Array.isArray(target.supplementary) ? target.supplementary : [];
      const seen = new Set(target.supplementary.map((s) => s && s.href));
      for (const u of uploaded) {
        if (seen.has(u.url)) continue;
        const entry = { id: `supp${target.supplementary.length + 1}`, label: u.filename, href: u.url, caption: '', mimeType: '' };
        target.supplementary.push(entry);
        seen.add(u.url);
        added.push(entry);
      }
      if (added.length) (inAip ? dio.writeArticlesInPress(aips) : dio.writeArticles(articles));
      supplementary = target.supplementary;
    }
    res.json({ articleId, uploaded, articleKnown, added, supplementary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Supplementary Library — standalone, permanent-URL supplementary materials.
//
// Use case: graphic designers send a supplementary PDF without telling us
// which article it belongs to and need a stable URL they can embed into the
// final PDF. The URL is the file name: /img/files/<name>. Updating the file
// content (Replace) preserves the URL; renaming breaks it (warn loudly).
// ─────────────────────────────────────────────────────────────────────────────
const SUPP_LIB_DIR = path.join(dio.ROOT, 'img', 'files');
function ensureSuppLibDir() {
  if (!fs.existsSync(SUPP_LIB_DIR)) fs.mkdirSync(SUPP_LIB_DIR, { recursive: true });
}
// Strip path separators and characters URLs can't carry cleanly. Preserve dots
// (extension) and dashes; collapse whitespace and any other char to '-'.
function suppLibSafeName(raw) {
  const base = path.basename(String(raw || '')).trim();
  if (!base) return '';
  const cleaned = base.replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-');
  // Disallow names that traverse or hide. Also reject if it would be empty
  // or only an extension (".pdf"). The leading dot check covers ".." too.
  if (!cleaned || cleaned.startsWith('.') || cleaned === '-' || cleaned.length > 200) return '';
  return cleaned;
}
function suppLibStat(name) {
  const safe = suppLibSafeName(name);
  if (!safe) return null;
  const p = path.join(SUPP_LIB_DIR, safe);
  if (!fs.existsSync(p)) return null;
  const st = fs.statSync(p);
  if (!st.isFile()) return null;
  return { name: safe, size: st.size, mtime: st.mtime.toISOString(), url: `/img/files/${safe}` };
}

// Build a Map<filename, [{ articleId, title, isAip }]> by scanning every
// article and AIP for supplementary entries whose href points at /img/files/.
// Used to split the library list into "standalone" vs "linked" scopes and to
// show users which article a file belongs to.
function suppLibBuildRefMap() {
  const map = new Map();
  const scan = (list, isAip) => {
    for (const a of list) {
      const supps = Array.isArray(a.supplementary) ? a.supplementary : [];
      for (const s of supps) {
        if (!s || !s.href) continue;
        const m = String(s.href).match(/(?:^|\/)img\/files\/([^/?#]+)$/);
        if (!m) continue;
        const name = decodeURIComponent(m[1]);
        if (!map.has(name)) map.set(name, []);
        map.get(name).push({ articleId: String(a.id), title: a.title || '', isAip });
      }
    }
  };
  try { scan(dio.readArticles(), false); } catch (_) {}
  try { scan(dio.readArticlesInPress(), true); } catch (_) {}
  return map;
}

app.get('/api/supp-library', (req, res) => {
  try {
    ensureSuppLibDir();
    const scope = String(req.query.scope || 'all');
    const refMap = suppLibBuildRefMap();
    const names = fs.readdirSync(SUPP_LIB_DIR).filter((n) => !n.startsWith('.'));
    let files = names.map((n) => {
      const stat = suppLibStat(n);
      if (!stat) return null;
      stat.references = refMap.get(n) || [];
      return stat;
    }).filter(Boolean);
    if (scope === 'standalone') files = files.filter((f) => !f.references.length);
    else if (scope === 'linked') files = files.filter((f) => f.references.length);
    files.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
    res.json({ files, scope, baseUrl: '/img/files' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload one or more files. Optional query: ?overwrite=true to replace
// same-named files (otherwise duplicates are reported in `conflicts`).
// Optional `rename` field per-file (multer puts non-file fields into req.body):
//   send rename for a single-file upload to override the stored name.
app.post('/api/supp-library/upload', uploadSupp.array('files', 20), (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files' });
    ensureSuppLibDir();
    const overwrite = String(req.query.overwrite || req.body.overwrite || '') === 'true';
    const renameSingle = req.files.length === 1 ? suppLibSafeName(req.body.rename || '') : '';
    const uploaded = [];
    const conflicts = [];
    for (const file of req.files) {
      const safe = renameSingle || suppLibSafeName(file.originalname);
      if (!safe) { try { fs.unlinkSync(file.path); } catch (_) {} continue; }
      const dest = path.join(SUPP_LIB_DIR, safe);
      if (fs.existsSync(dest) && !overwrite) {
        conflicts.push({ name: safe, reason: 'exists' });
        try { fs.unlinkSync(file.path); } catch (_) {}
        continue;
      }
      // Move temp upload into the library directory. fs.renameSync fails across
      // volumes; fall back to copy + unlink in that case.
      try { fs.renameSync(file.path, dest); }
      catch (e) { fs.copyFileSync(file.path, dest); try { fs.unlinkSync(file.path); } catch (_) {} }
      uploaded.push(suppLibStat(safe));
    }

    // If an articleId is given, additionally register each uploaded file as a
    // supplementary entry on that article (or AIP). The on-disk file still
    // lives at the permanent /img/files/ URL — we only append to the article's
    // supplementary[] so it shows up in the public Supplementary Materials list.
    let articleLinked = null;
    const articleId = String(req.body.articleId || '').trim();
    if (articleId && uploaded.length) {
      const articles = dio.readArticles();
      const aips = dio.readArticlesInPress();
      let target = articles.find((a) => String(a.id) === articleId);
      let inAip = false;
      if (!target) { target = aips.find((a) => String(a.id) === articleId); inAip = !!target; }
      if (!target) {
        articleLinked = { articleId, error: 'Article not found' };
      } else {
        target.supplementary = Array.isArray(target.supplementary) ? target.supplementary : [];
        const seen = new Set(target.supplementary.map((s) => s && s.href).filter(Boolean));
        const added = [];
        for (const u of uploaded) {
          const href = `img/files/${u.name}`; // relative, public site serves it
          if (seen.has(href) || seen.has('/' + href)) continue;
          const entry = {
            id: `supp${target.supplementary.length + 1}`,
            label: u.name,
            href,
            caption: '',
            mimeType: '',
          };
          target.supplementary.push(entry);
          seen.add(href);
          added.push(entry);
        }
        if (added.length) (inAip ? dio.writeArticlesInPress(aips) : dio.writeArticles(articles));
        articleLinked = { articleId, title: target.title, isAip: inAip, added };
      }
    }

    res.json({ uploaded, conflicts, articleLinked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Replace a single file's content while keeping its name (and therefore URL).
app.post('/api/supp-library/:name/replace', uploadSupp.single('file'), (req, res) => {
  try {
    const safe = suppLibSafeName(req.params.name);
    if (!safe) return res.status(400).json({ error: 'Bad filename' });
    const dest = path.join(SUPP_LIB_DIR, safe);
    if (!fs.existsSync(dest)) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
      return res.status(404).json({ error: 'Not found' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file' });
    fs.copyFileSync(req.file.path, dest); // overwrite in place
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.json({ file: suppLibStat(safe) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rename — explicitly breaks any link that already points at the old name.
// The client is expected to confirm with the user before calling this.
app.post('/api/supp-library/:name/rename', express.json(), (req, res) => {
  try {
    const from = suppLibSafeName(req.params.name);
    const to = suppLibSafeName(req.body && req.body.to);
    if (!from || !to) return res.status(400).json({ error: 'Bad filename' });
    if (from === to) return res.json({ file: suppLibStat(from) });
    const src = path.join(SUPP_LIB_DIR, from);
    const dst = path.join(SUPP_LIB_DIR, to);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'Not found' });
    if (fs.existsSync(dst)) return res.status(409).json({ error: 'Target name already exists' });
    fs.renameSync(src, dst);
    res.json({ file: suppLibStat(to), oldName: from });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/supp-library/:name', (req, res) => {
  try {
    const safe = suppLibSafeName(req.params.name);
    if (!safe) return res.status(400).json({ error: 'Bad filename' });
    const p = path.join(SUPP_LIB_DIR, safe);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    fs.unlinkSync(p);
    res.json({ deleted: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Media stats
app.get('/api/media/stats', (_req, res) => {
  try {
    const pdfCount = fs.existsSync(dio.PATHS.pdfsDir)
      ? fs.readdirSync(dio.PATHS.pdfsDir).filter((f) => f.endsWith('.pdf')).length : 0;

    const articles = dio.readArticles();
    const withPdf = articles.filter((a) => a.pdfUrl).length;
    const withoutPdf = articles.length - withPdf;

    let figureCount = 0;
    if (fs.existsSync(dio.PATHS.articleImagesDir)) {
      const dirs = fs.readdirSync(dio.PATHS.articleImagesDir);
      for (const d of dirs) {
        const p = path.join(dio.PATHS.articleImagesDir, d);
        if (fs.statSync(p).isDirectory()) {
          figureCount += fs.readdirSync(p).length;
        }
      }
    }

    let suppCount = 0;
    if (fs.existsSync(dio.PATHS.supplementaryDir)) {
      const dirs = fs.readdirSync(dio.PATHS.supplementaryDir);
      for (const d of dirs) {
        const p = path.join(dio.PATHS.supplementaryDir, d);
        if (fs.statSync(p).isDirectory()) {
          suppCount += fs.readdirSync(p).length;
        }
      }
    }

    res.json({ pdfCount, withPdf, withoutPdf, figureCount, suppCount, totalArticles: articles.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List articles missing PDFs
app.get('/api/media/missing-pdfs', (_req, res) => {
  try {
    const articles = dio.readArticles();
    const missing = articles
      .filter((a) => !a.pdfUrl)
      .map((a) => ({ id: a.id, title: a.title, volume: a.volume, issue: a.issue, doi: a.doi }));
    res.json(missing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  PAGES (content editing)
// ===========================================================================

const BUILTIN_PAGES = [
  { slug: 'about', file: 'about.html', title: 'About the Journal' },
  { slug: 'for-authors', file: 'for-authors.html', title: 'For Authors' },
  { slug: 'for-reviewers', file: 'for-reviewers.html', title: 'For Reviewers' },
  { slug: 'policies', file: 'policies.html', title: 'Policies' },
  { slug: 'contact', file: 'contact.html', title: 'Contact' },
  { slug: 'forms', file: 'forms.html', title: 'Forms' },
  { slug: 'journal-metrics', file: 'journal-metrics.html', title: 'Journal Metrics' },
];

const shortLinks = require('./lib/short-links');
// Reconcile redirect files with store at startup (handles manual edits).
try { shortLinks.rebuildAll(); } catch (e) { console.warn('[short-links] rebuild on startup failed:', e.message); }

function attachShortCode(page) {
  const entry = shortLinks.getBySlug(page.slug);
  return entry ? { ...page, shortCode: entry.code } : { ...page, shortCode: null };
}

function listAllPages() {
  const builtins = BUILTIN_PAGES.map((p) => ({ ...p, custom: false }));
  const customs = pageTpl.readCustomPages().map((p) => ({
    slug: p.slug,
    file: p.file,
    title: p.title,
    description: p.description,
    createdAt: p.createdAt,
    custom: true,
  }));
  return [...builtins, ...customs].map(attachShortCode);
}

function findPage(slug) {
  return listAllPages().find((p) => p.slug === slug);
}

app.get('/api/pages', (_req, res) => {
  res.json(listAllPages());
});

// Set or update the short link code for a page.
app.put('/api/pages/:slug/short-code', (req, res) => {
  try {
    const page = findPage(req.params.slug);
    if (!page) return res.status(404).json({ error: 'Sayfa bulunamadı' });
    const code = String(req.body?.code || '').trim();
    const entry = shortLinks.setCode(page.slug, code, page.file, page.title);
    res.json({ shortCode: entry.code, targetFile: entry.targetFile });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Remove the short link for a page.
app.delete('/api/pages/:slug/short-code', (req, res) => {
  try {
    const ok = shortLinks.removeBySlug(req.params.slug);
    res.json({ removed: ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all short codes (used by an admin overview).
// NOTE: distinct path (not /api/pages/short-codes) to avoid being swallowed by
// the GET /api/pages/:slug route that already exists below.
app.get('/api/short-links', (_req, res) => {
  try {
    res.json(shortLinks.listAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pages/:slug', (req, res) => {
  try {
    const page = findPage(req.params.slug);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    const filePath = path.join(dio.ROOT, page.file);
    const html = fs.readFileSync(filePath, 'utf-8');

    // Extract content between <main id="main-content"> and </main>
    const mainMatch = html.match(/<main\s+id="main-content"[^>]*>([\s\S]*?)<\/main>/);
    const content = mainMatch ? mainMatch[1].trim() : '';

    // Parse sections: find each <section> with an <h2> heading and prose content
    const sections = [];
    const sectionRegex = /<section[^>]*>([\s\S]*?)<\/section>/g;
    let m;
    while ((m = sectionRegex.exec(content)) !== null) {
      const block = m[1];
      const headingMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
      const heading = headingMatch ? headingMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      // Extract prose div content, or everything after the h2
      const proseMatch = block.match(/<div[^>]*class="[^"]*prose[^"]*"[^>]*>([\s\S]*)<\/div>\s*$/);
      const body = proseMatch ? proseMatch[1].trim() : (headingMatch ? block.slice(block.indexOf('</h2>') + 5).trim() : block.trim());
      sections.push({ heading, body });
    }

    res.json({ ...page, content, sections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pages/:slug', (req, res) => {
  try {
    createBackup();
    const page = findPage(req.params.slug);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    const filePath = path.join(dio.ROOT, page.file);
    let html = fs.readFileSync(filePath, 'utf-8');

    const newContent = req.body.content || '';
    html = html.replace(
      /(<main\s+id="main-content"[^>]*>)([\s\S]*?)(<\/main>)/,
      `$1\n${newContent}\n$3`
    );

    fs.writeFileSync(filePath, html, 'utf-8');
    res.json({ saved: true, slug: page.slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pages', (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const rawSlug = req.body.slug ? String(req.body.slug) : title;
    const slug = pageTpl.normalizeSlug(rawSlug);

    if (!title) return res.status(400).json({ error: 'Başlık gerekli' });
    const slugError = pageTpl.validateSlug(slug);
    if (slugError) return res.status(400).json({ error: slugError });

    const existing = listAllPages().find((p) => p.slug === slug);
    if (existing) return res.status(409).json({ error: 'Bu slug zaten kullanılıyor' });

    const file = `${slug}.html`;
    const filePath = path.join(dio.ROOT, file);
    if (fs.existsSync(filePath)) {
      return res.status(409).json({ error: 'Aynı isimde bir HTML dosyası zaten var' });
    }

    createBackup();
    const html = pageTpl.createPageHtml({ slug, title, description });
    fs.writeFileSync(filePath, html, 'utf-8');

    const pages = pageTpl.readCustomPages();
    pages.push({ slug, file, title, description, createdAt: new Date().toISOString() });
    pageTpl.writeCustomPages(pages);

    res.json({ created: true, slug, file, title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pages/:slug', (req, res) => {
  try {
    const slug = req.params.slug;
    const pages = pageTpl.readCustomPages();
    const idx = pages.findIndex((p) => p.slug === slug);
    if (idx === -1) {
      return res.status(404).json({ error: 'Özel sayfa bulunamadı (sistem sayfaları silinemez)' });
    }

    createBackup();
    const page = pages[idx];
    const filePath = path.join(dio.ROOT, page.file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    pages.splice(idx, 1);
    pageTpl.writeCustomPages(pages);

    // Clean up any short link pointing at this page so /s/{code}.html
    // doesn't dangle as a broken redirect.
    try { shortLinks.removeBySlug(slug); } catch { /* non-fatal */ }

    res.json({ deleted: true, slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  NAV / FOOTER
// ===========================================================================

const NAV_FOOTER_PATH = path.join(__dirname, 'data', 'nav-footer.json');

app.get('/api/nav-footer', (_req, res) => {
  try {
    let data = null;
    if (fs.existsSync(NAV_FOOTER_PATH)) {
      data = JSON.parse(fs.readFileSync(NAV_FOOTER_PATH, 'utf-8'));
    }
    // Bootstrap (or upgrade an old HTML-only file) so the form editor always
    // receives a structured model (data.nav / data.footer) to work with.
    if (!data || !data.nav || !data.footer) {
      data = require('./lib/html-sync').bootstrapNavFooterData();
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/nav-footer', (req, res) => {
  try {
    createBackup();
    const body = req.body || {};
    const tpl = require('./lib/nav-footer-template');
    let data;
    if (body.nav && body.footer) {
      // Form editor: regenerate navHtml/footerHtml from the structured model.
      data = tpl.buildNavFooterData({ nav: body.nav, footer: body.footer });
    } else {
      // Advanced HTML tab: store raw HTML, keep the existing model untouched.
      const existing = fs.existsSync(NAV_FOOTER_PATH)
        ? JSON.parse(fs.readFileSync(NAV_FOOTER_PATH, 'utf-8')) : {};
      data = {
        ...existing,
        navHtml: body.navHtml != null ? body.navHtml : existing.navHtml,
        footerHtml: body.footerHtml != null ? body.footerHtml : existing.footerHtml,
      };
    }
    fs.writeFileSync(NAV_FOOTER_PATH, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Re-extract nav/footer from the live index.html. Used by the "Mevcut sayfadan
// yeniden içe aktar" button when the user wants to discard their edits and
// start from the canonical source.
app.post('/api/nav-footer/reset', (_req, res) => {
  try {
    createBackup();
    const htmlSync = require('./lib/html-sync');
    // Force re-extract by deleting the saved file first, then bootstrapping.
    if (fs.existsSync(NAV_FOOTER_PATH)) fs.unlinkSync(NAV_FOOTER_PATH);
    const data = htmlSync.bootstrapNavFooterData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/nav-footer/sync', (req, res) => {
  try {
    createBackup();
    const htmlSync = require('./lib/html-sync');
    const result = htmlSync.syncAllPages();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  SOCIAL MEDIA
// ===========================================================================

const SOCIAL_MEDIA_PATH = path.join(__dirname, 'data', 'social-media.json');
// Single source of truth: derive defaults and the allowed-keys list from the
// PLATFORMS table inside social-media-sync.js. Adding a new platform there
// now automatically flows through the API.
const socialSync = require('./lib/social-media-sync');
const SOCIAL_KEYS = socialSync.PLATFORMS.map(p => p.key);
const SOCIAL_MEDIA_DEFAULTS = Object.fromEntries(SOCIAL_KEYS.map(k => [k, '']));
// Seed the most common ones if no file exists yet (matches what the live
// footer already links to).
Object.assign(SOCIAL_MEDIA_DEFAULTS, {
  instagram: 'https://www.instagram.com/balkanmedj/',
  twitter: 'https://x.com/balkanmedj',
  linkedin: 'https://www.linkedin.com/company/balkan-med-j/',
});

// Expose the platform catalog (key + label + svg + color) so the admin UI can
// render icons and labels without duplicating the platform list client-side.
app.get('/api/social-media/platforms', (_req, res) => {
  try {
    res.json(socialSync.PLATFORMS.map(p => ({
      key: p.key, label: p.label, color: p.color, svgPath: p.svgPath, placeholder: p.placeholder,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/social-media', (_req, res) => {
  try {
    if (!fs.existsSync(SOCIAL_MEDIA_PATH)) return res.json(SOCIAL_MEDIA_DEFAULTS);
    const data = JSON.parse(fs.readFileSync(SOCIAL_MEDIA_PATH, 'utf-8'));
    res.json({ ...SOCIAL_MEDIA_DEFAULTS, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/social-media', (req, res) => {
  try {
    const payload = {};
    for (const key of SOCIAL_KEYS) {
      payload[key] = typeof req.body[key] === 'string' ? req.body[key].trim() : '';
    }
    fs.mkdirSync(path.dirname(SOCIAL_MEDIA_PATH), { recursive: true });
    fs.writeFileSync(SOCIAL_MEDIA_PATH, JSON.stringify(payload, null, 2), 'utf-8');
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/social-media/sync', (_req, res) => {
  try {
    if (!fs.existsSync(SOCIAL_MEDIA_PATH)) {
      return res.status(400).json({ error: 'Önce sosyal medya bağlantılarını kaydedin.' });
    }
    createBackup();
    const data = JSON.parse(fs.readFileSync(SOCIAL_MEDIA_PATH, 'utf-8'));
    const socialSync = require('./lib/social-media-sync');
    const result = socialSync.syncSocialMedia(data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
//  ERROR HANDLER
// ===========================================================================
// Catches multer MulterError / fileFilter rejections and any thrown errors
// from route handlers so we return clean JSON instead of stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (!err) return res.status(500).json({ error: 'Sunucu hatası' });
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  // Known-safe messages (from our fileFilter) pass through; everything else is generic in prod.
  const safe = typeof err.message === 'string' && err.message.startsWith('Desteklenmeyen dosya');
  if (IS_PROD && !safe) {
    console.error('[err]', err);
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
  res.status(400).json({ error: err.message || 'Hata' });
});

// ===========================================================================
//  START
// ===========================================================================

app.listen(PORT, () => {
  console.log(`\n  Balkan Medical Journal — Admin Panel`);
  console.log(`  http://localhost:${PORT}\n`);
});
