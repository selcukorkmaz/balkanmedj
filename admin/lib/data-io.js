/**
 * Data I/O — Read/write JS data files (window.X = [...]) and JSON files.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const PATHS = {
  articles: path.join(ROOT, 'js/data/articles.js'),
  articlesInPress: path.join(ROOT, 'js/data/articles-in-press.js'),
  archiveIssues: path.join(ROOT, 'js/data/archive-issues.js'),
  editorialBoard: path.join(ROOT, 'js/data/editorial-board.js'),
  editorialExtended: path.join(ROOT, 'js/data/editorial-extended.js'),
  news: path.join(ROOT, 'js/data/news.js'),
  homepageArticles: path.join(ROOT, 'js/data/homepage-articles.js'),
  authorMetadata: path.join(ROOT, 'js/data/author-metadata.js'),
  volumesDir: path.join(ROOT, 'js/data/volumes'),
  articlesDir: path.join(ROOT, 'js/data/articles'),
  pdfsDir: path.join(ROOT, 'js/data/pdfs'),
  imagesDir: path.join(ROOT, 'images'),
};

const VAR_NAMES = {
  articles: 'ARTICLES',
  articlesInPress: 'ARTICLES_IN_PRESS',
  archiveIssues: 'ARCHIVE_ISSUES',
  editorialBoard: 'EDITORIAL_BOARD',
  editorialExtended: 'EDITORIAL_EXTENDED',
  news: 'NEWS',
  homepageArticles: 'HOMEPAGE_DATA',
  authorMetadata: 'AUTHOR_METADATA',
};

/**
 * Read a JS data file with `window.VAR_NAME = ...;` format.
 * Handles both valid JSON and JS object literals (unquoted keys).
 */
function readJsData(filePath, varName) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf-8');
  let body = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(new RegExp(`window\\.${varName}\\s*=\\s*`), '')
    .trim()
    .replace(/;\s*$/, '');
  try {
    return JSON.parse(body);
  } catch {
    // Fallback: handle JS object literals with unquoted keys
    // Quote unquoted property names: word followed by : (not inside strings)
    try {
      body = body.replace(/(?<=[\{\[,\n])\s*([a-zA-Z_]\w*)\s*:/g, ' "$1":');
      return JSON.parse(body);
    } catch (e2) {
      console.error(`[data-io] Failed to parse ${filePath}: ${e2.message}`);
      return [];
    }
  }
}

/**
 * Write a JS data file with `window.VAR_NAME = ...;` format.
 */
function writeJsData(filePath, varName, data, description) {
  const now = new Date().toISOString().slice(0, 10);
  const header =
    '/**\n' +
    ` * Balkan Medical Journal — ${description || varName}\n` +
    ` * Last updated: ${now}\n` +
    ' */\n';
  const body = JSON.stringify(data, null, 2);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, header + `window.${varName} = ${body};\n`, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Read a JSON file (e.g., volume JSONs).
 */
function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Write a JSON file atomically.
 */
function writeJsonFile(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// --- Convenience readers/writers for each data source ---

function readArticles() {
  return readJsData(PATHS.articles, VAR_NAMES.articles);
}
function writeArticles(data) {
  writeJsData(PATHS.articles, VAR_NAMES.articles, data, 'Articles Data');
}

function readArticlesInPress() {
  return readJsData(PATHS.articlesInPress, VAR_NAMES.articlesInPress);
}
function writeArticlesInPress(data) {
  writeJsData(PATHS.articlesInPress, VAR_NAMES.articlesInPress, data, 'Articles in Press');
}

function readArchiveIssues() {
  return readJsData(PATHS.archiveIssues, VAR_NAMES.archiveIssues);
}
function writeArchiveIssues(data) {
  writeJsData(PATHS.archiveIssues, VAR_NAMES.archiveIssues, data, 'Archive Issues');
}

function readEditorialBoard() {
  return readJsData(PATHS.editorialBoard, VAR_NAMES.editorialBoard);
}
function writeEditorialBoard(data) {
  writeJsData(PATHS.editorialBoard, VAR_NAMES.editorialBoard, data, 'Editorial Board');
}

function readEditorialExtended() {
  return readJsData(PATHS.editorialExtended, VAR_NAMES.editorialExtended);
}
function writeEditorialExtended(data) {
  writeJsData(PATHS.editorialExtended, VAR_NAMES.editorialExtended, data, 'Editorial Extended');
}

function readNews() {
  return readJsData(PATHS.news, VAR_NAMES.news);
}
function writeNews(data) {
  writeJsData(PATHS.news, VAR_NAMES.news, data, 'News & Announcements');
}

function readHomepageData() {
  return readJsData(PATHS.homepageArticles, VAR_NAMES.homepageArticles);
}
function writeHomepageData(data) {
  writeJsData(PATHS.homepageArticles, VAR_NAMES.homepageArticles, data, 'Homepage Data');
}

function readAuthorMetadata() {
  return readJsData(PATHS.authorMetadata, VAR_NAMES.authorMetadata);
}
function writeAuthorMetadata(data) {
  writeJsData(PATHS.authorMetadata, VAR_NAMES.authorMetadata, data, 'Author Metadata');
}

// --- Volume JSON helpers ---

function volumeJsonPath(volume, issue) {
  return path.join(PATHS.volumesDir, `vol${volume}-${issue}.json`);
}

function readVolumeJson(volume, issue) {
  const p = volumeJsonPath(volume, issue);
  if (!fs.existsSync(p)) return null;
  return readJsonFile(p);
}

function writeVolumeJson(volume, issue, data) {
  writeJsonFile(volumeJsonPath(volume, issue), data);
}

/**
 * Rebuild a volume JSON from the main articles array.
 */
function rebuildVolumeJson(volume, issue, articles) {
  const filtered = (articles || readArticles()).filter(
    (a) => a.volume === Number(volume) && String(a.issue) === String(issue)
  );
  writeVolumeJson(volume, issue, filtered);
  return filtered.length;
}

// --- Article full text helpers ---

function readFullText(articleId) {
  const htmlPath = path.join(PATHS.articlesDir, `${articleId}.html`);
  if (fs.existsSync(htmlPath)) return fs.readFileSync(htmlPath, 'utf-8');
  const jsPath = path.join(PATHS.articlesDir, `${articleId}.js`);
  if (fs.existsSync(jsPath)) {
    const text = fs.readFileSync(jsPath, 'utf-8');
    const match = text.match(/window\._articleFullText\[\d+\]\s*=\s*"([\s\S]*)"\s*;?\s*$/);
    if (match) return match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  return null;
}

function writeFullText(articleId, html) {
  const htmlPath = path.join(PATHS.articlesDir, `${articleId}.html`);
  const jsPath = path.join(PATHS.articlesDir, `${articleId}.js`);
  // Atomic write for HTML
  const htmlTmp = htmlPath + '.tmp';
  fs.writeFileSync(htmlTmp, html, 'utf-8');
  fs.renameSync(htmlTmp, htmlPath);
  // Atomic write for JS
  const escaped = html.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const jsContent = `window._articleFullText = window._articleFullText || {};\nwindow._articleFullText[${articleId}] = "${escaped}";\n`;
  const jsTmp = jsPath + '.tmp';
  fs.writeFileSync(jsTmp, jsContent, 'utf-8');
  fs.renameSync(jsTmp, jsPath);
}

// --- ID generation ---

function nextArticleId(articles) {
  // Check both main articles and in-press to avoid ID collisions
  const main = articles || readArticles();
  let maxId = main.reduce((max, a) => Math.max(max, a.id || 0), 0);
  try {
    const aip = readArticlesInPress();
    maxId = aip.reduce((max, a) => Math.max(max, a.id || 0), maxId);
  } catch { /* ignore if file missing */ }
  return maxId + 1;
}

function nextNewsId() {
  const arr = readNews();
  return arr.reduce((max, n) => Math.max(max, n.id || 0), 0) + 1;
}

module.exports = {
  ROOT,
  PATHS,
  VAR_NAMES,
  readJsData,
  writeJsData,
  readJsonFile,
  writeJsonFile,
  readArticles,
  writeArticles,
  readArticlesInPress,
  writeArticlesInPress,
  readArchiveIssues,
  writeArchiveIssues,
  readEditorialBoard,
  writeEditorialBoard,
  readEditorialExtended,
  writeEditorialExtended,
  readNews,
  writeNews,
  readHomepageData,
  writeHomepageData,
  readAuthorMetadata,
  writeAuthorMetadata,
  readVolumeJson,
  writeVolumeJson,
  rebuildVolumeJson,
  volumeJsonPath,
  readFullText,
  writeFullText,
  nextArticleId,
  nextNewsId,
};
