// E2E test — manual AIP create must wipe any orphan files at the assigned ID
// so the new entry starts blank (no inherited Tam Metin / figures / PDF).
//
// Reproduces the bug the user reported on 2026-05-21: filling only Type and
// Title on "Yeni Baskıda Makale", saving, and finding the new article already
// had a full text and uploaded files — because the assigned ID had stale
// files from a previously-deleted article.

const fs = require('fs');
const path = require('path');
const dio = require('./lib/data-io');

const BASE = process.env.BASE_URL || 'http://localhost:3098';

function pass(n) { console.log('  PASS:', n); }
function fail(n, d) { console.log('  FAIL:', n, d ? '— ' + d : ''); process.exitCode = 1; }

async function api(method, p, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + p, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status}: ${data.error || ''}`);
  return data;
}

(async () => {
  let createdId = null;
  try {
    // ── Step 1: discover what the next ID will be, plant orphan files there.
    console.log('=== Step 1: Plant orphan files at the next AIP ID ===');
    // dio.nextArticleId() is server-side; we replicate it client-side by
    // reading both lists and computing max+1.
    const articles = dio.readArticles();
    const aips = dio.readArticlesInPress();
    const nextId = Math.max(
      ...articles.map((a) => a.id || 0),
      ...aips.map((a) => a.id || 0),
    ) + 1;
    console.log('  Next AIP ID will be:', nextId);

    const figDir = path.join(dio.PATHS.articleImagesDir, String(nextId));
    const ftHtml = path.join(dio.PATHS.articlesDir, String(nextId) + '.html');
    const ftJs   = path.join(dio.PATHS.articlesDir, String(nextId) + '.js');
    const pdfPath = path.join(dio.PATHS.pdfsDir, String(nextId) + '.pdf');
    fs.mkdirSync(figDir, { recursive: true });
    fs.writeFileSync(path.join(figDir, 'orphan-figure.png'), Buffer.from('fake png'));
    fs.writeFileSync(ftHtml, '<p>Orphan full text that should not leak into the new AIP.</p>');
    fs.writeFileSync(ftJs,   "window.ARTICLE_HTML = '<p>orphan</p>';");
    fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\norphan\n%%EOF'));
    pass('orphan files planted on disk');

    // Sanity: confirm they exist before create.
    if (fs.existsSync(ftHtml) && fs.existsSync(pdfPath)) pass('orphans verifiably on disk');
    else fail('orphan planting failed');

    // ── Step 2: create a new AIP via the same endpoint the form uses.
    console.log('=== Step 2: POST /api/articles-in-press with minimal payload ===');
    const created = await api('POST', '/api/articles-in-press', {
      type: 'Invited Review',
      title: 'TEST CLEANUP CHECK ' + Date.now(),
    });
    createdId = created.id;
    if (createdId === nextId) pass(`new AIP got the predicted ID ${createdId}`);
    else fail('AIP got unexpected ID', `expected=${nextId} got=${createdId}`);

    // The response should include the cleanup report.
    if (created._cleanedOrphans && created._cleanedOrphans.fullText && created._cleanedOrphans.pdf) {
      pass('cleanup report indicates orphan PDF + full text were removed');
    } else fail('cleanup report missing or incomplete', JSON.stringify(created._cleanedOrphans));
    if (created._cleanedOrphans && created._cleanedOrphans.figures.length >= 1) {
      pass(`cleanup removed ${created._cleanedOrphans.figures.length} orphan figure(s)`);
    } else fail('orphan figures not reported as cleaned', JSON.stringify(created._cleanedOrphans));

    // ── Step 3: verify disk no longer contains the orphan content.
    console.log('=== Step 3: Verify disk is clean post-create ===');
    if (!fs.existsSync(ftHtml)) pass('orphan full text HTML removed');
    else fail('orphan full text HTML still present', ftHtml);
    if (!fs.existsSync(pdfPath)) pass('orphan PDF removed');
    else fail('orphan PDF still present', pdfPath);
    if (!fs.existsSync(path.join(figDir, 'orphan-figure.png'))) pass('orphan figure removed');
    else fail('orphan figure still present');

    // ── Step 4: the public fulltext endpoint must return empty for this ID.
    console.log('=== Step 4: GET /articles/:id/fulltext returns empty ===');
    const ft = await api('GET', `/api/articles/${createdId}/fulltext`);
    if (!ft.html || ft.html === '') pass('full text endpoint returns empty after creation');
    else fail('full text endpoint leaks orphan content', (ft.html || '').slice(0, 80));

    // ── Step 5: DELETE the AIP and confirm cleanup also runs on delete.
    console.log('=== Step 5: DELETE also wipes disk so the next ID does not inherit ===');
    // Plant a fresh PDF for this ID before deletion to verify delete-time cleanup.
    fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\nplanted\n%%EOF'));
    const deleted = await api('DELETE', `/api/articles-in-press/${createdId}`);
    if (deleted._cleanedOrphans && deleted._cleanedOrphans.pdf) pass('DELETE wipes the PDF');
    else fail('DELETE did not report PDF cleanup', JSON.stringify(deleted._cleanedOrphans));
    if (!fs.existsSync(pdfPath)) pass('PDF physically gone after DELETE');
    else fail('PDF still on disk after DELETE');
    createdId = null; // already deleted

  } catch (e) {
    fail('unexpected error', e.message);
  } finally {
    // Tidy up if test bailed out partway through.
    if (createdId) {
      try { await api('DELETE', `/api/articles-in-press/${createdId}`); } catch (_) {}
    }
  }
})();
