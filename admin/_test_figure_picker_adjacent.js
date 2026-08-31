// Adjacent-surface verification: confirm the SAME multi-figure/ordering fix
// holds in the OTHER figure UIs the user can hit, not just the cross-ref modal:
//   • floating cross-ref bubble (_renderCrossRefBubble) — disk figures shown
//   • cross-ref modal TABLE chips (the .map(t=>t.num) fix, untested before)
//   • openFigurePicker (file-based "Figür Ekle") — every uploaded file listed
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
      const r = await fetch('/api/media/upload/figures/' + tid, { method: 'POST', body: fd });
      return r.json();
    }, tid, names, PNG_B64);
  }
  async function setupEditor(tid, html) {
    await page.evaluate(async (tid, html) => {
      window.location.hash = '#/articles-in-press/' + tid + '/edit';
      let v = document.getElementById('aip-ft-visual');
      if (!v) { v = document.createElement('div'); v.id = 'aip-ft-visual'; v.contentEditable = 'true'; document.body.appendChild(v); }
      v.innerHTML = html;
      const r = await fetch('/api/media/article/' + tid + '/assets');
      window._articleAssets = await r.json();
      // clear any prior bubble
      const b = document.getElementById('cr-bubble'); if (b) b.remove();
    }, tid, html);
  }

  try {
    // ── A) Floating bubble shows BOTH disk-uploaded figures (multi-upload) ──
    const tA = '9990011';
    await upload(tA, ['graph.png', 'chart.png']);
    await setupEditor(tA, '<p>Metin gövdesi, mention yok.</p>');
    const bubble = await page.evaluate(() => {
      _renderCrossRefBubble('aip-ft');
      const b = document.getElementById('cr-bubble');
      if (!b) return { err: 'bubble yok' };
      const figs = Array.from(b.querySelectorAll('[data-kind="figure"][data-num]')).map((x) => Number(x.dataset.num));
      const pending = b.querySelectorAll('[data-kind="figure"] .cr-pending-badge').length;
      return { figs, pending };
    });
    ok('BUBBLE iki disk figürünü gösterir [1,2]', JSON.stringify(bubble.figs) === '[1,2]', JSON.stringify(bubble.figs));
    ok('BUBBLE figürleri "diskte" (pending) rozetli', bubble.pending === 2, 'pending=' + bubble.pending);

    // ── B) Cross-ref MODAL table chips (the .map(t=>t.num) fix) ──
    const tB = '9990012';
    await upload(tB, ['table-1.png', 'table-2.png', 'figure-1.png']);
    await setupEditor(tB, '<p>Tablolar burada.</p>');
    const modal = await page.evaluate(() => {
      openCrossRefPicker('aip-ft');
      const o = document.querySelector('.modal-overlay');
      if (!o) return { err: 'modal yok' };
      const tabs = Array.from(o.querySelectorAll('.cr-pick[data-kind="table"]')).map((b) => ({ num: Number(b.dataset.num), text: (b.textContent || '').trim() }));
      const figs = Array.from(o.querySelectorAll('.cr-pick[data-kind="figure"]')).map((b) => Number(b.dataset.num));
      const cancel = o.querySelector('[data-action="cancel"]'); if (cancel) cancel.click();
      return { tabs, figs };
    });
    ok('MODAL tablo chipleri doğru (Tablo 1, Tablo 2)',
      modal.tabs && modal.tabs.map((t) => t.num).join(',') === '1,2' && modal.tabs.every((t) => /Tablo \d/.test(t.text)),
      JSON.stringify(modal.tabs));
    ok('MODAL figür chip de var ([object Object] yok)',
      modal.figs && modal.figs.join(',') === '1' && !modal.figs.includes(NaN), JSON.stringify(modal.figs));

    // ── C) openFigurePicker lists every uploaded file (file-based) ──
    const tC = '9990013';
    await upload(tC, ['graph.png', 'chart.png', 'diagram.png']);
    await setupEditor(tC, '<p>Gövde.</p>');
    const figPicker = await page.evaluate(async () => {
      await openFigurePicker('aip-ft');
      const o = document.querySelector('.modal-overlay');
      if (!o) return { err: 'modal yok' };
      const tiles = Array.from(o.querySelectorAll('.fig-pick')).map((b) => b.dataset.name);
      const cancel = o.querySelector('[data-action="cancel"]'); if (cancel) cancel.click();
      return { tiles };
    });
    ok('openFigurePicker tüm yüklenen dosyaları listeler (3)',
      figPicker.tiles && figPicker.tiles.length === 3, JSON.stringify(figPicker.tiles));
    ok('openFigurePicker yükleme sırasını korur',
      JSON.stringify(figPicker.tiles) === '["graph.png","chart.png","diagram.png"]', JSON.stringify(figPicker.tiles));
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
