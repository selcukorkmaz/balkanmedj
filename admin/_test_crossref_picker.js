// E2E test — the Atıf (cross-reference) picker on the full-text editor.
//
// Verifies that:
//   1. The toolbar button appears on FT editors (article + AIP)
//   2. The modal scans the current editor body for figure/table/ref targets
//   3. Clicking a chip wraps the user's selection in a properly-classed anchor
//   4. With no selection, the default label "Figure N" / "Table N" / "N" is used
//   5. Manual number input also produces a working link

const puppeteer = require('puppeteer');

const BASE = process.env.BASE_URL || 'http://localhost:3098';

function pass(n) { console.log('  PASS:', n); }
function fail(n, d) { console.log('  FAIL:', n, d ? '— ' + d : ''); process.exitCode = 1; }

// Save current selection on the visual editor, open the modal, pick a chip,
// then read back the editor HTML to inspect the inserted anchor.
async function pickCrossRef(page, kind, num, selectText) {
  return page.evaluate(({ kind, num, selectText }) => {
    const visual = document.getElementById('ft-visual');
    if (!visual) throw new Error('ft-visual not found');
    visual.focus();

    // Optionally place a selection around a known token in the visual editor.
    if (selectText) {
      const tw = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = tw.nextNode())) {
        const idx = (node.nodeValue || '').indexOf(selectText);
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + selectText.length);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          break;
        }
      }
    } else {
      // Park cursor at the very end so insertHTML lands somewhere predictable.
      const range = document.createRange();
      range.selectNodeContents(visual);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // saveCrossRefSelection runs on the toolbar button's mousedown; call
    // it directly so the test doesn't have to actually click through the
    // toolbar HTML (which would re-steal focus).
    saveCrossRefSelection('ft');
    insertCrossRef('ft', kind, num);
    return visual.innerHTML;
  }, { kind, num, selectText });
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  try {
    // Use a real article we know has figures/tables/references (2849).
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });
    await page.evaluate(() => { window.location.hash = '#/articles/2849'; });
    await new Promise((r) => setTimeout(r, 2500));
    await page.waitForSelector('#ft-visual', { timeout: 8000 });
    await page.evaluate(() => {
      const btn = document.querySelector('.tab-btn[data-tab="fulltext"]');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));

    // ── T1: Toolbar exposes the "Otomatik Düzenle" button ─────────────────
    // (The old "Atıf" toolbar button was replaced by the on-selection bubble
    // — bubble handles all cross-ref insertion. The toolbar now hosts the
    // one-shot "Otomatik Düzenle" button instead.)
    console.log('=== T1: Toolbar exposes the Otomatik Düzenle button ===');
    const hasButton = await page.evaluate(() => {
      const toolbar = document.getElementById('ft-toolbar');
      if (!toolbar) return false;
      const btn = Array.from(toolbar.querySelectorAll('button'))
        .find((b) => /Otomatik\s*D[uü]zenle/i.test(b.textContent || ''));
      return !!btn;
    });
    if (hasButton) pass('"Otomatik Düzenle" button rendered in FT toolbar');
    else fail('"Otomatik Düzenle" button missing');

    // ── T2: scanner detects existing figures and references in 2849 ────────
    console.log('=== T2: Scanner finds existing targets in the editor body ===');
    const targets = await page.evaluate(() => _scanCrossRefTargets('ft'));
    if (targets.figures.length >= 5) {
      const nums = targets.figures.map((f) => f.num).join(',');
      pass(`figures detected: [${nums}]`);
    } else fail('figures not detected', JSON.stringify(targets));
    if (targets.refCount > 0) pass(`references detected: ${targets.refCount} items`);
    else fail('references not detected', JSON.stringify(targets));
    // Rich detection: figures should carry a thumbnail src and a caption text.
    const f1 = targets.figures[0];
    if (f1 && f1.thumbnail) pass(`figure 1 thumbnail extracted: ${f1.thumbnail}`);
    else fail('figure 1 missing thumbnail', JSON.stringify(f1));
    if (f1 && f1.caption) pass(`figure 1 caption extracted: "${f1.caption.slice(0, 40)}…"`);
    else fail('figure 1 missing caption', JSON.stringify(f1));

    // ── T3: insertCrossRef with a selection wraps the selected text ────────
    console.log('=== T3: Wraps selected text in figure anchor ===');
    // Place a known token in the editor we can find and select.
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const p = document.createElement('p');
      p.id = 'cr-test-p';
      p.innerHTML = 'See Figure 1 for details about TARGET_TOKEN_ONE.';
      visual.appendChild(p);
    });
    const html1 = await pickCrossRef(page, 'figure', 1, 'TARGET_TOKEN_ONE');
    if (/<a[^>]+href="#figure-1"[^>]+class="article-media-ref-link"[^>]*>TARGET_TOKEN_ONE<\/a>/.test(html1)) {
      pass('selection "TARGET_TOKEN_ONE" wrapped in figure-1 anchor');
    } else {
      fail('selection not wrapped correctly', html1.slice(-300));
    }

    // ── T4: insertCrossRef without selection uses default label ────────────
    console.log('=== T4: No selection → default "Figure N" label ===');
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const p = document.createElement('p');
      p.id = 'cr-test-p2';
      p.innerHTML = 'INSERT_HERE_SENTINEL';
      visual.appendChild(p);
      // Park cursor at end of new paragraph
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(p.firstChild, p.firstChild.nodeValue.length);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      saveCrossRefSelection('ft');
    });
    const html2 = await page.evaluate(() => {
      insertCrossRef('ft', 'figure', 3);
      return document.getElementById('cr-test-p2').innerHTML;
    });
    if (/INSERT_HERE_SENTINEL<a[^>]+href="#figure-3"[^>]+class="article-media-ref-link"[^>]*>Figure 3<\/a>/.test(html2)) {
      pass('default "Figure 3" label inserted after cursor');
    } else {
      fail('default label not inserted', html2);
    }

    // ── T5: Reference citation produces <sup><a class="article-ref-citation">...</a></sup>
    console.log('=== T5: Ref citation produces sup-wrapped anchor ===');
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const p = document.createElement('p');
      p.id = 'cr-test-p3';
      p.innerHTML = 'Recent studies REF_HERE confirm this.';
      visual.appendChild(p);
    });
    const html3 = await pickCrossRef(page, 'ref', 7, 'REF_HERE');
    if (/<sup><a[^>]+href="#ref-7"[^>]+class="article-ref-citation"[^>]*>REF_HERE<\/a><\/sup>/.test(html3)) {
      pass('ref-7 wrapped as <sup><a class="article-ref-citation">REF_HERE</a></sup>');
    } else {
      fail('ref citation HTML wrong', html3.slice(-300));
    }

    // ── T6: Table anchor works the same ────────────────────────────────────
    console.log('=== T6: Table anchor works ===');
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const p = document.createElement('p');
      p.id = 'cr-test-p4';
      p.innerHTML = 'see TBL_TOKEN below.';
      visual.appendChild(p);
    });
    const html4 = await pickCrossRef(page, 'table', 2, 'TBL_TOKEN');
    if (/<a[^>]+href="#table-2"[^>]+class="article-media-ref-link"[^>]*>TBL_TOKEN<\/a>/.test(html4)) {
      pass('table-2 anchor wraps selected text');
    } else {
      fail('table anchor incorrect', html4.slice(-300));
    }

    // ── T7: markDirty fires so save button knows there are unsaved changes ──
    console.log('=== T7: markDirty triggered after insert ===');
    const isDirty = await page.evaluate(() => typeof _formDirty !== 'undefined' ? _formDirty : null);
    if (isDirty === true) pass('markDirty() called by insertCrossRef');
    else fail('markDirty not triggered', 'dirty=' + isDirty);

    // ── T8: Floating bubble appears on selection ──────────────────────────
    console.log('=== T8: Floating bubble shows up at selection ===');
    // Add a clean paragraph so we have a known target token to highlight.
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const p = document.createElement('p');
      p.id = 'cr-bubble-test-p';
      p.innerHTML = 'For details see BUBBLE_TEST_TOKEN in the analysis.';
      visual.appendChild(p);
    });
    // Simulate the user dragging to select "BUBBLE_TEST_TOKEN".
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const tw = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = tw.nextNode())) {
        const idx = (node.nodeValue || '').indexOf('BUBBLE_TEST_TOKEN');
        if (idx < 0) continue;
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 'BUBBLE_TEST_TOKEN'.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        // selectionchange fires automatically when selection mutates.
        break;
      }
    });
    // Bubble render is on selectionchange + rAF; wait a moment.
    await new Promise((r) => setTimeout(r, 200));
    const bubbleVisible = await page.evaluate(() => {
      const b = document.getElementById('cr-bubble');
      return !!(b && !b.classList.contains('hidden'));
    });
    if (bubbleVisible) pass('bubble visible after non-empty selection');
    else fail('bubble not visible after selection');

    const bubbleContent = await page.evaluate(() => {
      const b = document.getElementById('cr-bubble');
      if (!b) return null;
      return {
        prefix: b.dataset.prefix,
        figureChipCount: b.querySelectorAll('[data-kind="figure"][data-num]').length,
        tableChipCount: b.querySelectorAll('[data-kind="table"][data-num]').length,
        refRowCount: b.querySelectorAll('.cr-ref-row[data-num]').length,
        figThumbCount: b.querySelectorAll('.cr-fig-thumb img').length,
        tabLabelText: (b.querySelector('.cr-tab-label') || {}).textContent || '',
        hasRefSearch: !!b.querySelector('.cr-ref-search'),
        refCountLabel: (b.querySelector('.cr-ref-count') || {}).textContent || '',
        // The position must be near the selection rectangle, not at top-left.
        topPx: parseInt(b.style.top || '0', 10),
        leftPx: parseInt(b.style.left || '0', 10),
      };
    });
    if (bubbleContent && bubbleContent.prefix === 'ft') pass('bubble bound to "ft" editor');
    else fail('bubble prefix wrong', JSON.stringify(bubbleContent));
    if (bubbleContent && bubbleContent.figureChipCount >= 5) pass(`bubble shows ${bubbleContent.figureChipCount} figure tiles`);
    else fail('figure tiles missing', JSON.stringify(bubbleContent));
    if (bubbleContent && bubbleContent.figThumbCount >= 5) pass(`bubble renders ${bubbleContent.figThumbCount} figure thumbnails`);
    else fail('thumbnails not rendered', JSON.stringify(bubbleContent));
    if (bubbleContent && bubbleContent.tabLabelText) pass(`first table label shown: "${bubbleContent.tabLabelText.slice(0, 36)}…"`);
    else fail('table label not shown', JSON.stringify(bubbleContent));
    if (bubbleContent && bubbleContent.refRowCount >= 20) pass(`bubble lists ${bubbleContent.refRowCount} ref rows`);
    else fail('ref rows missing', JSON.stringify(bubbleContent));
    if (bubbleContent && bubbleContent.hasRefSearch) pass('bubble has ref search input');
    else fail('ref search input missing');
    if (bubbleContent && /\d+\s*kaynak/i.test(bubbleContent.refCountLabel)) pass(`ref count label visible: "${bubbleContent.refCountLabel}"`);
    else fail('ref count label missing', JSON.stringify(bubbleContent));
    if (bubbleContent && (bubbleContent.topPx > 0 || bubbleContent.leftPx > 0)) {
      pass(`bubble positioned (top=${bubbleContent.topPx}, left=${bubbleContent.leftPx})`);
    } else fail('bubble not positioned');

    // Click a chip → bubble inserts anchor + hides itself.
    const afterChip = await page.evaluate(() => {
      const b = document.getElementById('cr-bubble');
      const chip = b.querySelector('[data-kind="figure"][data-num="2"]');
      chip.click();
      return {
        bubbleHidden: b.classList.contains('hidden'),
        para: document.getElementById('cr-bubble-test-p').innerHTML,
      };
    });
    if (afterChip.bubbleHidden) pass('bubble hides after chip click');
    else fail('bubble still visible after chip click');
    if (/<a[^>]+href="#figure-2"[^>]+class="article-media-ref-link"[^>]*>BUBBLE_TEST_TOKEN<\/a>/.test(afterChip.para)) {
      pass('chip click wrapped "BUBBLE_TEST_TOKEN" in figure-2 anchor');
    } else {
      fail('chip click did not wrap selection', afterChip.para);
    }

    // Collapsing the selection should hide the bubble again.
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const tw = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
      const node = tw.nextNode();
      if (node) {
        const range = document.createRange();
        range.setStart(node, 0);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    await new Promise((r) => setTimeout(r, 150));
    const stillVisible = await page.evaluate(() => {
      const b = document.getElementById('cr-bubble');
      return !!(b && !b.classList.contains('hidden'));
    });
    if (!stillVisible) pass('bubble hides when selection collapses');
    else fail('bubble still visible after selection collapsed');

    // ── T8b: Scanner auto-assigns IDs to figures that lack them ──────────
    // (Legacy / mirrored articles often have <figure class="article-figure">
    // without id="figure-N" — without IDs the bubble can't link to them.)
    console.log('=== T8b: Auto-ID assignment for figures without anchors ===');
    await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      // Inject two un-tagged figures to simulate legacy content.
      const fA = document.createElement('figure');
      fA.className = 'article-figure';
      fA.innerHTML = '<img src="x" alt=""><p>Untagged figure A caption.</p>';
      const fB = document.createElement('figure');
      fB.className = 'article-figure';
      fB.innerHTML = '<img src="x" alt=""><p>Untagged figure B caption.</p>';
      v.appendChild(fA);
      v.appendChild(fB);
    });
    const autoId = await page.evaluate(() => {
      _scanCrossRefTargets('ft'); // triggers _ensureMediaIds
      const v = document.getElementById('ft-visual');
      const figs = Array.from(v.querySelectorAll('figure'));
      const last2 = figs.slice(-2);
      return {
        ids: last2.map((f) => f.id),
        allTagged: figs.every((f) => /^(?:figure|fig)-\d+$/i.test(f.id)),
      };
    });
    if (autoId.allTagged && autoId.ids.every(Boolean)) {
      pass(`auto-assigned IDs to untagged figures: ${autoId.ids.join(', ')}`);
    } else fail('untagged figures not auto-tagged', JSON.stringify(autoId));

    // ── T8c: Live "var / yok" hint as the operator types ────────────────
    console.log('=== T8c: Manual input live hint reflects target existence ===');
    // Re-select something so the bubble is up with article 2849 in scope
    // (5 figures, 3 tables, 23 refs).
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const p = document.createElement('p');
      p.id = 'cr-hint-test-p';
      p.innerHTML = 'A short sentence with HINT_TARGET inside.';
      visual.appendChild(p);
      const tw = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = tw.nextNode())) {
        const idx = (node.nodeValue || '').indexOf('HINT_TARGET');
        if (idx < 0) continue;
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 'HINT_TARGET'.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        break;
      }
    });
    await new Promise((r) => setTimeout(r, 200));

    // T8c was the live "var/yok" hint test. The hint UI is gone now that
    // all three sections use action buttons rather than manual N inputs;
    // this block becomes a no-op smoke test confirming no stray hint
    // elements remain in the DOM.
    const noStaleHints = await page.evaluate(() => {
      const b = document.getElementById('cr-bubble');
      return b ? b.querySelectorAll('.cr-manual-hint').length === 0 : false;
    });
    if (noStaleHints) pass('no stale .cr-manual-hint elements remain');
    else fail('legacy hint elements still in bubble');

    // Refs search filter: type a query, only matching rows remain visible.
    const refSearch = await page.$('#cr-bubble .cr-ref-search');
    if (refSearch) {
      // Search by number "1" — should match the row whose num="1" (and
      // any other row whose snippet contains "1", e.g. years 2010-2024).
      await refSearch.click();
      await refSearch.type('1');
      await new Promise((r) => setTimeout(r, 150));
      const filterState = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#cr-bubble .cr-ref-row'));
        const visible = rows.filter((r) => r.style.display !== 'none');
        const hidden = rows.length - visible.length;
        return {
          totalRows: rows.length,
          visibleCount: visible.length,
          hiddenCount: hidden,
          ref1Visible: !!rows.find((r) => r.dataset.num === '1' && r.style.display !== 'none'),
        };
      });
      // The filter must actually hide at least some rows AND keep ref-1 visible.
      if (filterState.visibleCount > 0 && filterState.visibleCount < filterState.totalRows && filterState.ref1Visible) {
        pass(`search "1" filtered ${filterState.totalRows} → ${filterState.visibleCount} rows (ref-1 visible)`);
      } else fail('ref search filter not narrowing the list', JSON.stringify(filterState));

      // Clear search → all rows visible again
      await page.evaluate(() => {
        const i = document.querySelector('#cr-bubble .cr-ref-search');
        i.value = '';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await new Promise((r) => setTimeout(r, 100));
      const afterClear = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#cr-bubble .cr-ref-row'));
        return rows.filter((r) => r.style.display !== 'none').length;
      });
      if (afterClear >= 20) pass(`clearing search shows all ${afterClear} ref rows`);
      else fail('rows did not restore after clearing search', `count=${afterClear}`);
    } else {
      fail('ref search input not found');
    }

    // ── T8d: Toast announces success vs warning when inserting ───────────
    console.log('=== T8d: Toast confirms what was inserted ===');
    // Figure section now uses chip click (no manual N+Ekle). A click on the
    // figure-2 chip should fire the success toast.
    await page.evaluate(() => {
      const chip = document.querySelector('#cr-bubble [data-kind="figure"][data-num="2"]');
      if (chip) chip.click();
    });
    await new Promise((r) => setTimeout(r, 150));
    const toastSuccess = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('body *'))
        .filter((el) => !el.children.length)
        .map((el) => (el.textContent || '').trim())
        .filter((t) => /Figure 2 ba[gğ]land[iı]/i.test(t));
      return all[0] || null;
    });
    if (toastSuccess) pass(`success toast on chip click: "${toastSuccess}"`);
    else fail('no success toast after clicking figure chip');

    // For the warning case use the ref section which still has manual input.
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const p = document.createElement('p');
      p.id = 'cr-warn-test-p';
      p.innerHTML = 'Another line with WARN_TARGET here.';
      visual.appendChild(p);
      const tw = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = tw.nextNode())) {
        const idx = (node.nodeValue || '').indexOf('WARN_TARGET');
        if (idx < 0) continue;
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 'WARN_TARGET'.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        break;
      }
    });
    await new Promise((r) => setTimeout(r, 200));
    // Refs now use "+ Yeni Kaynak" form. Trigger the inline form to add a
    // new reference and verify the success toast says "Kaynak N eklendi".
    await page.evaluate(() => {
      document.querySelector('#cr-bubble [data-newref-toggle]').click();
    });
    await new Promise((r) => setTimeout(r, 100));
    await page.evaluate(() => {
      const ta = document.querySelector('#cr-bubble .cr-newref-text');
      ta.value = 'Test reference for crossref picker, JAMA. 2026;1:1-10.';
      document.querySelector('#cr-bubble .cr-newref-go').click();
    });
    await new Promise((r) => setTimeout(r, 250));
    const toastNew = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('body *'))
        .filter((el) => !el.children.length)
        .map((el) => (el.textContent || '').trim())
        .filter((t) => /Kaynak \d+ eklendi/i.test(t));
      return all[0] || null;
    });
    if (toastNew) pass(`"Yeni Kaynak" inline form added a ref + toast: "${toastNew}"`);
    else fail('"Yeni Kaynak" did not append a reference');

    // ── T8e: "Yeni Figür / Yeni Tablo" upload buttons ──────────────────────
    // The Galenos-style inline upload: clicking "Yeni Figür" opens a file
    // picker, uploads the chosen image, creates a <figure id="figure-N">
    // block in the editor body, and immediately wraps the saved selection
    // with a cross-reference to it.
    console.log('=== T8e: Inline figure/table upload buttons ===');
    // Verify all three sections use the "+ Yeni X" button pattern.
    const headerActions = await page.evaluate(() => {
      const b = document.getElementById('cr-bubble');
      if (!b) return null;
      const btns = Array.from(b.querySelectorAll('.cr-upload-btn'));
      return {
        figureBtn: btns.find((bt) => bt.dataset.uploadKind === 'figure') ? true : false,
        // Tables now open a paste dialog (data-insert-table) instead of a file
        // picker — Word/Excel content is inserted as a real <table>.
        tableBtn: !!b.querySelector('[data-insert-table]'),
        refBtn: !!b.querySelector('[data-newref-toggle]'),
        figureFileInput: !!b.querySelector('[data-upload-input="figure"]'),
        // The table file input intentionally no longer exists in the bubble.
        tableFileInput: !!b.querySelector('[data-upload-input="table"]'),
        newrefForm: !!b.querySelector('[data-newref-form]'),
        // Old manual N+Ekle markers should be gone everywhere
        anyManualInput: !!b.querySelector('input[data-manual-kind]'),
      };
    });
    if (headerActions && headerActions.figureBtn) pass('"+ Yeni Figür" button present');
    else fail('figure button missing', JSON.stringify(headerActions));
    if (headerActions && headerActions.tableBtn) pass('"+ Yeni Tablo" button present (paste dialog)');
    else fail('table button missing', JSON.stringify(headerActions));
    if (headerActions && headerActions.refBtn) pass('"+ Yeni Kaynak" button present');
    else fail('ref button missing', JSON.stringify(headerActions));
    if (headerActions && headerActions.figureFileInput) {
      pass('hidden figure file input present');
    } else fail('figure file input missing', JSON.stringify(headerActions));
    if (headerActions && !headerActions.tableFileInput) {
      pass('table no longer uses a file input (uses paste dialog)');
    } else fail('table still has a file input', JSON.stringify(headerActions));
    if (headerActions && headerActions.newrefForm) pass('"+ Yeni Kaynak" inline form present');
    else fail('newref form missing', JSON.stringify(headerActions));
    if (headerActions && !headerActions.anyManualInput) pass('legacy manual N+Ekle removed from all sections');
    else fail('legacy manual input still present', JSON.stringify(headerActions));

    // Try uploading. We can't really pick a file via Puppeteer's keyboard,
    // but we can simulate the upload flow by calling _uploadInlineMedia
    // directly with a synthetic Blob.
    console.log('--- programmatic upload flow ---');
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const p = document.createElement('p');
      p.id = 'cr-upload-test-p';
      p.innerHTML = 'A line for UPLOAD_TARGET token.';
      visual.appendChild(p);
      const tw = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = tw.nextNode())) {
        const idx = (node.nodeValue || '').indexOf('UPLOAD_TARGET');
        if (idx < 0) continue;
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 'UPLOAD_TARGET'.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        break;
      }
    });
    await new Promise((r) => setTimeout(r, 200));

    // Synthesize a 1x1 PNG and feed it through the upload pipeline.
    const uploadResult = await page.evaluate(async () => {
      // 1x1 transparent PNG bytes.
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'inline-upload-test.png', { type: 'image/png' });
      try {
        await _uploadInlineMedia('ft', 'figure', file);
        const para = document.getElementById('cr-upload-test-p');
        const figs = Array.from(document.querySelectorAll('#ft-visual figure[id^="figure-"]'));
        return {
          paraHtml: para ? para.innerHTML : null,
          lastFigId: figs.length ? figs[figs.length - 1].id : null,
          totalFigs: figs.length,
        };
      } catch (e) {
        return { error: e.message };
      }
    });
    if (uploadResult.error) {
      fail('upload pipeline threw', uploadResult.error);
    } else {
      if (uploadResult.lastFigId && /^figure-\d+$/.test(uploadResult.lastFigId)) {
        pass(`new figure block created in editor: ${uploadResult.lastFigId}`);
      } else fail('no new figure block', JSON.stringify(uploadResult));
      if (uploadResult.paraHtml && /<a[^>]+href="#figure-\d+"[^>]*>UPLOAD_TARGET<\/a>/.test(uploadResult.paraHtml)) {
        pass('cross-ref to new figure wraps "UPLOAD_TARGET"');
      } else fail('cross-ref not inserted', uploadResult.paraHtml);
    }

    // ── T10: Auto-link plain text + bare <sup> in the editor ──────────────
    // (Replaces the old T9 manual-input test. The bubble's _scanCrossRefTargets
    // now runs _autoLinkInEditor as a side effect — bare "Figure 1" text and
    // plain <sup>1</sup> citations get wrapped in editor immediately, the
    // same as on the public site.)
    console.log('=== T10: Auto-link plain mentions and bare <sup> citations ===');
    // Add un-linked text mentions of figure-1 (which exists in article 2849)
    // and a bare <sup>5</sup> citation pointing at ref-5.
    await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      const p = document.createElement('p');
      p.id = 'cr-autolink-p';
      p.innerHTML = 'See Figure 1 for clarity and earlier work<sup>5</sup> showed similar.';
      v.appendChild(p);
    });
    await page.evaluate(() => { _autoLinkInEditor(document.getElementById('ft-visual')); });
    const autoLinked = await page.evaluate(() => {
      const p = document.getElementById('cr-autolink-p');
      return p ? p.innerHTML : null;
    });
    if (/<a[^>]+href="#figure-1"[^>]+class="article-media-ref-link"[^>]*>Figure 1<\/a>/.test(autoLinked || '')) {
      pass('plain "Figure 1" text auto-wrapped in figure-1 anchor');
    } else fail('plain "Figure 1" not auto-linked', (autoLinked || '').slice(-200));
    if (/<sup><a[^>]+href="#ref-5"[^>]+class="article-ref-citation"[^>]*>5<\/a><\/sup>/.test(autoLinked || '')) {
      pass('bare <sup>5</sup> auto-wrapped in ref-5 anchor');
    } else fail('<sup>5</sup> not auto-linked', (autoLinked || '').slice(-200));

  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
