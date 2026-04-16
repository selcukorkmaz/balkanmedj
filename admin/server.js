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
const { createBackup, listBackups } = require('./lib/backup');
const { parseJatsXml } = require('./lib/jats-parser');
const zipImporter = require('./lib/zip-importer');

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

// --- Auth middleware ---
function requireAuth(req, res, next) {
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

// File upload setup
const ALLOWED_MIME = {
  pdf: new Set(['application/pdf']),
  image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']),
  xml: new Set(['application/xml', 'text/xml']),
  zip: new Set(['application/zip', 'application/x-zip-compressed', 'application/octet-stream']),
  // figures = images + pdf; supplementary = broadly allowed (video/audio/doc/csv/zip)
  figure: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf']),
  supplementary: new Set([
    'application/pdf', 'application/zip', 'application/x-zip-compressed',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/ogg',
    'text/csv', 'text/plain',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
};
const ALLOWED_EXT = {
  pdf: /\.pdf$/i,
  image: /\.(jpe?g|png|webp|gif|svg)$/i,
  xml: /\.xml$/i,
  zip: /\.zip$/i,
  figure: /\.(jpe?g|png|webp|gif|svg|pdf)$/i,
  supplementary: /\.(pdf|zip|jpe?g|png|webp|gif|svg|mp4|mov|webm|mp3|wav|ogg|csv|txt|docx?|xlsx?)$/i,
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

    // Mark hasFullText
    const articles = dio.readArticles();
    const idx = articles.findIndex((a) => a.id === id);
    if (idx !== -1 && !articles[idx].hasFullText) {
      articles[idx].hasFullText = true;
      dio.writeArticles(articles);
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

app.post('/api/articles-in-press', (req, res) => {
  try {
    createBackup();
    const aip = dio.readArticlesInPress();
    const newArt = {
      id: dio.nextArticleId(),
      order: aip.length + 1,
      aheadOfPrint: true,
      volume: null,
      issue: '',
      pages: '',
      published: '',
      ...req.body,
    };
    aip.push(newArt);
    dio.writeArticlesInPress(aip);
    res.status(201).json(newArt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/articles-in-press/:id', (req, res) => {
  try {
    createBackup();
    const aip = dio.readArticlesInPress();
    const idx = aip.findIndex((a) => a.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    aip[idx] = { ...aip[idx], ...req.body, id: aip[idx].id };
    dio.writeArticlesInPress(aip);
    res.json(aip[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/articles-in-press/:id', (req, res) => {
  try {
    createBackup();
    const aip = dio.readArticlesInPress();
    const idx = aip.findIndex((a) => a.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    aip.splice(idx, 1);
    dio.writeArticlesInPress(aip);
    res.json({ deleted: true });
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

app.get('/api/article-types', (_req, res) => {
  try {
    const articles = dio.readArticles();
    const typeCounts = {};
    for (const a of articles) {
      typeCounts[a.type || 'Unknown'] = (typeCounts[a.type || 'Unknown'] || 0) + 1;
    }
    const types = Object.entries(typeCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/article-types/rename', (req, res) => {
  try {
    createBackup();
    const { oldName, newName } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' });

    const articles = dio.readArticles();
    let count = 0;
    for (const a of articles) {
      if (a.type === oldName) {
        a.type = newName;
        count++;
      }
    }
    dio.writeArticles(articles);
    res.json({ renamed: count });
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
    const { articleIds, volume, issue } = req.body;
    if (!articleIds?.length || !volume || !issue) {
      return res.status(400).json({ error: 'articleIds, volume, issue required' });
    }

    const aip = dio.readArticlesInPress();
    const articles = dio.readArticles();
    const moved = [];

    for (const id of articleIds) {
      const idx = aip.findIndex((a) => a.id === id);
      if (idx === -1) continue;

      const article = aip.splice(idx, 1)[0];
      article.volume = Number(volume);
      article.issue = String(issue);
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

// Batch PDF upload — match to articles by filename (e.g., 2805.pdf → article #2805)
app.post('/api/media/upload/pdf-batch', uploadPdf.array('pdf', 200), (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files' });

    const articles = dio.readArticles();
    const matched = [];
    const unmatched = [];

    for (const file of req.files) {
      const baseName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const articleId = parseInt(baseName);
      const dest = path.join(dio.PATHS.pdfsDir, `${baseName}.pdf`);
      fs.renameSync(file.path, dest);

      const pdfUrl = `js/data/pdfs/${baseName}.pdf`;

      // Try to match to an article by ID
      const article = articleId ? articles.find((a) => a.id === articleId) : null;
      if (article) {
        article.pdfUrl = pdfUrl;
        article.localPdfUrl = pdfUrl;
        matched.push({ id: article.id, title: article.title, pdfUrl });
      } else {
        unmatched.push({ filename: file.originalname, pdfUrl });
      }
    }

    if (matched.length) {
      dio.writeArticles(articles);
    }

    res.json({ matched, unmatched, totalMatched: matched.length, totalUnmatched: unmatched.length });
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
    const figures = fs.existsSync(articleDir)
      ? fs.readdirSync(articleDir).filter((f) => !f.startsWith('.')).map((f) => ({ filename: f, url: `images/articles/${articleId}/${f}` }))
      : [];
    const supplementary = fs.existsSync(suppDir)
      ? fs.readdirSync(suppDir).filter((f) => !f.startsWith('.')).map((f) => ({ filename: f, url: `js/data/supplementary/${articleId}/${f}` }))
      : [];
    res.json({ articleId, figures, supplementary });
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

    res.json({ articleId, uploaded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update article full text HTML to use uploaded figure paths
app.post('/api/media/figures/:articleId/apply', (req, res) => {
  try {
    const articleId = String(req.params.articleId).replace(/[^a-zA-Z0-9._-]/g, '_');
    const { mappings } = req.body; // [{originalHref: "fig1.tif", newUrl: "images/articles/123/fig1.jpg"}, ...]
    if (!mappings?.length) return res.status(400).json({ error: 'mappings required' });

    let html = dio.readFullText(articleId);
    if (!html) return res.status(404).json({ error: 'Full text not found' });

    let replaced = 0;
    for (const m of mappings) {
      const escaped = m.originalHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`src="${escaped}"`, 'g');
      const newSrc = `src="${m.newUrl}"`;
      if (html.includes(`src="${m.originalHref}"`)) {
        html = html.replace(regex, newSrc);
        replaced++;
      }
    }

    dio.writeFullText(articleId, html);
    res.json({ replaced, articleId });
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

    res.json({ articleId, uploaded });
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

const EDITABLE_PAGES = [
  { slug: 'about', file: 'about.html', title: 'About the Journal' },
  { slug: 'for-authors', file: 'for-authors.html', title: 'For Authors' },
  { slug: 'for-reviewers', file: 'for-reviewers.html', title: 'For Reviewers' },
  { slug: 'policies', file: 'policies.html', title: 'Policies' },
  { slug: 'contact', file: 'contact.html', title: 'Contact' },
  { slug: 'forms', file: 'forms.html', title: 'Forms' },
  { slug: 'journal-metrics', file: 'journal-metrics.html', title: 'Journal Metrics' },
];

app.get('/api/pages', (_req, res) => {
  res.json(EDITABLE_PAGES);
});

app.get('/api/pages/:slug', (req, res) => {
  try {
    const page = EDITABLE_PAGES.find((p) => p.slug === req.params.slug);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    const filePath = path.join(dio.ROOT, page.file);
    const html = fs.readFileSync(filePath, 'utf-8');

    // Extract content between <main id="main-content"> and </main>
    const mainMatch = html.match(/<main\s+id="main-content"[^>]*>([\s\S]*?)<\/main>/);
    const content = mainMatch ? mainMatch[1].trim() : '';

    res.json({ ...page, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pages/:slug', (req, res) => {
  try {
    createBackup();
    const page = EDITABLE_PAGES.find((p) => p.slug === req.params.slug);
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

// ===========================================================================
//  NAV / FOOTER
// ===========================================================================

const NAV_FOOTER_PATH = path.join(__dirname, 'data', 'nav-footer.json');

app.get('/api/nav-footer', (_req, res) => {
  try {
    if (!fs.existsSync(NAV_FOOTER_PATH)) {
      return res.json({ nav: { items: [] }, footer: { columns: [], social: [] } });
    }
    res.json(JSON.parse(fs.readFileSync(NAV_FOOTER_PATH, 'utf-8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/nav-footer', (req, res) => {
  try {
    createBackup();
    fs.writeFileSync(NAV_FOOTER_PATH, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ saved: true });
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
const SOCIAL_MEDIA_DEFAULTS = {
  instagram: 'https://www.instagram.com/balkanmedj/',
  twitter: 'https://x.com/balkanmedj',
  linkedin: 'https://www.linkedin.com/company/balkan-med-j/',
  facebook: '',
  youtube: '',
};

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
    const allowed = ['instagram', 'twitter', 'linkedin', 'facebook', 'youtube'];
    const payload = {};
    for (const key of allowed) {
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
