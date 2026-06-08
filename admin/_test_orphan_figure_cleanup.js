// Reproduces the reported bug: figures deleted from Dosyalar still appear in the
// Tam Metin pop-up because their <figure> block lingers in the saved full text.
// Verifies the two-part fix:
//   A) SERVER: deleting a figure file strips its <figure> block from the saved
//      full-text HTML (so it's gone for good — public page + picker).
//   B) CLIENT: _pruneOrphanArticleMedia removes placed blocks whose backing file
//      is already missing (cleans pre-existing orphans on full-text load).
//
// Requires server with BMJ_TEST_BYPASS_AUTH=1 on BASE_URL.
const puppeteer = require('puppeteer');
const BASE = process.env.BASE_URL || 'http://localhost:3099';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let failures = 0;
function ok(name, cond, detail) {
  console.log((cond ? '✓' : '✗') + ' ' + name + (detail ? '  — ' + detail : ''));
  if (!cond) failures++;
}

function figureBlocksHtml(tid) {
  const base = `images/articles/${tid}/`;
  return '<p>Giriş.</p>' +
    `<figure id="figure-1" class="article-figure" data-size="medium"><img src="${base}figure-1.png" alt="Figure 1" loading="lazy"><p><strong>FIG. 1.</strong> XXXX</p></figure>` +
    '<p>Orta paragraf <a href="#figure-2" class="article-media-ref-link">Figure 2</a>.</p>' +
    `<figure id="figure-2" class="article-figure" data-size="medium"><img src="${base}figure-2.png" alt="Figure 2" loading="lazy"><p><strong>FIG. 2.</strong> ZZZZ</p></figure>`;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });

  async function upload(tid, names) {
    return page.evaluate(async (tid, names, b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const fd = new FormData();
      for (const n of names) fd.append('figures', new Blob([arr], { type: 'image/png' }), n);
      await fetch('/api/media/upload/figures/' + tid, { method: 'POST', body: fd });
    }, tid, names, PNG_B64);
  }

  try {
    // ── A) SERVER: delete strips the block from the saved full text ──────────
    const tA = '9990030';
    await upload(tA, ['figure-1.png', 'figure-2.png']);
    await page.evaluate(async (tid, html) => {
      await fetch('/api/articles/' + tid + '/fulltext', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html }),
      });
    }, tA, figureBlocksHtml(tA));

    const delResp = await page.evaluate(async (tid) => {
      const r = await fetch('/api/media/article/' + tid + '/figures/figure-1.png', { method: 'DELETE' });
      return r.json();
    }, tA);
    ok('A: DELETE yanıtı fullTextRemoved=1', delResp.fullTextRemoved === 1, JSON.stringify(delResp));

    const afterHtml = await page.evaluate(async (tid) => {
      const r = await fetch('/api/articles/' + tid + '/fulltext');
      return (await r.json()).html;
    }, tA);
    ok('A: figure-1 bloğu kaydedilmiş tam metinden çıkarıldı',
      !/figure-1\.png/.test(afterHtml) && !/id="figure-1"/.test(afterHtml), 'figure-1 ref kaldı mı?');
    ok('A: figure-2 bloğu korunur', /figure-2\.png/.test(afterHtml) && /id="figure-2"/.test(afterHtml));

    // ── B) CLIENT: prune orphan blocks whose file is already gone ────────────
    // Disk now has only figure-2.png (figure-1.png deleted above won't apply —
    // use a fresh article: upload only figure-2.png, but body references both).
    const tB = '9990031';
    await upload(tB, ['figure-2.png']); // figure-1.png intentionally NOT uploaded
    const pruneResult = await page.evaluate(async (tid, html) => {
      const v = document.createElement('div');
      v.id = 'aip-ft-visual'; v.contentEditable = 'true';
      document.body.appendChild(v);
      v.innerHTML = html;
      const removed = await _pruneOrphanArticleMedia(v, tid);
      return {
        removed,
        figIds: Array.from(v.querySelectorAll('figure[id^="figure-"]')).map((f) => f.id),
      };
    }, tB, figureBlocksHtml(tB));
    ok('B: 1 orphan blok kaldırıldı (figure-1, dosyası yok)', pruneResult.removed === 1, 'removed=' + pruneResult.removed);
    ok('B: editörde sadece figure-2 kaldı (dosyası var)',
      JSON.stringify(pruneResult.figIds) === '["figure-2"]', JSON.stringify(pruneResult.figIds));

    // ── C) Safety: when NO files are missing, prune removes nothing ──────────
    const tC = '9990032';
    await upload(tC, ['figure-1.png', 'figure-2.png']);
    const safeResult = await page.evaluate(async (tid, html) => {
      const v = document.createElement('div'); v.id = 'aip-ft-visual'; document.body.appendChild(v);
      v.innerHTML = html;
      const removed = await _pruneOrphanArticleMedia(v, tid);
      const figIds = Array.from(v.querySelectorAll('figure[id^="figure-"]')).map((f) => f.id);
      v.remove();
      return { removed, figIds };
    }, tC, figureBlocksHtml(tC));
    ok('C: tüm dosyalar mevcutken hiçbir şey kaldırılmaz', safeResult.removed === 0 &&
      JSON.stringify(safeResult.figIds) === '["figure-1","figure-2"]', JSON.stringify(safeResult));
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
