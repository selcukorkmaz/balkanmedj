// End-to-end test of the EXACT user flow:
//   "Dosyalar sekmesinden iki figür yükle → metne etiketlemek için Atıf Ekle
//    picker'ını aç → ikisi de doğru sırada görünmeli → birini seç → Otomatik
//    Düzenle ile yerleştir → seçilen numara ikinci yüklenen dosyaya gitmeli."
//
// Drives the real openCrossRefPicker modal + insertCrossRef + _autoArrangeFullText
// against a hand-built editor DOM (no real article data touched). Cleans up the
// throwaway figure dir afterwards (done by the PowerShell wrapper).
//
// Requires server running with BMJ_TEST_BYPASS_AUTH=1 on BASE_URL.
const puppeteer = require('puppeteer');
const BASE = process.env.BASE_URL || 'http://localhost:3099';
const TID = '9990010';
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
    // 1) Upload two arbitrarily-named figures in order: graph.png then chart.png
    const up = await page.evaluate(async (tid, names, b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const fd = new FormData();
      for (const n of names) fd.append('figures', new Blob([arr], { type: 'image/png' }), n);
      const r = await fetch('/api/media/upload/figures/' + tid, { method: 'POST', body: fd });
      return r.json();
    }, TID, ['graph.png', 'chart.png'], PNG_B64);
    ok('iki figür yüklendi', up.uploaded && up.uploaded.length === 2);

    // 2) Build a real editor DOM + load the asset cache the way the app does.
    await page.evaluate(async (tid) => {
      window.location.hash = '#/articles-in-press/' + tid + '/edit';
      // Minimal contenteditable editor matching the htmlEditor prefix 'aip-ft'.
      let v = document.getElementById('aip-ft-visual');
      if (!v) {
        v = document.createElement('div');
        v.id = 'aip-ft-visual';
        v.contentEditable = 'true';
        document.body.appendChild(v);
      }
      v.innerHTML = '<p>Giriş paragrafı. Bulgular ilk görselde özetlenmiştir. Devamı.</p>';
      // Populate the asset cache exactly like loadArticleAssets does.
      const r = await fetch('/api/media/article/' + tid + '/assets');
      window._articleAssets = await r.json();
    }, TID);

    // 3) Open the REAL cross-ref picker and read the figure chips.
    const chips = await page.evaluate(() => {
      openCrossRefPicker('aip-ft');
      const overlay = document.querySelector('.modal-overlay');
      if (!overlay) return { error: 'modal açılmadı' };
      const figChips = Array.from(overlay.querySelectorAll('.cr-pick[data-kind="figure"]'))
        .map((b) => ({ num: Number(b.dataset.num), text: (b.textContent || '').trim() }));
      // Close it again.
      const cancel = overlay.querySelector('[data-action="cancel"]');
      if (cancel) cancel.click();
      return { figChips };
    });
    ok('PICKER iki figür chip gösterir (sadece ilki değil)',
      chips.figChips && chips.figChips.length === 2, JSON.stringify(chips.figChips));
    ok('PICKER chipleri doğru sırada (Figür 1, Figür 2)',
      chips.figChips && chips.figChips.map((c) => c.num).join(',') === '1,2',
      chips.figChips && chips.figChips.map((c) => c.text).join(' | '));

    // 4) Insert a cross-ref to figure 2 (the SECOND uploaded file).
    const inserted = await page.evaluate(() => {
      const v = document.getElementById('aip-ft-visual');
      v.focus();
      // Select the word "görselde" to convert into a link.
      const p = v.querySelector('p');
      const idx = p.textContent.indexOf('görselde');
      const range = document.createRange();
      const tn = p.firstChild;
      range.setStart(tn, idx);
      range.setEnd(tn, idx + 'görselde'.length);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      _crossRefSelection['aip-ft'] = { range: range.cloneRange(), text: range.toString() };
      insertCrossRef('aip-ft', 'figure', 2);
      const a = v.querySelector('a[href="#figure-2"]');
      return { hasAnchor: !!a, text: a ? a.textContent : null };
    });
    ok('Figür 2 atıfı eklendi (href=#figure-2)', inserted.hasAnchor, 'metin=' + inserted.text);

    // 5) Run the REAL auto-arrange and confirm number↔file consistency.
    await page.evaluate(() => _autoArrangeFullText('aip-ft'));
    await new Promise((r) => setTimeout(r, 600));
    const placed = await page.evaluate(() => {
      const v = document.getElementById('aip-ft-visual');
      const f1 = v.querySelector('#figure-1 img');
      const f2 = v.querySelector('#figure-2 img');
      const base = (el) => el ? (el.getAttribute('src') || '').split('/').pop() : null;
      return {
        figIds: Array.from(v.querySelectorAll('figure[id^="figure-"]')).map((f) => f.id),
        f1src: base(f1),
        f2src: base(f2),
        anchorStillValid: !!v.querySelector('a[href="#figure-2"]:not(.article-ref-broken)'),
      };
    });
    ok('auto-arrange iki figür bloğu kurar', placed.figIds.length === 2, placed.figIds.join(','));
    ok('figür-1 = ilk yüklenen (graph.png)', placed.f1src === 'graph.png', placed.f1src);
    ok('figür-2 = ikinci yüklenen (chart.png) — picker numarası dosyayla eşleşir',
      placed.f2src === 'chart.png', placed.f2src);
    ok('eklenen #figure-2 atıfı artık geçerli (kırık değil)', placed.anchorStillValid);
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
