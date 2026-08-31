// E2E tests for the fixes that came out of the 2026-05-21 full-text audit:
//   1. Multi-number auto-link (Figures 1, 2, 3 → each linked individually)
//   2. Subfigure letters preserved (Figure 1A → links to figure-1)
//   3. Turkish + variant reference headings (Kaynaklar / Kaynakça / Bibliography)
//   4. Reference normaliser tolerates filler elements between Mso paragraphs
//   5. Load-time normalisation does NOT trigger "unsaved changes" indicator
//   6. Cross-ref insertion to a missing target tags the anchor as broken
//   7. Adding the missing target later heals previously-broken anchors

const puppeteer = require('puppeteer');

const BASE = process.env.BASE_URL || 'http://localhost:3098';

function pass(n) { console.log('  PASS:', n); }
function fail(n, d) { console.log('  FAIL:', n, d ? '— ' + d : ''); process.exitCode = 1; }

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  try {
    // Use article 2849 — has 5 figures, 3 tables, 23 references.
    await page.goto(BASE + '/site/article.html?id=2849', { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForSelector('.article-body', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1500));

    // ── T1: Multi-number sequences get one anchor per number ──────────────
    console.log('=== T1: Multi-number "Figures 1, 2 and 3" auto-linking ===');
    const multi = await page.evaluate(() => {
      const body = document.querySelector('.article-body');
      // Inject a paragraph with multi-number mentions in several formats.
      const tests = [
        '<p id="multi-test-a">First sentence mentions Figures 1, 2 and 3 in one go.</p>',
        '<p id="multi-test-b">Range form: see Figs. 2-4 for details.</p>',
        '<p id="multi-test-c">Turkish form: Şekiller 1 ve 2 birlikte sunulmuştur.</p>',
        '<p id="multi-test-d">Subfigure: Figure 1A shows the top panel.</p>',
        '<p id="multi-test-e">Comma & "and": Tables 1, 2 and 3 illustrate.</p>',
      ];
      // Append at top of body so positions are predictable.
      tests.reverse().forEach((html) => body.insertAdjacentHTML('afterbegin', html));
      // Re-run the autolinker on the body. The function is exposed at
      // window.autoLinkPlainMediaMentions by article.html for tests.
      body.removeAttribute('data-media-autolinked');
      if (window.autoLinkPlainMediaMentions) window.autoLinkPlainMediaMentions(body);
      const link = (id) => {
        const p = document.getElementById(id);
        if (!p) return null;
        return Array.from(p.querySelectorAll('a')).map((a) => ({
          href: a.getAttribute('href'),
          text: a.textContent,
        }));
      };
      return {
        a: link('multi-test-a'),
        b: link('multi-test-b'),
        c: link('multi-test-c'),
        d: link('multi-test-d'),
        e: link('multi-test-e'),
      };
    });
    // T1a: "Figures 1, 2 and 3" → 3 anchors
    if (multi.a && multi.a.length >= 3
        && /#figure-1$/.test(multi.a[0].href)
        && /#figure-2$/.test(multi.a[1].href)
        && /#figure-3$/.test(multi.a[2].href)) {
      pass('"Figures 1, 2 and 3" produces 3 anchors → figure-1, figure-2, figure-3');
    } else fail('multi-number not split into per-number anchors', JSON.stringify(multi.a));

    // T1b: "Figs. 2-4" range — link the endpoints (figure-2 + figure-4) and
    // leave the dash as plain text. Inner numbers in ranges aren't enumerated
    // (would require expansion logic that's a separate enhancement).
    if (multi.b && multi.b.length >= 2
        && /#figure-2$/.test(multi.b[0].href)
        && /#figure-4$/.test(multi.b[1].href)) {
      pass('"Figs. 2-4" range produces endpoint anchors → figure-2 + figure-4');
    } else fail('range "Figs. 2-4" not split correctly', JSON.stringify(multi.b));

    // T1c: Turkish "Şekiller 1 ve 2" → 2 anchors
    if (multi.c && multi.c.length >= 2
        && /#figure-1$/.test(multi.c[0].href)
        && /#figure-2$/.test(multi.c[1].href)) {
      pass('"Şekiller 1 ve 2" → figure-1, figure-2');
    } else fail('Turkish "ve" separator not handled', JSON.stringify(multi.c));

    // T1d: "Figure 1A" → one anchor, text preserves "A"
    if (multi.d && multi.d.length >= 1
        && /#figure-1$/.test(multi.d[0].href)
        && /Figure 1A/.test(multi.d[0].text)) {
      pass(`subfigure "Figure 1A" wrapped, text preserves "A": "${multi.d[0].text}"`);
    } else fail('subfigure letter not preserved', JSON.stringify(multi.d));

    // T1e: Tables 1, 2 and 3 → 3 anchors
    if (multi.e && multi.e.length >= 3
        && /#table-1$/.test(multi.e[0].href)
        && /#table-2$/.test(multi.e[1].href)
        && /#table-3$/.test(multi.e[2].href)) {
      pass('"Tables 1, 2 and 3" → table-1, table-2, table-3');
    } else fail('multi-table not split', JSON.stringify(multi.e));

    // ── T2: Turkish reference heading triggers normalisation ──────────────
    console.log('=== T2: Turkish "Kaynaklar" heading + Mso paragraphs normalised ===');
    const trRefs = await page.evaluate(() => {
      const body = document.createElement('div');
      document.body.appendChild(body);
      body.className = 'article-body';
      body.innerHTML =
        '<h3>Kaynaklar</h3>' +
        '<p class="MsoListParagraphCxSpFirst"><span style="mso-list:Ignore">1.</span> First Turkish ref.</p>' +
        '<p class="MsoListParagraphCxSpMiddle"><span style="mso-list:Ignore">2.</span> Second ref.</p>' +
        '<p class="MsoListParagraphCxSpMiddle"><span style="mso-list:Ignore">3.</span> Third ref.</p>' +
        '<p class="MsoListParagraphCxSpLast"><span style="mso-list:Ignore">4.</span> Fourth ref.</p>';
      // normalizeMsoReferenceList is exposed for tests.
      const ok = window.normalizeMsoReferenceList(body);
      const ol = body.querySelector('ol.article-references-ol');
      return {
        ok,
        olItems: ol ? ol.querySelectorAll(':scope > li').length : 0,
        firstId: ol && ol.querySelector(':scope > li') ? ol.querySelector(':scope > li').id : null,
      };
    });
    if (trRefs.ok && trRefs.olItems === 4 && trRefs.firstId === 'ref-1') {
      pass('Turkish "Kaynaklar" heading recognised, 4 refs normalised');
    } else fail('Turkish heading not recognised', JSON.stringify(trRefs));

    // ── T3: Filler elements between Mso paragraphs are tolerated ─────────
    console.log('=== T3: Mso normaliser walks past empty <p> / <br> fillers ===');
    const filler = await page.evaluate(() => {
      const body = document.createElement('div');
      document.body.appendChild(body);
      body.innerHTML =
        '<h3>References</h3>' +
        '<p class="MsoListParagraphCxSpFirst"><span style="mso-list:Ignore">1.</span> A.</p>' +
        '<p></p>' +                  // empty filler
        '<p class="MsoListParagraphCxSpMiddle"><span style="mso-list:Ignore">2.</span> B.</p>' +
        '<br>' +
        '<p class="MsoListParagraphCxSpLast"><span style="mso-list:Ignore">3.</span> C.</p>';
      const ok = window.normalizeMsoReferenceList(body);
      const ol = body.querySelector('ol.article-references-ol');
      return { ok, olItems: ol ? ol.querySelectorAll(':scope > li').length : 0 };
    });
    if (filler.ok && filler.olItems === 3) {
      pass(`Mso normaliser tolerates filler — 3 refs collapsed despite empty <p> + <br>`);
    } else fail('filler tolerance broken', JSON.stringify(filler));

    // ── T4: Load-time normalise does not trip "unsaved changes" ──────────
    console.log('=== T4: Suppress-dirty during admin load-time normalise ===');
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });
    await page.evaluate(() => { window.location.hash = '#/articles/2849'; });
    await new Promise((r) => setTimeout(r, 2800));
    await page.evaluate(() => {
      const btn = document.querySelector('.tab-btn[data-tab="fulltext"]');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1500));
    // After load, _formDirty must still be false — user hasn't touched anything.
    const dirtyState = await page.evaluate(() => {
      return typeof _formDirty !== 'undefined' ? _formDirty : null;
    });
    if (dirtyState === false) pass('load-time normalisation did NOT mark form dirty');
    else fail('load-time normalisation tripped dirty flag', 'dirty=' + dirtyState);

    // After USER edits something, dirty IS marked — confirm the suppress
    // flag was lifted properly so real edits still register.
    await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      if (visual) {
        visual.focus();
        const r = document.createRange();
        const tw = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
        const node = tw.nextNode();
        if (node) {
          r.setStart(node, 0); r.collapse(true);
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          document.execCommand('insertText', false, 'USER_EDIT ');
        }
      }
    });
    await new Promise((r) => setTimeout(r, 200));
    const dirtyAfterEdit = await page.evaluate(() => typeof _formDirty !== 'undefined' ? _formDirty : null);
    if (dirtyAfterEdit === true) pass('user edit DOES still mark form dirty (suppress flag reset correctly)');
    else fail('user edit failed to mark dirty', 'dirty=' + dirtyAfterEdit);

    // ── T5: Insert cross-ref to missing target → broken anchor flagged ───
    console.log('=== T5: Broken anchor styling for missing targets ===');
    await page.evaluate(() => {
      // Park a clean paragraph + selection on it.
      const visual = document.getElementById('ft-visual');
      const p = document.createElement('p');
      p.id = 'broken-ref-test-p';
      p.innerHTML = 'Reference to BROKEN_TOKEN below.';
      visual.appendChild(p);
      const tw = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = tw.nextNode())) {
        if ((node.nodeValue || '').includes('BROKEN_TOKEN')) {
          const r = document.createRange();
          r.setStart(node, node.nodeValue.indexOf('BROKEN_TOKEN'));
          r.setEnd(node, node.nodeValue.indexOf('BROKEN_TOKEN') + 'BROKEN_TOKEN'.length);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          break;
        }
      }
      saveCrossRefSelection('ft');
      // Insert link to a figure that doesn't exist (article only has 1-5).
      insertCrossRef('ft', 'figure', 99);
    });
    const brokenState = await page.evaluate(() => {
      const a = document.querySelector('#broken-ref-test-p a[href="#figure-99"]');
      return a ? {
        hasClass: a.classList.contains('article-ref-broken'),
        title: a.getAttribute('title'),
        dataBroken: a.getAttribute('data-broken-ref'),
      } : null;
    });
    if (brokenState && brokenState.hasClass && brokenState.dataBroken === 'figure-99') {
      pass('cross-ref to missing figure-99 is flagged as broken');
    } else fail('broken anchor not marked', JSON.stringify(brokenState));
    if (brokenState && brokenState.title) pass(`tooltip explains: "${brokenState.title}"`);
    else fail('broken anchor missing tooltip');

    // ── T6: Adding the matching target heals the previously-broken anchor ─
    console.log('=== T6: Validator heals broken anchors when target is added ===');
    // Manually inject a figure-99 block, then call the validator.
    const healed = await page.evaluate(() => {
      const visual = document.getElementById('ft-visual');
      const fig = document.createElement('figure');
      fig.id = 'figure-99';
      fig.className = 'article-figure';
      fig.innerHTML = '<img src="" alt="Figure 99"><p>FIG. 99.</p>';
      visual.appendChild(fig);
      _validateCrossRefAnchors(visual);
      const a = document.querySelector('a[href="#figure-99"]');
      return a ? {
        hasBroken: a.classList.contains('article-ref-broken'),
        dataBroken: a.getAttribute('data-broken-ref'),
        title: a.getAttribute('title'),
      } : null;
    });
    if (healed && !healed.hasBroken && !healed.dataBroken) {
      pass('previously-broken anchor healed once figure-99 exists');
    } else fail('anchor still flagged broken after target added', JSON.stringify(healed));

  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
