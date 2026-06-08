// Verifies the requested table refinements:
//  1) caption label says "Table N." (not "TABLE N.") and is NOT a link
//  2) the whole table title (number + caption) is bold
//  3) toolbar exposes an "Atıf / Bağlantı" button + openCrossRefMenu opens the
//     same cross-ref bubble (pinned, survives collapsed selection)
//  4+6) Otomatik Düzenle detects tables, renumbers them by FIRST-MENTION order
//       (Table 1, Table 2, …) and rewrites labels + in-text references to match
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
  await page.setViewport({ width: 1200, height: 800 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });

  // Build a real FT editor ('ft') with the full htmlEditor structure so the
  // toolbar (and its buttons) actually render.
  async function buildEditor(innerHtml) {
    return page.evaluate((innerHtml) => {
      window.location.hash = '#/articles/9990050/edit';
      let host = document.getElementById('ft-host');
      if (!host) { host = document.createElement('div'); host.id = 'ft-host'; document.body.appendChild(host); }
      host.innerHTML = htmlEditor({ prefix: 'ft', initialHtml: '', variant: 'full' });
      const v = document.getElementById('ft-visual');
      v.innerHTML = innerHtml;
      window._articleAssets = { figures: [], supplementary: [] };
    }, innerHtml);
  }

  try {
    // ── 3) Toolbar button present + opens the bubble ──
    await buildEditor('<p id="p1">Giriş.</p>');
    const toolbar = await page.evaluate(() => {
      const tb = document.getElementById('ft-toolbar');
      const btn = Array.from(tb.querySelectorAll('button')).find((b) => /Atıf\s*\/\s*Bağlantı/i.test(b.textContent || ''));
      return { hasBtn: !!btn };
    });
    ok('toolbar "Atıf / Bağlantı" butonu var', toolbar.hasBtn);

    const bubbleOpened = await page.evaluate(async () => {
      // No selection — button must still open the bubble.
      openCrossRefMenu('ft');
      const b0 = document.getElementById('cr-bubble');
      const shown = !!(b0 && !b0.classList.contains('hidden'));
      // Now force a COLLAPSED selection + fire selectionchange. A non-pinned
      // bubble would hide; a pinned one stays open.
      const v = document.getElementById('ft-visual');
      const r = document.createRange(); r.selectNodeContents(v); r.collapse(true);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((res) => setTimeout(res, 60));
      const b1 = document.getElementById('cr-bubble');
      return { shown, survivesCollapse: !!(b1 && !b1.classList.contains('hidden')) };
    });
    ok('buton bubble pop-up\'ı açar (seçim olmadan)', bubbleOpened.shown);
    ok('bubble "pinned" — collapsed seçimde kapanmaz', bubbleOpened.survivesCollapse);
    await page.evaluate(() => hideCrossRefBubble());

    // ── 1+2) Table label: "Table N.", bold, not a link ──
    // Use the paste-table flow to create a table.
    await buildEditor('<p id="p1">Bir tablo: burada.</p>');
    const label = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      const p = document.getElementById('p1');
      const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      _crossRefSelection['ft'] = { range: r.cloneRange(), text: '' };
      _insertInlineTable('ft');
      const o = document.querySelector('.modal-overlay');
      o.querySelector('#itbl-caption').value = 'Temel özellikler';
      o.querySelector('#itbl-paste').innerHTML = '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
      o.querySelector('[data-action="insert"]').click();
      const blk = v.querySelector('#table-1');
      const labelP = blk.querySelector('.table-label');
      return { html: labelP.outerHTML, text: labelP.textContent };
    });
    ok('etiket "Table 1." (TABLE değil)', /Table 1\./.test(label.text) && !/TABLE/.test(label.text), label.text);
    ok('başlık tamamı bold (<strong>Table 1. Temel özellikler</strong>)',
      /<strong>Table 1\. Temel özellikler<\/strong>/.test(label.html), label.html);
    ok('etiket link değil (anchor yok)', !/<a\b/i.test(label.html));

    // ── 4+6) Auto-arrange renumbers tables by first mention + links them ──
    // Two tables in DOM order table-1, table-2, but the PROSE mentions Table 2
    // first, then Table 1 → after auto-arrange they must swap (mention order).
    await buildEditor(
      '<p>Önce ikinci tabloya bakın: Table 2 sonuçları.</p>' +
      '<div class="article-table-wrap" id="table-1"><p class="table-label"><strong>TABLE 1.</strong> Birinci</p><table class="article-table"><tbody><tr><td>1</td></tr></tbody></table></div>' +
      '<p>Sonra Table 1 değerleri.</p>' +
      '<div class="article-table-wrap" id="table-2"><p class="table-label"><strong>TABLE 2.</strong> İkinci</p><table class="article-table"><tbody><tr><td>2</td></tr></tbody></table></div>'
    );
    const arranged = await page.evaluate(async () => {
      await _autoArrangeFullText('ft');
      await new Promise((r) => setTimeout(r, 300));
      const v = document.getElementById('ft-visual');
      const byId = (id) => v.querySelector('#' + id);
      // The block that WAS table-2 ("İkinci") is mentioned first → becomes table-1.
      const t1 = byId('table-1'); const t2 = byId('table-2');
      const links = Array.from(v.querySelectorAll('a.article-media-ref-link[href^="#table-"]'))
        .map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() }));
      return {
        t1Caption: t1 ? t1.querySelector('.table-label').textContent.trim() : null,
        t2Caption: t2 ? t2.querySelector('.table-label').textContent.trim() : null,
        t1LabelBoldHtml: t1 ? t1.querySelector('.table-label').innerHTML : null,
        links,
        ids: Array.from(v.querySelectorAll('[id^="table-"]')).map((e) => e.id).sort(),
      };
    });
    ok('mention sırasına göre yeniden numaralandı: "İkinci" → Table 1',
      /^Table 1\./.test(arranged.t1Caption) && /İkinci/.test(arranged.t1Caption), arranged.t1Caption);
    ok('"Birinci" → Table 2',
      /^Table 2\./.test(arranged.t2Caption) && /Birinci/.test(arranged.t2Caption), arranged.t2Caption);
    ok('etiketler "Table" + normalize (TABLE kalmadı)',
      !/TABLE/.test(arranged.t1Caption) && !/TABLE/.test(arranged.t2Caption));
    ok('iki tablo bloğu korundu (table-1, table-2)',
      JSON.stringify(arranged.ids) === '["table-1","table-2"]', JSON.stringify(arranged.ids));
    // The prose "Table 2" (mentioned first) now points to #table-1; "Table 1" → #table-2.
    const firstLink = arranged.links[0];
    const secondLink = arranged.links[1];
    ok('ilk mention (eski "Table 2") artık #table-1\'e bağlı ve "Table 1" yazıyor',
      firstLink && firstLink.href === '#table-1' && /Table 1\b/.test(firstLink.text), JSON.stringify(firstLink));
    ok('ikinci mention (eski "Table 1") artık #table-2\'ye bağlı ve "Table 2" yazıyor',
      secondLink && secondLink.href === '#table-2' && /Table 2\b/.test(secondLink.text), JSON.stringify(secondLink));
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
