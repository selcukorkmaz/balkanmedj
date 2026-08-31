// E2E test — drag-and-drop reordering for article author rows.
// Verifies the user-visible behavior: grab a row by its grip, drop it
// elsewhere in the list, watch the DOM order change and markDirty fire.
//
// Run with the admin server up:
//   BMJ_TEST_BYPASS_AUTH=1 node admin/server.js
//   node admin/_test_author_dnd.js

const puppeteer = require('puppeteer');

const BASE = process.env.BASE_URL || 'http://localhost:3099';

function pass(name) { console.log('  PASS:', name); }
function fail(name, detail) { console.log('  FAIL:', name, detail ? '— ' + detail : ''); process.exitCode = 1; }

// Dispatch a sequence of HTML5 drag events from sourceIdx to targetIdx.
// `position` is 'above' or 'below' (which side of the target to drop on).
async function dragRow(page, listSelector, sourceIdx, targetIdx, position) {
  return page.evaluate(({ listSelector, sourceIdx, targetIdx, position }) => {
    const rows = document.querySelectorAll(listSelector);
    const src = rows[sourceIdx];
    const tgt = rows[targetIdx];
    if (!src || !tgt) throw new Error('row not found: ' + sourceIdx + '/' + targetIdx);

    // The grip must be mousedowned first so the row becomes draggable.
    const grip = src.querySelector('.row-grip');
    if (!grip) throw new Error('no grip on source row');
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // Chromium's DragEvent constructor refuses anything but a real DataTransfer
    // (which page code can't create). Use MouseEvent (carries clientX/Y natively)
    // and attach a fake dataTransfer surface our handler reads.
    const makeDragEvent = (type, x, y) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0 });
      Object.defineProperty(ev, 'dataTransfer', { value: { effectAllowed: 'all', dropEffect: 'move', _d: {}, setData(k, v){this._d[k]=v;}, getData(k){return this._d[k];}, setDragImage(){}, types: [], files: [] } });
      return ev;
    };

    src.dispatchEvent(makeDragEvent('dragstart'));

    const rect = tgt.getBoundingClientRect();
    const y = position === 'above' ? rect.top + 2 : rect.bottom - 2;
    tgt.dispatchEvent(makeDragEvent('dragover', rect.left + 10, y));
    tgt.dispatchEvent(makeDragEvent('drop', rect.left + 10, y));
    src.dispatchEvent(makeDragEvent('dragend'));
  }, { listSelector, sourceIdx, targetIdx, position });
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console.error]', m.text()); });

  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });

    // ── 1) Article authors: add 6 rows, drag #0 to below #4, check order ──
    console.log('=== T1: Article author drag-and-drop ===');
    await page.evaluate(() => { window.location.hash = '#/articles/2811'; });
    await new Promise((r) => setTimeout(r, 1800));
    await page.waitForSelector('#authors-list', { timeout: 8000 });

    // Activate Authors tab so the panel becomes visible (otherwise row rects are 0).
    await page.evaluate(() => {
      const btn = document.querySelector('.tab-btn[data-tab="authors"]');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 200));

    // Stamp the first six rows with distinct names so we can track them.
    await page.evaluate(() => {
      const rows = document.querySelectorAll('#authors-list .author-row');
      // Add more rows if there are fewer than 6.
      while (document.querySelectorAll('#authors-list .author-row').length < 6) {
        window.addAuthor();
      }
      document.querySelectorAll('#authors-list .author-row').forEach((r, i) => {
        const input = r.querySelector('.au-name');
        input.value = 'AUTHOR_' + String.fromCharCode(65 + i); // A..F
      });
    });

    const before = await page.$$eval('#authors-list .au-name', (els) => els.slice(0, 6).map((e) => e.value));
    if (before.join(',') === 'AUTHOR_A,AUTHOR_B,AUTHOR_C,AUTHOR_D,AUTHOR_E,AUTHOR_F') pass('initial order A..F');
    else fail('initial order A..F', JSON.stringify(before));

    // Sanity: every visible row has a grip.
    const gripsOk = await page.$$eval('#authors-list .author-row', (rows) =>
      rows.every((r) => r.querySelector('.row-grip svg'))
    );
    if (gripsOk) pass('every author row has a grip handle');
    else fail('grip handle missing on at least one row');

    // Drag AUTHOR_A (idx 0) to below AUTHOR_E (idx 4) → expected order B,C,D,E,A,F.
    await dragRow(page, '#authors-list .author-row', 0, 4, 'below');
    const after = await page.$$eval('#authors-list .au-name', (els) => els.slice(0, 6).map((e) => e.value));
    if (after.join(',') === 'AUTHOR_B,AUTHOR_C,AUTHOR_D,AUTHOR_E,AUTHOR_A,AUTHOR_F') pass('drag 0→below(4) gives B,C,D,E,A,F');
    else fail('drag 0→below(4)', JSON.stringify(after));

    // Drag AUTHOR_F (idx 5) to above AUTHOR_B (idx 0) → expected F,B,C,D,E,A.
    await dragRow(page, '#authors-list .author-row', 5, 0, 'above');
    const after2 = await page.$$eval('#authors-list .au-name', (els) => els.slice(0, 6).map((e) => e.value));
    if (after2.join(',') === 'AUTHOR_F,AUTHOR_B,AUTHOR_C,AUTHOR_D,AUTHOR_E,AUTHOR_A') pass('drag 5→above(0) gives F,B,C,D,E,A');
    else fail('drag 5→above(0)', JSON.stringify(after2));

    // markDirty must have fired (Kaydet button is enabled / dirty indicator on).
    const dirty = await page.evaluate(() => typeof _formDirty !== 'undefined' ? _formDirty : null);
    if (dirty === true) pass('markDirty() triggered after reorder');
    else fail('markDirty() not triggered', 'dirty=' + dirty);

    // ── 2) After mousedown-without-drag, draggable attr must clear on mouseup ──
    console.log('=== T2: Stale draggable cleanup ===');
    await page.evaluate(() => {
      const grip = document.querySelector('#authors-list .author-row .row-grip');
      grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    const draggableImmediate = await page.$eval('#authors-list .author-row', (r) => r.getAttribute('draggable'));
    if (draggableImmediate === 'true') pass('draggable=true set on grip mousedown');
    else fail('draggable not set on grip mousedown', String(draggableImmediate));

    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    const draggableAfterUp = await page.$eval('#authors-list .author-row', (r) => r.getAttribute('draggable'));
    if (draggableAfterUp === null) pass('draggable cleared on mouseup (no drag)');
    else fail('draggable not cleared on mouseup', String(draggableAfterUp));

    // ── 3) AIP author rows: same drag mechanics ──
    console.log('=== T3: AIP author drag-and-drop ===');
    // Find an AIP id from the list page.
    // Clear dirty state so the navigation guard doesn't block our hash change.
    await page.evaluate(() => { if (typeof clearDirty === 'function') clearDirty(); });

    // Use the AIP API to discover a real ID (some test envs may have none).
    const aipId = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/articles-in-press');
        const arr = await r.json();
        return Array.isArray(arr) && arr[0] ? String(arr[0].id) : null;
      } catch (_) { return null; }
    });
    if (!aipId) {
      console.log('  SKIP: no AIP article available');
    } else {
      await page.evaluate((id) => { window.location.hash = '#/articles-in-press/' + id + '/edit'; }, aipId);
      await new Promise((r) => setTimeout(r, 1500));
      await page.waitForSelector('#aipf-authors', { timeout: 8000 });

      // Open Authors tab so rows render visible (they're in a panel).
      await page.evaluate(() => {
        const btn = document.querySelector('.aip-tab-btn[data-tab="authors"]');
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 200));

      await page.evaluate(() => {
        while (document.querySelectorAll('#aipf-authors .aipf-author-row').length < 4) {
          window.addAipAuthor();
        }
        document.querySelectorAll('#aipf-authors .aipf-author-row').forEach((r, i) => {
          r.querySelector('.aipf-au-name').value = 'AIP_' + String.fromCharCode(65 + i);
        });
      });

      const aipBefore = await page.$$eval('#aipf-authors .aipf-au-name', (els) => els.slice(0, 4).map((e) => e.value));
      if (aipBefore.join(',') === 'AIP_A,AIP_B,AIP_C,AIP_D') pass('AIP initial order A..D');
      else fail('AIP initial order', JSON.stringify(aipBefore));

      await dragRow(page, '#aipf-authors .aipf-author-row', 0, 3, 'below');
      const aipAfter = await page.$$eval('#aipf-authors .aipf-au-name', (els) => els.slice(0, 4).map((e) => e.value));
      if (aipAfter.join(',') === 'AIP_B,AIP_C,AIP_D,AIP_A') pass('AIP drag 0→below(3) gives B,C,D,A');
      else fail('AIP drag 0→below(3)', JSON.stringify(aipAfter));
    }

    // ── 4) Cross-list drag must be ignored (only same parent reorders) ──
    console.log('=== T4: Cross-list drag rejection ===');
    await page.evaluate(() => { if (typeof clearDirty === 'function') clearDirty(); });
    await page.evaluate(() => { window.location.hash = '#/articles/2811'; });
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(() => {
      const btn = document.querySelector('.tab-btn[data-tab="authors"]');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 200));
    const crossOk = await page.evaluate(() => {
      const a = document.querySelector('#authors-list .author-row');
      // Fake a second list elsewhere with a row of the OTHER class.
      const aipRow = document.createElement('div');
      aipRow.className = 'aipf-author-row';
      aipRow.style.height = '20px';
      document.body.appendChild(aipRow);

      a.querySelector('.row-grip').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const mk = (type, y) => {
        const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y || 0 });
        Object.defineProperty(ev, 'dataTransfer', { value: { _d:{}, setData(k,v){this._d[k]=v;}, getData(k){return this._d[k];}, setDragImage(){}, types:[], files:[] } });
        return ev;
      };
      a.dispatchEvent(mk('dragstart'));
      const r = aipRow.getBoundingClientRect();
      const over = mk('dragover', r.top + 5);
      aipRow.dispatchEvent(over);
      // If our handler honored cross-list drag, preventDefault would be true here.
      const accepted = over.defaultPrevented;
      a.dispatchEvent(mk('dragend'));
      aipRow.remove();
      return accepted === false;
    });
    if (crossOk) pass('drag across different lists is rejected');
    else fail('cross-list drag was accepted (should be rejected)');

  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
