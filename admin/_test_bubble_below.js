// Verifies the cross-ref bubble ALWAYS renders BELOW the selection, never above
// — even when the selection sits near the bottom of the viewport (where the old
// logic would have placed it above). Checks both the computed top position and
// the data-flip="below" arrow flag.
//
// Requires server with BMJ_TEST_BYPASS_AUTH=1 on BASE_URL.
const puppeteer = require('puppeteer');
const BASE = process.env.BASE_URL || 'http://localhost:3099';

let failures = 0;
function ok(name, cond, detail) {
  console.log((cond ? '✓' : '✗') + ' ' + name + (detail ? '  — ' + detail : ''));
  if (!cond) failures++;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 700 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });

  async function probe(positionLabel, topPx) {
    return page.evaluate((topPx) => {
      // Build an editor paragraph at a chosen vertical position.
      let v = document.getElementById('aip-ft-visual');
      if (!v) { v = document.createElement('div'); v.id = 'aip-ft-visual'; v.contentEditable = 'true'; document.body.appendChild(v); }
      v.style.position = 'absolute';
      v.style.left = '40px';
      v.style.top = topPx + 'px';
      v.style.width = '600px';
      v.innerHTML = '<p id="probe-p">Seçilecek örnek metin parçası burada.</p>';
      window._articleAssets = { figures: [{ filename: 'figure-1.png', url: 'images/articles/x/figure-1.png' }], supplementary: [] };
      const p = document.getElementById('probe-p');
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      const selRect = range.getBoundingClientRect();
      _positionCrossRefBubble(range);
      const bubble = document.getElementById('cr-bubble');
      const top = parseFloat(bubble.style.top);
      return {
        flip: bubble.dataset.flip || '',
        bubbleTop: top,
        selBottomDoc: selRect.bottom + window.scrollY,
        selTopDoc: selRect.top + window.scrollY,
      };
    }, topPx);
  }

  try {
    // Case 1: selection near the TOP of the page (plenty of room above).
    const top = await probe('top', 30);
    ok('üstte seçimde bubble ALTTA (top > seçim altı)', top.bubbleTop >= top.selBottomDoc, JSON.stringify(top));
    ok('üstte seçimde data-flip="below"', top.flip === 'below', top.flip);

    // Case 2: selection near the BOTTOM of the viewport (old code would flip ABOVE).
    const bottom = await probe('bottom', 650);
    ok('sayfa altındaki seçimde bile bubble ALTTA (üste kaçmaz)', bottom.bubbleTop >= bottom.selBottomDoc, JSON.stringify(bottom));
    ok('sayfa altında data-flip="below" (asla üstte değil)', bottom.flip === 'below', bottom.flip);
    ok('bubble seçimin üstünde DEĞİL', bottom.bubbleTop > bottom.selTopDoc, `bubbleTop=${bottom.bubbleTop} selTop=${bottom.selTopDoc}`);
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
