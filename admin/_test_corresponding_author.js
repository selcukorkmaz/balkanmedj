// Verifies the corresponding-author feature on the AIP author rows:
//   • each author has a "Sorumlu yazar ise tıklayınız" checkbox
//   • checking it reveals an email input (hidden otherwise)
//   • MULTIPLE corresponding authors are supported
//   • save persists { corresponding:true, email } only for checked authors
//   • reload renders checkbox checked + email visible (round-trip)
//
// Drives the REAL aipAuthorRow + _toggleCorrEmail + saveAip against a throwaway
// AIP record (created + deleted via API). Requires BMJ_TEST_BYPASS_AUTH=1.
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
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });

  let id = null;
  try {
    // Create a throwaway AIP with three authors.
    id = await page.evaluate(async () => {
      const r = await fetch('/api/articles-in-press', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Corresponding Author Test', type: 'Original Article',
          authors: [{ name: 'Alice A' }, { name: 'Bob B' }, { name: 'Carol C' }],
        }),
      });
      return (await r.json()).id;
    });
    ok('test AIP oluşturuldu', !!id, 'id=' + id);

    // Open its edit page, Yazarlar tab.
    await page.evaluate((id) => { window.location.hash = '#/articles-in-press/' + id + '/edit'; }, id);
    await page.waitForFunction(() => document.querySelectorAll('.aipf-author-row').length >= 3, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 300));

    // Every row has the checkbox; email hidden by default.
    const initial = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.aipf-author-row'));
      return rows.map((row) => ({
        hasCheckbox: !!row.querySelector('.aipf-au-corr'),
        emailHidden: row.querySelector('.aipf-au-email').style.display === 'none',
      }));
    });
    ok('her yazarda sorumlu-yazar checkbox var', initial.every((r) => r.hasCheckbox), JSON.stringify(initial));
    ok('e-posta alanı başlangıçta gizli', initial.every((r) => r.emailHidden));

    // Check authors #1 and #3 as corresponding (multiple!), fill emails. Leave #2.
    const reveal = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.aipf-author-row'));
      const setCorr = (i, email) => {
        const cb = rows[i].querySelector('.aipf-au-corr');
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true })); // triggers _toggleCorrEmail
        const em = rows[i].querySelector('.aipf-au-email');
        em.value = email;
      };
      setCorr(0, 'alice@example.com');
      setCorr(2, 'carol@example.com');
      return {
        email0Visible: rows[0].querySelector('.aipf-au-email').style.display !== 'none',
        email1Visible: rows[1].querySelector('.aipf-au-email').style.display !== 'none',
        email2Visible: rows[2].querySelector('.aipf-au-email').style.display !== 'none',
      };
    });
    ok('işaretlenince e-posta görünür (yazar 1 ve 3)', reveal.email0Visible && reveal.email2Visible);
    ok('işaretlenmeyen yazarın e-postası gizli kalır (yazar 2)', !reveal.email1Visible);

    // Save and read back from the API.
    await page.evaluate(() => saveAip(false));
    await new Promise((r) => setTimeout(r, 600));
    const saved = await page.evaluate(async (id) => {
      const r = await fetch('/api/articles-in-press/' + id);
      return (await r.json()).authors;
    }, id);
    ok('kaydedilen: yazar 1 sorumlu + e-posta',
      saved[0].corresponding === true && saved[0].email === 'alice@example.com', JSON.stringify(saved[0]));
    ok('kaydedilen: yazar 2 sorumlu DEĞİL, e-posta yok',
      !saved[1].corresponding && !saved[1].email, JSON.stringify(saved[1]));
    ok('kaydedilen: yazar 3 sorumlu + e-posta (çoklu sorumlu yazar)',
      saved[2].corresponding === true && saved[2].email === 'carol@example.com', JSON.stringify(saved[2]));

    // Reload the edit page → round-trip render.
    await page.evaluate(() => { window.location.hash = '#/articles-in-press'; });
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate((id) => { window.location.hash = '#/articles-in-press/' + id + '/edit'; }, id);
    await page.waitForFunction(() => document.querySelectorAll('.aipf-author-row').length >= 3, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 300));
    const roundtrip = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.aipf-author-row'));
      return rows.map((row) => ({
        checked: row.querySelector('.aipf-au-corr').checked,
        emailVisible: row.querySelector('.aipf-au-email').style.display !== 'none',
        email: row.querySelector('.aipf-au-email').value,
      }));
    });
    ok('round-trip: yazar 1 işaretli + e-posta görünür + dolu',
      roundtrip[0].checked && roundtrip[0].emailVisible && roundtrip[0].email === 'alice@example.com', JSON.stringify(roundtrip[0]));
    ok('round-trip: yazar 2 işaretsiz + e-posta gizli',
      !roundtrip[1].checked && !roundtrip[1].emailVisible, JSON.stringify(roundtrip[1]));
    ok('round-trip: yazar 3 işaretli + e-posta dolu',
      roundtrip[2].checked && roundtrip[2].email === 'carol@example.com', JSON.stringify(roundtrip[2]));
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    // Clean up the throwaway record.
    if (id) {
      await page.evaluate(async (id) => { try { await fetch('/api/articles-in-press/' + id, { method: 'DELETE' }); } catch (_) {} }, id);
    }
    await browser.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
