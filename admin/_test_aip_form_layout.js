// Verifies the AIP edit form changes:
//  1) Tab order is Genel → Özet → Yazarlar → Tam Metin → (Dosyalar)
//  2) "Epub Tarihi" (aipf-published-online) and "Makale Yayın Tarihi" (aipf-published)
//     inputs exist inside the General panel
//  3) Keywords input (aipf-keywords) lives inside the Abstract panel, not General
// Requires server running with BMJ_TEST_BYPASS_AUTH=1 on BASE_URL.
const puppeteer = require('puppeteer');
const BASE = process.env.BASE_URL || 'http://localhost:3099';

function ok(name, cond, detail) {
  console.log((cond ? '✓' : '✗') + ' ' + name + (detail ? '  — ' + detail : ''));
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  try {
    // Find an existing AIP id to edit
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });
    const id = await page.evaluate(async () => {
      const r = await fetch('/api/articles-in-press');
      const list = await r.json();
      return list && list.length ? list[0].id : null;
    });
    ok('AIP listesi alındı', !!id, 'id=' + id);
    if (!id) throw new Error('No AIP records to test against');

    await page.evaluate((h) => { window.location.hash = h; }, `#/articles-in-press/${id}/edit`);
    await page.waitForFunction(() => document.querySelectorAll('.aip-tab-btn').length > 0, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 500));

    // 1) Tab order
    const tabs = await page.$$eval('.aip-tab-btn', (els) => els.map((e) => e.dataset.tab));
    const expected = ['general', 'abstract', 'authors', 'fulltext', 'media'];
    ok('Tab sırası doğru', JSON.stringify(tabs) === JSON.stringify(expected), tabs.join(' → '));

    // 2) New date inputs inside General panel
    const inGeneral = await page.evaluate(() => {
      const panel = document.querySelector('.aip-tab-panel[data-tab="general"]');
      return {
        epub: !!panel.querySelector('#aipf-published-online'),
        published: !!panel.querySelector('#aipf-published'),
        keywordsHere: !!panel.querySelector('#aipf-keywords'),
      };
    });
    ok('Epub Tarihi alanı Genel sekmesinde', inGeneral.epub);
    ok('Makale Yayın Tarihi alanı Genel sekmesinde', inGeneral.published);
    ok('Anahtar Kelimeler Genel sekmesinde DEĞİL', !inGeneral.keywordsHere);

    // 3) Keywords inside Abstract panel
    const keywordsInAbstract = await page.evaluate(() => {
      const panel = document.querySelector('.aip-tab-panel[data-tab="abstract"]');
      return !!panel.querySelector('#aipf-keywords');
    });
    ok('Anahtar Kelimeler Özet sekmesinde', keywordsInAbstract);

    // input types are date
    const types = await page.evaluate(() => ({
      epub: document.querySelector('#aipf-published-online')?.type,
      published: document.querySelector('#aipf-published')?.type,
    }));
    ok('Epub Tarihi input type=date', types.epub === 'date', types.epub);
    ok('Makale Yayın Tarihi input type=date', types.published === 'date', types.published);
  } catch (e) {
    console.error('TEST ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
