// Verifies that deleting a figure in the Dosyalar tab is reflected 1:1 in the
// Tam Metin cross-ref UIs:
//   • the placed <figure> block is removed from the full-text editor body
//   • the open floating bubble drops the deleted figure immediately
//   • the cross-ref modal no longer lists it
//   • an in-text cross-ref to the deleted figure is flagged broken
//   • a NON-deleted figure (and its block/anchor) is left intact
//
// Requires server with BMJ_TEST_BYPASS_AUTH=1 on BASE_URL.
const puppeteer = require('puppeteer');
const BASE = process.env.BASE_URL || 'http://localhost:3099';
const TID = '9990020';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let failures = 0;
function ok(name, cond, detail) {
  console.log((cond ? '✓' : '✗') + ' ' + name + (detail ? '  — ' + detail : ''));
  if (!cond) failures++;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });

  try {
    // Upload two figures.
    await page.evaluate(async (tid, b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const fd = new FormData();
      for (const n of ['figure-1.png', 'figure-2.png']) fd.append('figures', new Blob([arr], { type: 'image/png' }), n);
      await fetch('/api/media/upload/figures/' + tid, { method: 'POST', body: fd });
    }, TID, PNG_B64);

    // Build a full-text editor with BOTH figures PLACED in the body + an in-text
    // cross-ref pointing at figure-1.
    await page.evaluate(async (tid) => {
      window.location.hash = '#/articles-in-press/' + tid + '/edit';
      let v = document.getElementById('aip-ft-visual');
      if (!v) { v = document.createElement('div'); v.id = 'aip-ft-visual'; v.contentEditable = 'true'; document.body.appendChild(v); }
      const base = 'images/articles/' + tid + '/';
      v.innerHTML =
        '<p>İlk bulgu <a href="#figure-1" class="article-media-ref-link">Figure 1</a> içinde.</p>' +
        '<figure id="figure-1" class="article-figure"><img src="' + base + 'figure-1.png"><p>FIG. 1. Caption A</p></figure>' +
        '<p>İkinci bulgu Figure 2 içinde.</p>' +
        '<figure id="figure-2" class="article-figure"><img src="' + base + 'figure-2.png"><p>FIG. 2. Caption B</p></figure>';
      const r = await fetch('/api/media/article/' + tid + '/assets');
      window._articleAssets = await r.json();
      // Open the bubble and force it visible (simulating the user looking at it).
      _renderCrossRefBubble('aip-ft');
      const b = document.getElementById('cr-bubble');
      if (b) b.classList.remove('hidden');
      // Auto-confirm the delete dialog.
      window.confirmAction = async () => true;
    }, TID);

    const before = await page.evaluate(() => {
      const b = document.getElementById('cr-bubble');
      return {
        bodyFigs: Array.from(document.querySelectorAll('#aip-ft-visual figure[id^="figure-"]')).map((f) => f.id),
        bubbleFigs: Array.from(b.querySelectorAll('[data-kind="figure"][data-num]')).map((x) => Number(x.dataset.num)),
        assets: (window._articleAssets.figures || []).map((f) => f.filename),
      };
    });
    ok('başlangıç: gövdede 2 figür', JSON.stringify(before.bodyFigs) === '["figure-1","figure-2"]', JSON.stringify(before.bodyFigs));
    ok('başlangıç: bubble 2 figür', JSON.stringify(before.bubbleFigs) === '[1,2]', JSON.stringify(before.bubbleFigs));

    // Delete figure-1 via the real Dosyalar delete function.
    await page.evaluate(async (tid) => { await deleteUploadedFigure(tid, 'figure-1.png'); }, TID);
    await new Promise((r) => setTimeout(r, 400));

    const after = await page.evaluate(() => {
      const b = document.getElementById('cr-bubble');
      const a1 = document.querySelector('#aip-ft-visual a[href="#figure-1"]');
      return {
        bodyFigs: Array.from(document.querySelectorAll('#aip-ft-visual figure[id^="figure-"]')).map((f) => f.id),
        bubbleFigs: Array.from(b.querySelectorAll('[data-kind="figure"][data-num]')).map((x) => Number(x.dataset.num)),
        assets: (window._articleAssets.figures || []).map((f) => f.filename),
        anchorBroken: a1 ? a1.classList.contains('article-ref-broken') : null,
      };
    });
    ok('silme: gövdeden figure-1 bloğu kaldırıldı, figure-2 kaldı',
      JSON.stringify(after.bodyFigs) === '["figure-2"]', JSON.stringify(after.bodyFigs));
    ok('silme: bubble artık sadece figür 2 gösterir',
      JSON.stringify(after.bubbleFigs) === '[2]', JSON.stringify(after.bubbleFigs));
    ok('silme: /assets önbelleğinde figure-1.png yok',
      !after.assets.includes('figure-1.png') && after.assets.includes('figure-2.png'), JSON.stringify(after.assets));
    ok('silme: #figure-1 atıfı kırık olarak işaretlendi', after.anchorBroken === true, 'broken=' + after.anchorBroken);

    // Modal also reflects the deletion (fresh scan).
    const modalFigs = await page.evaluate(() => {
      openCrossRefPicker('aip-ft');
      const o = document.querySelector('.modal-overlay');
      const figs = Array.from(o.querySelectorAll('.cr-pick[data-kind="figure"]')).map((b) => Number(b.dataset.num));
      const cancel = o.querySelector('[data-action="cancel"]'); if (cancel) cancel.click();
      return figs;
    });
    ok('silme: MODAL da sadece figür 2 gösterir', JSON.stringify(modalFigs) === '[2]', JSON.stringify(modalFigs));
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
