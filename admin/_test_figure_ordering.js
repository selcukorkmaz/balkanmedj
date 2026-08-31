// Comprehensive test for the figure cross-ref numbering/ordering fix.
//
// Reproduces the reported bug ("only the first uploaded figure shows; multi-
// upload order is wrong") and verifies the fix end to end:
//   • server preserves upload order in _figure-meta.json and /assets returns it
//   • _resolveMediaSequence assigns stable, distinct, ordered numbers
//   • _scanCrossRefTargets (the picker) surfaces EVERY uploaded figure
//
// Requires the server running with BMJ_TEST_BYPASS_AUTH=1 on BASE_URL.
const puppeteer = require('puppeteer');
const BASE = process.env.BASE_URL || 'http://localhost:3099';

let failures = 0;
function ok(name, cond, detail) {
  console.log((cond ? '✓' : '✗') + ' ' + name + (detail ? '  — ' + detail : ''));
  if (!cond) failures++;
}

// 1x1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });

  // Upload a set of named files (in the given order) to a throwaway article id.
  async function upload(tid, names) {
    return page.evaluate(async (tid, names, b64) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const fd = new FormData();
      for (const n of names) fd.append('figures', new Blob([arr], { type: 'image/png' }), n);
      const r = await fetch('/api/media/upload/figures/' + tid, { method: 'POST', body: fd });
      return r.json();
    }, tid, names, PNG_B64);
  }
  async function getAssets(tid) {
    return page.evaluate(async (tid) => {
      const r = await fetch('/api/media/article/' + tid + '/assets');
      return r.json();
    }, tid);
  }
  async function resolve(figs) {
    return page.evaluate((figs) => _resolveMediaSequence(figs), figs);
  }
  // Drive the actual picker scanner with these assets and no editor DOM.
  async function pickerFigures(figs) {
    return page.evaluate((figs) => {
      window._articleAssets = { figures: figs, supplementary: [] };
      const t = _scanCrossRefTargets('no-such-editor');
      return { figures: t.figures.map((f) => f.num), tables: t.tables.map((t2) => t2.num) };
    }, figs);
  }

  try {
    // ── Case 1: arbitrary unparseable names, two figures, upload order A,B ──
    const t1 = '9990001';
    await upload(t1, ['graph.png', 'chart.png']);
    const a1 = await getAssets(t1);
    ok('C1 her iki figür de /assets içinde', a1.figures.length === 2, a1.figures.map((f) => f.filename).join(','));
    ok('C1 upload sırası korunur (graph, chart)',
      a1.figures[0].filename === 'graph.png' && a1.figures[1].filename === 'chart.png');
    ok('C1 order indeksleri atanmış', a1.figures[0].order === 0 && a1.figures[1].order === 1,
      `order=${a1.figures.map((f) => f.order).join(',')}`);
    const r1 = await resolve(a1.figures);
    ok('C1 iki ayrı figür numarası (1,2)', JSON.stringify(r1.figure.map((b) => b.num)) === '[1,2]');
    ok('C1 sıra graph→1, chart→2',
      r1.figure[0].panels[0].filename === 'graph.png' && r1.figure[1].panels[0].filename === 'chart.png');
    const p1 = await pickerFigures(a1.figures);
    ok('C1 PICKER her iki figürü gösterir [1,2]', JSON.stringify(p1.figures) === '[1,2]', JSON.stringify(p1.figures));

    // ── Case 2: colliding parsed numbers (both look like figure 1) ──
    const t2 = '9990002';
    await upload(t2, ['fig1.png', 'fig1_alt.png']);
    const a2 = await getAssets(t2);
    const r2 = await resolve(a2.figures);
    ok('C2 çakışan numaralar ayrıştırılır (distinct)',
      new Set(r2.figure.map((b) => b.num)).size === r2.figure.length && r2.figure.length === 2,
      JSON.stringify(r2.figure.map((b) => b.num)));
    const p2 = await pickerFigures(a2.figures);
    ok('C2 PICKER iki figür gösterir (sadece ilki değil)', p2.figures.length === 2, JSON.stringify(p2.figures));

    // ── Case 3: well-named JATS set must keep its exact numbers ──
    const t3 = '9990003';
    await upload(t3, ['figure-2.png', 'figure-1.png', 'figure-10.png']);
    const a3 = await getAssets(t3);
    const r3 = await resolve(a3.figures);
    ok('C3 doğru adlı figürler numaralarını korur (1,2,10)',
      JSON.stringify(r3.figure.map((b) => b.num)) === '[1,2,10]', JSON.stringify(r3.figure.map((b) => b.num)));

    // ── Case 4: panels collapse onto one parent number ──
    const t4 = '9990004';
    await upload(t4, ['figure-1a.png', 'figure-1b.png', 'figure-2.png']);
    const a4 = await getAssets(t4);
    const r4 = await resolve(a4.figures);
    ok('C4 paneller tek figüre toplanır (1,2)',
      JSON.stringify(r4.figure.map((b) => b.num)) === '[1,2]', JSON.stringify(r4.figure.map((b) => b.num)));
    ok('C4 figür-1 iki panel taşır', r4.figure[0].panels.length === 2, 'panels=' + r4.figure[0].panels.length);

    // ── Case 5: tables and figures separated ──
    const t5 = '9990005';
    await upload(t5, ['table-1.png', 'figure-1.png']);
    const a5 = await getAssets(t5);
    const r5 = await resolve(a5.figures);
    ok('C5 figür ve tablo ayrı', r5.figure.length === 1 && r5.table.length === 1,
      `fig=${r5.figure.length} tab=${r5.table.length}`);

    // ── Case 6: re-upload keeps order slot (no reshuffle) ──
    const t6 = '9990006';
    await upload(t6, ['a.png', 'b.png']);
    await upload(t6, ['a.png']); // replace a.png
    const a6 = await getAssets(t6);
    ok('C6 yeniden yükleme sırayı bozmaz (a,b)',
      a6.figures[0].filename === 'a.png' && a6.figures[1].filename === 'b.png',
      a6.figures.map((f) => `${f.filename}:${f.order}`).join(','));
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
