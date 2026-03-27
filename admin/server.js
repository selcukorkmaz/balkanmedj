/**
 * Balkan Medical Journal — Admin Panel Server
 * Usage: cd admin && npm install && node server.js
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dio = require('./lib/data-io');
const { createBackup, listBackups } = require('./lib/backup');
const { parseJatsXml } = require('./lib/jats-parser');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// File upload setup
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 100 * 1024 * 1024 },
});

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

app.post('/api/jats/parse', upload.single('xml'), async (req, res) => {
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
    const { parsedArticle, fullTextHtml } = req.body;
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
      pmid: '',
      relatedArticles: parsedArticle.relatedArticles || [],
    };

    articles.unshift(article);
    dio.writeArticles(articles);

    // Write full text
    const ftHtml = fullTextHtml || parsedArticle.fullTextHtml || '';
    if (ftHtml) {
      dio.writeFullText(id, ftHtml);
    }

    // Rebuild volume JSON
    if (article.volume && article.issue) {
      dio.rebuildVolumeJson(article.volume, article.issue, articles);
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

app.post('/api/jats/parse-batch', upload.array('xml', 100), async (req, res) => {
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
//  MEDIA UPLOAD
// ===========================================================================

app.post('/api/media/upload/pdf', upload.single('pdf'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const articleId = req.body.articleId || path.parse(req.file.originalname).name;
    const dest = path.join(dio.PATHS.pdfsDir, `${articleId}.pdf`);
    fs.renameSync(req.file.path, dest);

    const pdfUrl = `js/data/pdfs/${articleId}.pdf`;
    res.json({ pdfUrl, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/media/upload/image', upload.single('image'), (req, res) => {
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
//  START
// ===========================================================================

app.listen(PORT, () => {
  console.log(`\n  Balkan Medical Journal — Admin Panel`);
  console.log(`  http://localhost:${PORT}\n`);
});
