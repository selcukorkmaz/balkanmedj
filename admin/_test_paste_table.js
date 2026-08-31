// Verifies the "+ Yeni Tablo" pop-up action now PASTES a Word/Excel table as a
// real numbered <table> block instead of opening a file-upload picker:
//   • the bubble button opens a paste dialog (#itbl-paste), not a file input
//   • a pasted Word table becomes <div class="article-table-wrap" id="table-N">
//     with <table class="article-table"> and the cell text preserved
//   • Word junk (style/class/span/o:p) is stripped, colspan kept
//   • numbering continues from existing tables (table-1 → next is table-2)
//
// Requires server with BMJ_TEST_BYPASS_AUTH=1 on BASE_URL.
const puppeteer = require('puppeteer');
const BASE = process.env.BASE_URL || 'http://localhost:3099';

let failures = 0;
function ok(name, cond, detail) {
  console.log((cond ? '✓' : '✗') + ' ' + name + (detail ? '  — ' + detail : ''));
  if (!cond) failures++;
}

const WORD_TABLE = `
<table border="1" cellspacing="0" class="MsoTableGrid" style="border-collapse:collapse;mso-table-layout-alt:fixed">
  <tbody>
    <tr style="mso-yfti-irow:0">
      <td style="width:100pt;padding:0in 5.4pt" valign="top"><p class="MsoNormal"><span lang="EN-US" style="font-size:10.0pt">Header A<o:p></o:p></span></p></td>
      <td style="width:120pt" valign="top"><p class="MsoNormal"><span style="color:red">Header B</span></p></td>
    </tr>
    <tr>
      <td><span>1</span></td>
      <td colspan="1"><span style="mso-bidi:none">2</span></td>
    </tr>
  </tbody>
</table>`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });

  try {
    // Build editor with content + one EXISTING table block, set the hash so
    // currentArticleIdFromHash() resolves and wire the bubble.
    await page.evaluate((wordTable) => {
      window.location.hash = '#/articles-in-press/9990040/edit';
      let v = document.getElementById('aip-ft-visual');
      if (!v) { v = document.createElement('div'); v.id = 'aip-ft-visual'; v.contentEditable = 'true'; document.body.appendChild(v); }
      v.innerHTML = '<p id="anchor-p">İlk paragraf.</p>' +
        '<div class="article-table-wrap" id="table-1"><p class="table-label"><strong>TABLE 1.</strong> Var olan</p><table class="article-table"><tbody><tr><td>x</td></tr></tbody></table></div>';
      window._articleAssets = { figures: [], supplementary: [] };
      // Put the caret in the first paragraph (insertion point for the new table).
      const p = document.getElementById('anchor-p');
      const range = document.createRange();
      range.selectNodeContents(p); range.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      _crossRefSelection['aip-ft'] = { range: range.cloneRange(), text: '' };
    }, WORD_TABLE);

    // Open the paste dialog (this is what the bubble's "+ Yeni Tablo" calls).
    const dialogOpened = await page.evaluate(() => {
      _insertInlineTable('aip-ft');
      const o = document.querySelector('.modal-overlay');
      return !!(o && o.querySelector('#itbl-paste'));
    });
    ok('"+ Yeni Tablo" yapıştırma diyaloğu açar (dosya yükleme değil)', dialogOpened);

    // Simulate pasting a Word table + a caption, then click "Tabloyu Ekle".
    const result = await page.evaluate((wordTable) => {
      const o = document.querySelector('.modal-overlay');
      o.querySelector('#itbl-caption').value = 'Hastaların özellikleri';
      o.querySelector('#itbl-paste').innerHTML = wordTable; // simulates a paste
      o.querySelector('#itbl-paste').dispatchEvent(new Event('input', { bubbles: true }));
      o.querySelector('[data-action="insert"]').click();
      const v = document.getElementById('aip-ft-visual');
      const block = v.querySelector('#table-2');
      return {
        tableIds: Array.from(v.querySelectorAll('[id^="table-"]')).map((e) => e.id),
        blockHtml: block ? block.outerHTML : null,
        text: block ? block.textContent.replace(/\s+/g, ' ').trim() : null,
      };
    }, WORD_TABLE);

    ok('yeni tablo table-2 olarak numaralandı (table-1 vardı)',
      result.tableIds.length === 2 && result.tableIds.includes('table-1') && result.tableIds.includes('table-2'),
      JSON.stringify(result.tableIds));
    ok('gerçek <table class="article-table"> eklendi',
      result.blockHtml && /<table class="article-table">/.test(result.blockHtml));
    ok('hücre metni korundu (Header A/B, 1, 2)',
      result.text && /Header A/.test(result.text) && /Header B/.test(result.text) && /\b1\b/.test(result.text) && /\b2\b/.test(result.text), result.text);
    ok('Word çöpü temizlendi (style/class=Mso/span/o:p yok)',
      result.blockHtml && !/style=/.test(result.blockHtml) && !/Mso/.test(result.blockHtml) && !/<span/i.test(result.blockHtml) && !/o:p/i.test(result.blockHtml));
    ok('yapısal colspan korundu',
      result.blockHtml && /colspan="1"/.test(result.blockHtml), 'colspan var mı');
    ok('başlık "Table N." (büyük harf değil) ve bold (tamamı <strong> içinde)',
      result.blockHtml && /<strong>Table 2\. Hastaların özellikleri<\/strong>/.test(result.blockHtml), result.blockHtml);
    ok('etiket bir link DEĞİL (anchor yok)',
      result.blockHtml && !/<a\b/i.test(result.blockHtml.replace(/<table[\s\S]*<\/table>/i, '')));

    // Empty paste → friendly warning, no insertion.
    const noTable = await page.evaluate(() => {
      _insertInlineTable('aip-ft');
      const o = document.querySelector('.modal-overlay');
      o.querySelector('#itbl-paste').innerHTML = '<p>sadece düz metin</p>';
      o.querySelector('[data-action="insert"]').click();
      const stillOpen = !!document.querySelector('.modal-overlay');
      const count = document.querySelectorAll('#aip-ft-visual [id^="table-"]').length;
      // close it
      const ov = document.querySelector('.modal-overlay'); if (ov) ov.querySelector('[data-action="cancel"]').click();
      return { stillOpen, count };
    });
    ok('tablosuz yapıştırmada ekleme yapılmaz (diyalog açık kalır)', noTable.stillOpen && noTable.count === 2, JSON.stringify(noTable));
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
