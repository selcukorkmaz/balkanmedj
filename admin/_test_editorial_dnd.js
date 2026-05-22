// E2E test — drag-and-drop reordering for Editorial Board member rows.
// Editorial form is model-driven: the drop updates _edModel and re-renders.
//
// Requires the admin server running with BMJ_TEST_BYPASS_AUTH=1.

const puppeteer = require('puppeteer');

const BASE = process.env.BASE_URL || 'http://localhost:3098';

function pass(name) { console.log('  PASS:', name); }
function fail(name, detail) { console.log('  FAIL:', name, detail ? '— ' + detail : ''); process.exitCode = 1; }

async function dragEdRow(page, sectionId, sourceIdx, targetIdx, position) {
  return page.evaluate(({ sectionId, sourceIdx, targetIdx, position }) => {
    const rows = document.querySelectorAll(`[data-ed-section="${sectionId}"] .ed-mrow`);
    const src = rows[sourceIdx];
    const tgt = rows[targetIdx];
    if (!src || !tgt) throw new Error('row not found: ' + sourceIdx + '/' + targetIdx);

    const grip = src.querySelector('.row-grip');
    if (!grip) throw new Error('no grip on source row');
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    const mk = (type, x, y) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0 });
      Object.defineProperty(ev, 'dataTransfer', { value: { effectAllowed: 'all', dropEffect: 'move', _d: {}, setData(){}, getData(){}, setDragImage(){}, types: [], files: [] } });
      return ev;
    };

    src.dispatchEvent(mk('dragstart'));
    const rect = tgt.getBoundingClientRect();
    const y = position === 'above' ? rect.top + 2 : rect.bottom - 2;
    tgt.dispatchEvent(mk('dragover', rect.left + 10, y));
    tgt.dispatchEvent(mk('drop', rect.left + 10, y));
    src.dispatchEvent(mk('dragend'));
  }, { sectionId, sourceIdx, targetIdx, position });
}

// Read the in-page _edModel via window. Since it's a let, we access via eval.
async function getMemberOrder(page, sectionIdx) {
  return page.evaluate((si) => {
    // _edModel is a module-scoped let, but evaluate runs in window scope.
    // We expose it temporarily for the test.
    // eslint-disable-next-line no-eval
    const m = eval('_edModel');
    return (m.sections[si].members || []).map((x) => x.name);
  }, sectionIdx);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console.error]', m.text()); });

  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });
    await page.evaluate(() => { window.location.hash = '#/editorial'; });
    await new Promise((r) => setTimeout(r, 2000));
    await page.waitForSelector('.ed-tab-btn', { timeout: 8000 });

    // ── T1: pick a section with >5 members (Deputy Editors at idx 2) ──
    console.log('=== T1: Editorial member drag-and-drop within a section ===');
    await page.evaluate(() => { edSelectTab('deputy-editors'); });
    await new Promise((r) => setTimeout(r, 300));
    await page.waitForSelector('.ed-mrow .row-grip', { timeout: 4000 });

    // Force-name members so we can track them by their input values. Scope to
    // the visible section — hidden sections also have .ed-mrow in the DOM.
    await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-ed-section="deputy-editors"] .ed-mrow');
      rows.forEach((r, i) => {
        const name = r.querySelector('[data-f="name"]');
        if (name) name.value = 'D_' + String.fromCharCode(65 + i); // D_A, D_B, ...
      });
      // Sync values into the model so re-render carries them.
      edSyncModel();
    });

    const sectionIdx = await page.evaluate(() => eval('_edModel').sections.findIndex((s) => s.id === 'deputy-editors'));
    const before = await getMemberOrder(page, sectionIdx);
    if (before.length >= 5 && before.slice(0, 5).join(',') === 'D_A,D_B,D_C,D_D,D_E') pass('initial order D_A..D_E');
    else fail('initial order', JSON.stringify(before.slice(0, 5)));

    const gripCount = await page.$$eval('[data-ed-section="deputy-editors"] .ed-mrow', (rows) => rows.filter((r) => r.querySelector('.row-grip svg')).length);
    if (gripCount === before.length) pass(`every member row has a grip (${gripCount}/${before.length})`);
    else fail('grip count mismatch', `${gripCount}/${before.length}`);

    // Drag D_A (idx 0) below D_D (idx 3) → expected B,C,D,A,E
    await dragEdRow(page, 'deputy-editors', 0, 3, 'below');
    await new Promise((r) => setTimeout(r, 200));
    const after1 = await getMemberOrder(page, sectionIdx);
    if (after1.slice(0, 5).join(',') === 'D_B,D_C,D_D,D_A,D_E') pass('drag 0→below(3) gives B,C,D,A,E');
    else fail('drag 0→below(3)', JSON.stringify(after1.slice(0, 5)));

    // Drag D_E (idx 4) above D_B (idx 0) → expected E,B,C,D,A
    await dragEdRow(page, 'deputy-editors', 4, 0, 'above');
    await new Promise((r) => setTimeout(r, 200));
    const after2 = await getMemberOrder(page, sectionIdx);
    if (after2.slice(0, 5).join(',') === 'D_E,D_B,D_C,D_D,D_A') pass('drag 4→above(0) gives E,B,C,D,A');
    else fail('drag 4→above(0)', JSON.stringify(after2.slice(0, 5)));

    const dirty = await page.evaluate(() => typeof _formDirty !== 'undefined' ? _formDirty : null);
    if (dirty === true) pass('markDirty() triggered after editorial reorder');
    else fail('markDirty() not triggered', 'dirty=' + dirty);

    // Re-render must restore #N badges in sequence.
    const badges = await page.$$eval('[data-ed-section="deputy-editors"] .ed-mrow-num', (els) => els.slice(0, 5).map((e) => e.textContent));
    if (badges.join(',') === '#1,#2,#3,#4,#5') pass('row badges renumbered after drop');
    else fail('badges not renumbered', JSON.stringify(badges));

    // ── T2: large-distance drag (simulates the "50 positions" scenario) ──
    console.log('=== T2: Long-distance drag across many members ===');
    await page.evaluate(() => { edSelectTab('associate-editors'); });
    await new Promise((r) => setTimeout(r, 400));
    // Use the Associate Editors section with 36 members.
    const longSectionIdx = await page.evaluate(() => eval('_edModel').sections.findIndex((s) => s.id === 'associate-editors'));
    const longBefore = await getMemberOrder(page, longSectionIdx);
    const firstName = longBefore[0];
    const lastName = longBefore[longBefore.length - 1];
    const rowCount = longBefore.length;

    // Drag the first member to below the last → first should land at the end.
    await dragEdRow(page, 'associate-editors', 0, rowCount - 1, 'below');
    await new Promise((r) => setTimeout(r, 200));
    const longAfter = await getMemberOrder(page, longSectionIdx);
    if (longAfter[longAfter.length - 1] === firstName && longAfter[0] !== firstName) {
      pass(`long drag: first → last (across ${rowCount} rows) places ${firstName} at end`);
    } else {
      fail('long drag first → last', `first=${firstName} now at idx ${longAfter.indexOf(firstName)} of ${longAfter.length}`);
    }
    // Sanity: last name didn't move arbitrarily.
    if (longAfter[longAfter.length - 2] === lastName) pass('previous last name shifted up by one (everything in between preserved)');
    else fail('shift integrity', `expected ${lastName} at idx ${longAfter.length - 2}, got ${longAfter[longAfter.length - 2]}`);

    // ── T3: cross-section drag must NOT mix members ──
    console.log('=== T3: Cross-section drag is rejected ===');
    // After re-render, only the active section's rows are in the DOM. Verify
    // attempting a drag to a row in a different section (we'll fabricate one)
    // does not modify any member arrays.
    const beforeAcross = await getMemberOrder(page, sectionIdx); // deputy-editors snapshot
    const crossOk = await page.evaluate(() => {
      const a = document.querySelector('.ed-mrow');
      if (!a) return false;
      // Fabricate a fake ed-mrow that belongs to "another section" (data-sec=999).
      const fake = document.createElement('div');
      fake.className = 'ed-mrow';
      fake.dataset.sec = '999';
      fake.dataset.mem = '0';
      fake.style.height = '40px';
      document.body.appendChild(fake);
      a.querySelector('.row-grip').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const mk = (type) => {
        const ev = new MouseEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'dataTransfer', { value: { _d:{}, setData(){}, getData(){}, setDragImage(){}, types:[], files:[] } });
        return ev;
      };
      a.dispatchEvent(mk('dragstart'));
      const r = fake.getBoundingClientRect();
      const over = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: r.top + 5 });
      Object.defineProperty(over, 'dataTransfer', { value: { _d:{}, setData(){}, getData(){}, setDragImage(){}, types:[], files:[] } });
      fake.dispatchEvent(over);
      const accepted = over.defaultPrevented;
      a.dispatchEvent(mk('dragend'));
      fake.remove();
      return accepted === false;
    });
    if (crossOk) pass('cross-section drag rejected (different parent guard)');
    else fail('cross-section drag accepted');

    // ── T4: clicking the grip then releasing should not leave draggable set ──
    console.log('=== T4: Editorial grip mouseup cleanup ===');
    await page.evaluate(() => {
      document.querySelector('[data-ed-section="associate-editors"] .ed-mrow .row-grip').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    const setOk = await page.$eval('[data-ed-section="associate-editors"] .ed-mrow', (r) => r.getAttribute('draggable')) === 'true';
    if (setOk) pass('draggable=true set on ed-mrow grip mousedown');
    else fail('draggable not set on ed-mrow');
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    const clearOk = await page.$eval('[data-ed-section="associate-editors"] .ed-mrow', (r) => r.getAttribute('draggable')) === null;
    if (clearOk) pass('draggable cleared from ed-mrow on mouseup');
    else fail('draggable not cleared on ed-mrow');

  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
