/**
 * Short-link manager: maintain a code -> URL table and generate static
 * /s/{code}.html redirect files that work on any static host.
 *
 * Why static HTML and not server routes? The site is deployed as plain files.
 * A meta-refresh + JS fallback works everywhere without server config.
 */

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./data-io');

const STORE_PATH = path.join(__dirname, '..', 'data', 'page-short-codes.json');
const REDIRECTS_DIR = path.join(ROOT, 's');

// Reserved codes that would conflict with the site or admin paths.
const RESERVED = new Set([
  'admin', 'api', 'login', 'logout', 's', 'js', 'css', 'images',
  'index', 'site', 'imports', 'data', 'files',
]);

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    const txt = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(txt);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeStore(map) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(map, null, 2), 'utf-8');
}

function validateCode(code) {
  if (!code) return 'Kısa link kodu boş olamaz';
  const c = String(code).toLowerCase().trim();
  if (c.length < 2) return 'En az 2 karakter olmalı';
  if (c.length > 30) return 'En fazla 30 karakter olabilir';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(c) && !/^[a-z0-9]$/.test(c))
    return 'Yalnızca küçük harf, rakam ve tire — başta/sonda tire olamaz';
  if (RESERVED.has(c)) return `"${c}" rezerve bir kod, başka bir şey seçin`;
  return null;
}

function normalizeCode(code) {
  return String(code || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Build the static redirect HTML page. Uses three layers so it works in
 * every browser and even with JS disabled:
 *  1) <meta http-equiv="refresh"> — primary mechanism
 *  2) <link rel="canonical"> — SEO points search engines at the real page
 *  3) <script> location.replace — instant client-side redirect
 *  4) <a> tag — last-resort manual link for the user
 */
function buildRedirectHtml({ code, targetFile, title }) {
  // Relative path from /s/{code}.html back to /{targetFile}
  const target = '../' + targetFile;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redirecting… — Balkan Medical Journal</title>
<meta http-equiv="refresh" content="0; url=${target}">
<link rel="canonical" href="/${targetFile}">
<meta name="robots" content="noindex,follow">
<style>body{font-family:Inter,system-ui,sans-serif;background:#f9fafb;color:#374151;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem;text-align:center}main{max-width:480px}a{color:#0f766e;text-decoration:underline}</style>
</head>
<body>
<main>
<p>Yönlendiriliyor: <strong>${title || targetFile}</strong>…</p>
<p>Otomatik açılmazsa <a href="${target}">buraya tıklayın</a>.</p>
</main>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>
`;
}

function ensureRedirectsDir() {
  if (!fs.existsSync(REDIRECTS_DIR)) fs.mkdirSync(REDIRECTS_DIR, { recursive: true });
}

/**
 * Write the static redirect file for a single code -> page mapping.
 */
function writeRedirectFile(code, targetFile, title) {
  ensureRedirectsDir();
  const filePath = path.join(REDIRECTS_DIR, `${code}.html`);
  const html = buildRedirectHtml({ code, targetFile, title });
  fs.writeFileSync(filePath, html, 'utf-8');
  return filePath;
}

function deleteRedirectFile(code) {
  const filePath = path.join(REDIRECTS_DIR, `${code}.html`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/**
 * Re-emit the human-readable /s/index.html listing every active short link.
 */
function rebuildIndex(allMappings) {
  ensureRedirectsDir();
  const rows = Object.entries(allMappings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, info]) => `      <tr><td><a href="${code}.html"><code>/s/${code}</code></a></td><td>${info.title || info.targetFile}</td><td><a href="../${info.targetFile}">${info.targetFile}</a></td></tr>`)
    .join('\n');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Short Links — Balkan Medical Journal</title>
<meta name="robots" content="noindex,nofollow">
<style>body{font-family:Inter,system-ui,sans-serif;color:#111827;max-width:760px;margin:2rem auto;padding:0 1rem}h1{font-size:1.25rem}table{width:100%;border-collapse:collapse;margin-top:1rem;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb}th{color:#6b7280;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.04em}code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}a{color:#0f766e}</style>
</head>
<body>
<h1>Short Links</h1>
<p style="color:#6b7280;font-size:13px">${Object.keys(allMappings).length} active redirect${Object.keys(allMappings).length === 1 ? '' : 's'}. Yönetim için admin panelini kullanın.</p>
<table>
<thead><tr><th>Short URL</th><th>Sayfa</th><th>Hedef Dosya</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="3" style="text-align:center;color:#9ca3af">Henüz tanımlı kısa link yok.</td></tr>'}
</tbody>
</table>
</body>
</html>
`;
  fs.writeFileSync(path.join(REDIRECTS_DIR, 'index.html'), html, 'utf-8');
}

/**
 * Reconcile the file system with the store: write missing redirect files,
 * delete orphaned ones. Used at startup to handle external edits.
 */
function rebuildAll() {
  const map = readStore();
  ensureRedirectsDir();
  // Delete any .html files in /s/ that no longer have a mapping
  const existing = fs.readdirSync(REDIRECTS_DIR).filter(f => f.endsWith('.html') && f !== 'index.html');
  const wanted = new Set(Object.keys(map).map(c => `${c}.html`));
  for (const f of existing) {
    if (!wanted.has(f)) fs.unlinkSync(path.join(REDIRECTS_DIR, f));
  }
  for (const [code, info] of Object.entries(map)) {
    writeRedirectFile(code, info.targetFile, info.title);
  }
  rebuildIndex(map);
}

function setCode(slug, code, targetFile, title) {
  const err = validateCode(code);
  if (err) throw new Error(err);
  const c = normalizeCode(code);
  const map = readStore();
  // If this code is already used by a different slug → conflict
  if (map[c] && map[c].slug !== slug) {
    throw new Error(`Bu kısa link kodu "${c}" zaten "${map[c].slug}" sayfası için kullanılıyor`);
  }
  // If this slug previously had a different code, remove the old file
  const oldCode = Object.entries(map).find(([, v]) => v.slug === slug)?.[0];
  if (oldCode && oldCode !== c) {
    delete map[oldCode];
    deleteRedirectFile(oldCode);
  }
  map[c] = { slug, targetFile, title, createdAt: map[c]?.createdAt || new Date().toISOString() };
  writeStore(map);
  writeRedirectFile(c, targetFile, title);
  rebuildIndex(map);
  return { code: c, ...map[c] };
}

function removeCode(code) {
  const c = normalizeCode(code);
  const map = readStore();
  if (!map[c]) return false;
  delete map[c];
  writeStore(map);
  deleteRedirectFile(c);
  rebuildIndex(map);
  return true;
}

function removeBySlug(slug) {
  const map = readStore();
  const entry = Object.entries(map).find(([, v]) => v.slug === slug);
  if (!entry) return false;
  return removeCode(entry[0]);
}

function getBySlug(slug) {
  const map = readStore();
  const entry = Object.entries(map).find(([, v]) => v.slug === slug);
  if (!entry) return null;
  return { code: entry[0], ...entry[1] };
}

function listAll() {
  const map = readStore();
  return Object.entries(map).map(([code, info]) => ({ code, ...info }));
}

module.exports = {
  STORE_PATH,
  REDIRECTS_DIR,
  RESERVED,
  validateCode,
  normalizeCode,
  setCode,
  removeCode,
  removeBySlug,
  getBySlug,
  listAll,
  rebuildAll,
  readStore,
};
