// E2E test — the "Otomatik Düzenle" full-text toolbar button.
// Workflow the editor cares about:
//   1. Paste plain Word text into Tam Metin (mentions like "Figure 1")
//   2. Upload figures via Dosyalar tab (files only — no figure blocks yet)
//   3. Click Otomatik Düzenle → figures get placed under their first mention
//      paragraph AND every plain-text mention turns into a teal anchor.
// We exercise the function directly (bypassing the actual toolbar click)
// because the article already exists and we can drive the editor DOM.

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
    // Use article 2849 — it already has 5 figures + 3 tables uploaded under
    // /api/media/article/2849/assets, but for this test we'll replace its
    // editor body with a plain-text "as if pasted from Word" so we can
    // verify auto-arrange picks the assets up from disk and places them.
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });
    await page.evaluate(() => { window.location.hash = '#/articles/2849'; });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => {
      const btn = document.querySelector('.tab-btn[data-tab="fulltext"]');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1200));

    // ── T1: Toolbar exposes the Otomatik Düzenle button ──────────────────
    console.log('=== T1: Otomatik Düzenle button on the FT toolbar ===');
    const hasBtn = await page.evaluate(() => {
      const tb = document.getElementById('ft-toolbar');
      return tb && Array.from(tb.querySelectorAll('button')).some((b) => /Otomatik\s*D[uü]zenle/i.test(b.textContent || ''));
    });
    if (hasBtn) pass('toolbar shows "Otomatik Düzenle" button');
    else fail('Otomatik Düzenle button missing from toolbar');

    // ── T2: Plant a plain-text body + run auto-arrange ────────────────────
    console.log('=== T2: Auto-arrange places uploaded figures under mention paragraphs ===');
    await page.evaluate(() => {
      // Wipe whatever is in the editor and plant a simple plain-text body
      // mimicking pasted Word content — no <figure> blocks yet.
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>Introduction paragraph about cancer subgroups.</p>' +
        '<p>The first observation is summarized in Figure 1. Detailed analysis follows.</p>' +
        '<p>Comparative subgroups are presented in Figures 2, 3 and 4.</p>' +
        '<p>Survival is shown in Figure 5.</p>' +
        '<h3>References</h3>' +
        '<ol><li>Smith J. Test ref. 2020.</li><li>Doe R. Another ref. 2021.</li></ol>';
    });

    // Run auto-arrange directly (the toolbar button calls this function).
    const before = await page.evaluate(() => ({
      figsInBody: document.querySelectorAll('#ft-visual figure[id^="figure-"]').length,
      anchorsBefore: document.querySelectorAll('#ft-visual a.article-media-ref-link').length,
    }));
    if (before.figsInBody === 0) pass('starting state: zero figure blocks in body');
    else fail('test setup wrong — body already has figures', JSON.stringify(before));

    await page.evaluate(() => _autoArrangeFullText('ft'));
    await new Promise((r) => setTimeout(r, 500));

    const after = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      const figs = Array.from(v.querySelectorAll('figure[id^="figure-"]'));
      // Check placement: figure-1 should sit immediately after the
      // paragraph mentioning "Figure 1".
      const fig1 = v.querySelector('figure#figure-1');
      const hostFig1 = fig1 ? fig1.previousElementSibling : null;
      const fig5 = v.querySelector('figure#figure-5');
      const hostFig5 = fig5 ? fig5.previousElementSibling : null;
      // figures 2, 3, 4 share a host paragraph; they should be siblings.
      const fig2 = v.querySelector('figure#figure-2');
      const fig3 = v.querySelector('figure#figure-3');
      const fig4 = v.querySelector('figure#figure-4');
      return {
        figIds: figs.map((f) => f.id),
        fig1HostText: hostFig1 ? (hostFig1.textContent || '').slice(0, 60) : null,
        fig5HostText: hostFig5 ? (hostFig5.textContent || '').slice(0, 60) : null,
        figs234Adjacent: !!(fig2 && fig3 && fig4
          && fig2.nextElementSibling === fig3 && fig3.nextElementSibling === fig4),
        anchorsAfter: v.querySelectorAll('a.article-media-ref-link').length,
        figure1AnchorPresent: !!v.querySelector('a[href="#figure-1"]'),
      };
    });

    if (after.figIds.length === 5 && after.figIds.join(',') === 'figure-1,figure-2,figure-3,figure-4,figure-5') {
      pass(`5 figures placed in numerical DOM order: ${after.figIds.join(', ')}`);
    } else fail('figure DOM order wrong', JSON.stringify(after.figIds));

    if (after.fig1HostText && /Figure 1/.test(after.fig1HostText)) {
      pass(`figure-1 lands under the paragraph that mentions "Figure 1"`);
    } else fail('figure-1 misplaced', JSON.stringify(after.fig1HostText));

    if (after.fig5HostText && /Figure 5/.test(after.fig5HostText)) {
      pass(`figure-5 lands under the paragraph that mentions "Figure 5"`);
    } else fail('figure-5 misplaced', JSON.stringify(after.fig5HostText));

    if (after.figs234Adjacent) {
      pass('figures 2, 3, 4 are consecutive (single shared host paragraph)');
    } else fail('figures 2-3-4 not adjacent in body');

    if (after.anchorsAfter >= 5 && after.figure1AnchorPresent) {
      pass(`auto-link produced ${after.anchorsAfter} cross-reference anchors`);
    } else fail('auto-link did not wrap mentions', JSON.stringify(after));

    // ── T3: Re-running is idempotent (no duplicates) ──────────────────────
    console.log('=== T3: Re-running auto-arrange is a no-op ===');
    await page.evaluate(() => _autoArrangeFullText('ft'));
    await new Promise((r) => setTimeout(r, 300));
    const reRun = await page.evaluate(() => ({
      figCount: document.querySelectorAll('#ft-visual figure[id^="figure-"]').length,
      figIds: Array.from(document.querySelectorAll('#ft-visual figure[id^="figure-"]')).map((f) => f.id),
    }));
    if (reRun.figCount === 5 && new Set(reRun.figIds).size === 5) {
      pass('re-running produces no duplicates (still 5 unique figures)');
    } else fail('re-run created duplicates', JSON.stringify(reRun));

    // ── T4: Only-refs path — when article has no figures/tables, still
    //       wire up <sup>N</sup> citations to ref-N.
    console.log('=== T4: Refs-only branch (no figs/tables) ===');
    await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>Body referencing earlier work<sup>1</sup> and a follow-up study<sup>2</sup>.</p>' +
        '<h3>References</h3>' +
        '<ol><li>First. 2020.</li><li>Second. 2021.</li></ol>';
    });
    // Make sure the article ID we use here has NO figures/tables that would
    // get inserted — switch to a known-empty AIP by hash if possible. For
    // simplicity we just rely on the disk state for 2849, which DOES have
    // figures, so we'll still see them placed. The point of this branch is
    // that ref citations get wired regardless.
    await page.evaluate(() => _autoArrangeFullText('ft'));
    await new Promise((r) => setTimeout(r, 300));
    const refLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#ft-visual sup a.article-ref-citation'))
        .map((a) => ({ href: a.getAttribute('href'), text: a.textContent }));
    });
    if (refLinks.length >= 2 && /#ref-1$/.test(refLinks[0].href) && /#ref-2$/.test(refLinks[1].href)) {
      pass(`citation auto-linking works: ${refLinks.length} <sup> citations wired`);
    } else fail('citations not wired to ref-N anchors', JSON.stringify(refLinks));

    // ── T5: Bracketed plain-text citations [1], [1,2], [1-3] auto-link ──
    console.log('=== T5: Bracketed plain-text citations ===');
    await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>Single bracket [1]. Comma list [2, 3]. Hyphen range [1-3]. Mixed prose with [4] inline.</p>' +
        '<p>Out-of-range should stay literal: [99 mg].</p>' +
        '<h3>References</h3>' +
        '<ol>' +
          '<li>First. 2020.</li><li>Second. 2021.</li><li>Third. 2022.</li>' +
          '<li>Fourth. 2023.</li><li>Fifth. 2024.</li>' +
        '</ol>';
    });
    await page.evaluate(() => _autoLinkInEditor(document.getElementById('ft-visual')));
    await new Promise((r) => setTimeout(r, 200));
    const bracketResult = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      const anchors = Array.from(v.querySelectorAll('p a.article-ref-citation'));
      return {
        hrefs: anchors.map((a) => a.getAttribute('href')),
        texts: anchors.map((a) => a.textContent),
        // Verify brackets survive: "[1]" should still read "[1]" after wrapping
        firstParaHtml: v.querySelector('p').innerHTML,
        outOfRangeUntouched: !!v.innerHTML.match(/\[99 mg\]/),
      };
    });
    if (bracketResult.hrefs.includes('#ref-1') && bracketResult.hrefs.includes('#ref-2')
        && bracketResult.hrefs.includes('#ref-3') && bracketResult.hrefs.includes('#ref-4')) {
      pass(`bracketed citations linked: ${bracketResult.hrefs.length} anchors`);
    } else fail('bracketed citations missing', JSON.stringify(bracketResult));
    if (/\[<a /.test(bracketResult.firstParaHtml) && /<\/a>\]/.test(bracketResult.firstParaHtml)) {
      pass('brackets preserved around anchors ([<a>N</a>])');
    } else fail('brackets stripped or anchors not inside brackets', bracketResult.firstParaHtml);
    if (bracketResult.outOfRangeUntouched) {
      pass('out-of-range "[99 mg]" left as literal text (not a citation)');
    } else fail('out-of-range bracket wrongly wrapped');

    // ── T6: Sup with nested <span> still gets wired (Word paste quirk) ──
    console.log('=== T6: Sup with inner <span> wrapper ===');
    await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>From Word: study<sup><span style="font-size:8pt">1</span></sup> and follow-up<sup><span lang="EN-US">2</span></sup>.</p>' +
        '<h3>References</h3>' +
        '<ol><li>One.</li><li>Two.</li></ol>';
    });
    await page.evaluate(() => _autoLinkInEditor(document.getElementById('ft-visual')));
    await new Promise((r) => setTimeout(r, 200));
    const supSpan = await page.evaluate(() => {
      const supAnchors = Array.from(document.querySelectorAll('#ft-visual sup a.article-ref-citation'));
      return supAnchors.map((a) => a.getAttribute('href'));
    });
    if (supAnchors_OK(supSpan)) {
      pass(`Word-style <sup><span>N</span></sup> wired: ${supSpan.join(', ')}`);
    } else fail('sup-with-span citations missed', JSON.stringify(supSpan));

    function supAnchors_OK(arr) {
      return arr.includes('#ref-1') && arr.includes('#ref-2');
    }

    // ── T7: Sub-figure letters: "Figure 1A" / "Figs. 2a-2c" auto-link ──
    console.log('=== T7: Sub-figure letter mentions ===');
    await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>Histology is shown in Figure 1A and Figure 1B.</p>' +
        '<p>Survival curves Figs. 2a, 2b are paired.</p>' +
        '<figure id="figure-1"><img src="/site/images/articles/2849/figure-1.png" alt="x"><p>FIG. 1.</p></figure>' +
        '<figure id="figure-2"><img src="/site/images/articles/2849/figure-2.png" alt="x"><p>FIG. 2.</p></figure>';
    });
    await page.evaluate(() => _autoLinkInEditor(document.getElementById('ft-visual')));
    await new Promise((r) => setTimeout(r, 200));
    const subfig = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      const links = Array.from(v.querySelectorAll('p a.article-media-ref-link'));
      return links.map((a) => ({ href: a.getAttribute('href'), text: a.textContent }));
    });
    const has1A = subfig.some((l) => /#figure-1$/.test(l.href) && /1A/i.test(l.text));
    const has1B = subfig.some((l) => /#figure-1$/.test(l.href) && /1B/i.test(l.text));
    const has2a = subfig.some((l) => /#figure-2$/.test(l.href) && /2a/i.test(l.text));
    const has2b = subfig.some((l) => /#figure-2$/.test(l.href) && /2b/i.test(l.text));
    if (has1A && has1B && has2a && has2b) {
      pass(`sub-figure mentions wired: 1A, 1B → #figure-1; 2a, 2b → #figure-2`);
    } else fail('sub-figure letter auto-link incomplete', JSON.stringify(subfig));

    // ── T7b: Reference list gets backlinks to in-text citations ──
    console.log('=== T7b: Backlinks from References → in-text citations ===');
    await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>Background paragraph cites two works<sup>1</sup> and another<sup>2</sup>.</p>' +
        '<p>Discussion cites the first work again<sup>1</sup>. Brackets [3] also work.</p>' +
        '<h3>References</h3>' +
        '<ol>' +
          '<li>Smith J. First. 2020.</li>' +
          '<li>Doe R. Second. 2021.</li>' +
          '<li>Jones K. Third. 2022.</li>' +
          '<li>Wong L. Never cited. 2023.</li>' +
        '</ol>';
    });
    await page.evaluate(() => _autoLinkInEditor(document.getElementById('ft-visual')));
    await new Promise((r) => setTimeout(r, 200));
    const back = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      const lis = Array.from(v.querySelectorAll('ol > li'));
      return lis.map((li) => {
        const backlinks = Array.from(li.querySelectorAll('.article-ref-backlink'))
          .map((a) => a.getAttribute('href'));
        return { id: li.id, backlinks };
      });
    });
    // Ref 1 cited twice → two backlinks (↩¹ ↩²)
    if (back[0].id === 'ref-1' && back[0].backlinks.length === 2
        && back[0].backlinks.includes('#cite-ref-1-1')
        && back[0].backlinks.includes('#cite-ref-1-2')) {
      pass('ref-1 (cited twice) gets two backlinks ↩¹ ↩²');
    } else fail('ref-1 backlinks wrong', JSON.stringify(back[0]));
    // Ref 2 cited once → single ↩
    if (back[1].id === 'ref-2' && back[1].backlinks.length === 1
        && back[1].backlinks[0] === '#cite-ref-2-1') {
      pass('ref-2 (cited once) gets single backlink ↩');
    } else fail('ref-2 backlink wrong', JSON.stringify(back[1]));
    // Ref 3 cited via [3] bracket → single ↩
    if (back[2].id === 'ref-3' && back[2].backlinks.length === 1
        && back[2].backlinks[0] === '#cite-ref-3-1') {
      pass('ref-3 (bracketed citation) gets backlink');
    } else fail('ref-3 backlink missing for bracketed citation', JSON.stringify(back[2]));
    // Ref 4 never cited → no backlink
    if (back[3].id === 'ref-4' && back[3].backlinks.length === 0) {
      pass('ref-4 (never cited) has no backlink');
    } else fail('ref-4 should have no backlinks', JSON.stringify(back[3]));
    // Each in-text citation got its own id
    const citIds = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#ft-visual a.article-ref-citation'))
        .map((a) => ({ id: a.id, href: a.getAttribute('href') }));
    });
    const firstRef1Cit = citIds.find((c) => c.href === '#ref-1' && c.id === 'cite-ref-1-1');
    const secondRef1Cit = citIds.find((c) => c.href === '#ref-1' && c.id === 'cite-ref-1-2');
    if (firstRef1Cit && secondRef1Cit) {
      pass('in-text citations got unique ids: cite-ref-1-1, cite-ref-1-2');
    } else fail('citation ids not assigned correctly', JSON.stringify(citIds));

    // ── T7d: Word-pasted REFERENCES heading (<p><b>REFERENCES</b></p>) ──
    //   This is the article 2867 shape: the REFERENCES line isn't a real
    //   <h*> element, it's a bold paragraph. Auto-arrange should still
    //   recognise it, normalise the MsoListParagraph entries into an <ol>,
    //   and wire up backlinks.
    console.log('=== T7d: Word-paste REFERENCES heading (no <h*> element) ===');
    await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p class="MsoNormal">Body cites first work<sup>1</sup> and second<sup>2</sup>. First again<sup>1</sup>.</p>' +
        '<p class="MsoNormal"><b><span lang="EN-US">REFERENCES</span></b></p>' +
        '<p class="MsoListParagraphCxSpFirst" style="text-indent:-18pt;mso-list:l0 level1 lfo1">' +
          '<span style="mso-list:Ignore">1.&nbsp;&nbsp;&nbsp;</span>' +
          '<span>Smith J. First. 2020;1:1-10.</span></p>' +
        '<p class="MsoListParagraphCxSpMiddle" style="text-indent:-18pt;mso-list:l0 level1 lfo1">' +
          '<span style="mso-list:Ignore">2.&nbsp;&nbsp;&nbsp;</span>' +
          '<span>Doe R. Second. 2021;2:2-20.</span></p>' +
        '<p class="MsoListParagraphCxSpLast" style="text-indent:-18pt;mso-list:l0 level1 lfo1">' +
          '<span style="mso-list:Ignore">3.&nbsp;&nbsp;&nbsp;</span>' +
          '<span>Jones K. Third (uncited). 2022;3:30-40.</span></p>';
    });
    // Run the normaliser first (Otomatik Düzenle does this for us), then auto-link.
    await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      _normalizeMsoReferenceList(v);
      _autoLinkInEditor(v);
    });
    await new Promise((r) => setTimeout(r, 200));
    const wordPaste = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      const ol = v.querySelector('.article-references ol');
      if (!ol) return { ok: false, reason: 'no .article-references ol created' };
      const lis = Array.from(ol.querySelectorAll(':scope > li'));
      return {
        ok: true,
        refCount: lis.length,
        liIds: lis.map((li) => li.id),
        backlinkCounts: lis.map((li) => li.querySelectorAll('.article-ref-backlink').length),
        firstLiText: (lis[0] && lis[0].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
      };
    });
    if (wordPaste.ok && wordPaste.refCount === 3) {
      pass(`Mso list normalised: 3 <li id="ref-N"> entries created from Word paragraphs`);
    } else fail('Mso normalisation failed', JSON.stringify(wordPaste));
    if (wordPaste.ok && wordPaste.backlinkCounts[0] === 2 && wordPaste.backlinkCounts[1] === 1 && wordPaste.backlinkCounts[2] === 0) {
      pass(`backlinks added: ref-1 → 2 (↩¹↩²), ref-2 → 1 (↩), ref-3 → 0 (uncited)`);
    } else fail('backlink counts wrong on Word-pasted refs', JSON.stringify(wordPaste));
    if (wordPaste.ok && /^Smith J\. First/.test(wordPaste.firstLiText)) {
      pass(`first <li> content cleaned (no leading "1." prefix): "${wordPaste.firstLiText}"`);
    } else fail('first <li> content not cleaned', wordPaste.firstLiText);

    // ── T7c: Re-running Pass 3 is idempotent (no duplicate backlinks) ──
    console.log('=== T7c: Backlink rendering is idempotent ===');
    await page.evaluate(() => _autoLinkInEditor(document.getElementById('ft-visual')));
    await page.evaluate(() => _autoLinkInEditor(document.getElementById('ft-visual')));
    const reRunBack = await page.evaluate(() => {
      const li1 = document.getElementById('ref-1');
      return {
        backlinkContainers: li1 ? li1.querySelectorAll('.article-ref-backlinks').length : 0,
        backlinks: li1 ? li1.querySelectorAll('.article-ref-backlink').length : 0,
      };
    });
    if (reRunBack.backlinkContainers === 1 && reRunBack.backlinks === 2) {
      pass('re-running auto-link does not duplicate backlinks (still 1 container, 2 links)');
    } else fail('idempotency broken', JSON.stringify(reRunBack));

    // ── T8: _extractMediaNum parses panel letters ──
    console.log('=== T8: _extractMediaNum panel letter parsing ===');
    const parseProbe = await page.evaluate(() => {
      const cases = [
        ['figure-1.png', 'figure'],
        ['figure-1a.png', 'figure'],
        ['figure-1A.png', 'figure'],
        ['BalkanMedJ-43-2-figure-3B.png', 'figure'],
        ['fig01.jpg', 'figure'],
        ['f1c.png', 'figure'],
        ['table-2.png', 'table'],
        ['table-2b.jpg', 'table'],
        ['t3a.png', 'table'],
        ['random.png', 'figure'],
      ];
      return cases.map(([fn, kind]) => ({ fn, kind, res: _extractMediaNum(fn, kind) }));
    });
    const want = {
      'figure-1.png': { num: 1, panel: null },
      'figure-1a.png': { num: 1, panel: 'a' },
      'figure-1A.png': { num: 1, panel: 'a' },
      'BalkanMedJ-43-2-figure-3B.png': { num: 3, panel: 'b' },
      'fig01.jpg': { num: 1, panel: null },
      'f1c.png': { num: 1, panel: 'c' },
      'table-2.png': { num: 2, panel: null },
      'table-2b.jpg': { num: 2, panel: 'b' },
      't3a.png': { num: 3, panel: 'a' },
      'random.png': null,
    };
    let parseOk = true;
    for (const row of parseProbe) {
      const exp = want[row.fn];
      const got = row.res;
      const matches = (exp === null && got === null)
        || (exp && got && exp.num === got.num && (exp.panel || null) === (got.panel || null));
      if (!matches) { parseOk = false; console.log('     mismatch:', row.fn, 'got', JSON.stringify(got), 'want', JSON.stringify(exp)); }
    }
    if (parseOk) pass('all 10 filename probes return correct { num, panel }');
    else fail('_extractMediaNum panel parsing wrong on at least one filename');

  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
