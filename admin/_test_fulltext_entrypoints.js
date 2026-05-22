// E2E test — same enhancers must apply regardless of which list page the user
// navigated from. All three (current-issue, articles-in-press, archive) route
// to article.html with different `source=` query params. Verify each variant
// produces the same enhanced layout.

const puppeteer = require('puppeteer');

const BASE = process.env.BASE_URL || 'http://localhost:3098';

function pass(name) { console.log('  PASS:', name); }
function fail(name, detail) { console.log('  FAIL:', name, detail ? '— ' + detail : ''); process.exitCode = 1; }

// Pick one article ID per entry point. 2811 is in standard ARTICLES;
// for AIP we'll discover one from the in-press data file; archive uses
// the same standard article with archive params on the URL.
async function discoverAipId(page) {
  await page.goto(BASE + '/site/articles-in-press.html', { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  return page.evaluate(() => {
    if (!window.ARTICLES_IN_PRESS || !window.ARTICLES_IN_PRESS.length) return null;
    // Prefer one with at least one figure in its full-text file.
    return String(window.ARTICLES_IN_PRESS[0].id);
  });
}

async function checkEnhancers(page, url, label) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
  // Wait for the full-text injection. Some articles may not have figures,
  // so first ensure article-body exists, then check for the enhancement markers.
  await page.waitForSelector('.article-body', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1200));

  const result = await page.evaluate(() => {
    const body = document.querySelector('.article-body');
    if (!body) return { error: 'no .article-body' };
    return {
      hasArticleBody: true,
      // Enhancer markers — these attributes are set by my enhancers after they run.
      relocated: body.getAttribute('data-media-relocated'),
      autoLinked: body.getAttribute('data-media-autolinked'),
      figCaptionsNormalized: body.getAttribute('data-fig-captions-normalized'),
      refCitationsReady: body.getAttribute('data-ref-citations-ready'),
      // Sanity counts so we can tell which enhancers had any work to do.
      figureCount: body.querySelectorAll('figure[id^="figure-"], figure[id^="fig-"]').length,
      mediaLinkCount: body.querySelectorAll('a.article-media-ref-link').length,
      refCitationCount: body.querySelectorAll('a.article-ref-citation').length,
      hasReferencesBlock: !!body.querySelector('.article-references'),
      // Figure caption shape — first figure should have a bold "FIG. N." prefix
      // and no redundant "Figure N" top label.
      firstFig: (() => {
        const fig = body.querySelector('figure[id^="figure-"]');
        if (!fig) return null;
        const topCaps = Array.from(fig.children).filter((c) => c.tagName === 'FIGCAPTION')
          .map((c) => (c.textContent || '').trim());
        const captionP = Array.from(fig.children).find((c) => c.tagName === 'P' && (c.textContent || '').trim());
        return {
          id: fig.id,
          topCaps,
          captionFirstChild: captionP && captionP.firstElementChild ? captionP.firstElementChild.tagName : null,
          captionStart: captionP ? (captionP.textContent || '').trim().slice(0, 25) : null,
        };
      })(),
      // Figure ordering — IDs must be numerically ascending.
      figIdsInOrder: Array.from(body.querySelectorAll('figure[id^="figure-"]')).map((f) => f.id),
    };
  });

  console.log(`  — ${label}: ${url}`);
  if (result.error) { fail(`${label}: no body`, result.error); return; }

  // The citation enhancer only sets its marker when it actually wires anything
  // — an AIP / short article without a <References> block legitimately has
  // nothing to do. Accept either: enhancer ran, OR there was nothing to wire.
  if (result.refCitationsReady === 'true') pass(`${label}: citation enhancer wired bibliography (refCitationsReady)`);
  else if (!result.hasReferencesBlock) pass(`${label}: no References block in this article (citation enhancer is a no-op, correct)`);
  else fail(`${label}: citation enhancer didn't run despite References block present`, JSON.stringify(result));

  // figCaptionsNormalized and the relocate/autoLink markers are only set when
  // there's something to do. For articles with no figures at all, we don't
  // expect markers — that's fine. For articles WITH figures, the markers
  // should appear.
  if (result.figureCount > 0) {
    if (result.figCaptionsNormalized === 'true') pass(`${label}: figure caption normalizer ran (${result.figureCount} figures)`);
    else fail(`${label}: figure normalizer didn't run despite ${result.figureCount} figures present`);

    if (result.relocated === 'true') pass(`${label}: figure relocator ran`);
    else fail(`${label}: relocator didn't run despite figures present`);

    // First figure must have FIG. N. prefix and no top label.
    const f = result.firstFig;
    if (f && f.topCaps.length === 0) pass(`${label}: first figure has no redundant top label`);
    else fail(`${label}: first figure top label still present`, JSON.stringify(f && f.topCaps));
    if (f && f.captionFirstChild === 'STRONG' && /^FIG\.\s*\d/i.test(f.captionStart)) {
      pass(`${label}: first figure caption starts with "${f.captionStart}…"`);
    } else fail(`${label}: first figure caption not normalized`, JSON.stringify(f));

    // Figures should be in numerical order.
    const sorted = result.figIdsInOrder.slice().sort((a, b) => {
      const na = parseInt(a.split('-')[1], 10);
      const nb = parseInt(b.split('-')[1], 10);
      return na - nb;
    });
    if (sorted.join(',') === result.figIdsInOrder.join(',')) {
      pass(`${label}: figures in numerical order [${result.figIdsInOrder.join(', ')}]`);
    } else fail(`${label}: figures out of numerical order`, `got=${result.figIdsInOrder.join(',')} expected=${sorted.join(',')}`);
  } else {
    console.log(`  NOTE: ${label} has no figures — skipped figure-specific checks`);
  }

  if (result.mediaLinkCount > 0) pass(`${label}: ${result.mediaLinkCount} figure/table reference link(s) styled`);
  if (result.refCitationCount > 0) pass(`${label}: ${result.refCitationCount} citation(s) linked to bibliography`);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  try {
    // 1) Standard article (from current issue / homepage browsing).
    console.log('=== Entry point 1: current issue (standard article URL) ===');
    await checkEnhancers(page, BASE + '/site/article.html?id=2849', 'current-issue');

    // 2) Same article navigated via archive: extra query params, same renderer.
    console.log('=== Entry point 2: archive (with year/volume/issue params) ===');
    await checkEnhancers(
      page,
      BASE + '/site/article.html?id=2849&source=archive&year=2026&label=Volume%2043%2C%20Issue%204&volume=43&issue=4',
      'archive'
    );

    // 3) Articles in press: different data source (ARTICLES_IN_PRESS), source=aip param.
    console.log('=== Entry point 3: articles in press (source=aip) ===');
    const aipId = await discoverAipId(page);
    if (!aipId) {
      console.log('  SKIP: no articles-in-press in dataset');
    } else {
      await checkEnhancers(page, BASE + '/site/article.html?id=' + aipId + '&source=aip', 'aip');
    }

    // 4) Article 2811 from current issue — separate sanity (single-figure case
    // that fell into a different code path in earlier iterations).
    console.log('=== Entry point 4: single-figure article (sanity) ===');
    await checkEnhancers(page, BASE + '/site/article.html?id=2811', 'single-figure');

    // ── Word-style MsoListParagraph references get normalized to <ol> ────
    // Inline fixture: build a tiny article body that mimics what Word exports
    // (one MsoListParagraphCxSp* <p> per reference, "N." baked in via
    // mso-list:Ignore spans). Then run the normalizer and assert.
    // We use a synthetic page rather than depending on a specific article ID,
    // so the test survives normal admin cleanup of test fixtures.
    console.log('=== MsoListParagraph references normalized (synthetic fixture) ===');
    await page.goto(BASE + '/site/article.html?id=2811', { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForSelector('.article-body', { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 500));
    const refsState = await page.evaluate(() => {
      const body = document.querySelector('.article-body');
      // Append our synthetic Word-style references at the end and rerun the
      // normalizer + enhancer pair the live page exposes.
      const heading = document.createElement('h3');
      heading.textContent = 'References'; // exact match for normalizer regex
      const mkRefP = (n, text, cls) => `
        <p class="${cls}" style="text-indent:-18.0pt;mso-list:l0 level1 lfo1">
          <span style="mso-list:Ignore">${n}.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
          ${text}
        </p>`;
      const wrapper = document.createElement('div');
      wrapper.id = 'synthetic-refs';
      wrapper.appendChild(heading);
      wrapper.insertAdjacentHTML('beforeend', mkRefP(1, 'Smith J. First reference. Lancet. 2020;1:1-10.', 'MsoListParagraphCxSpFirst'));
      for (let i = 2; i < 5; i += 1) wrapper.insertAdjacentHTML('beforeend', mkRefP(i, `Author ${i}. Reference number ${i}. Journal. 202${i}.`, 'MsoListParagraphCxSpMiddle'));
      wrapper.insertAdjacentHTML('beforeend', mkRefP(5, 'Final author. Last reference. Nature. 2024.', 'MsoListParagraphCxSpLast'));
      body.appendChild(wrapper);
      // Now trigger the normaliser (the function lives on the page already).
      window.normalizeMsoReferenceList(wrapper);
      const ol = wrapper.querySelector('ol.article-references-ol');
      return {
        olItems: ol ? ol.querySelectorAll(':scope > li').length : 0,
        firstLiId: ol && ol.querySelector(':scope > li') ? ol.querySelector(':scope > li').id : null,
        msoLeftover: wrapper.querySelectorAll('p[class*="MsoListParagraph"]').length,
        firstLiStartsWithNumber: ol && ol.querySelector(':scope > li')
          ? /^\d+\./.test((ol.querySelector(':scope > li').textContent || '').trim())
          : null,
        firstLiText: ol && ol.querySelector(':scope > li')
          ? (ol.querySelector(':scope > li').textContent || '').trim().slice(0, 50)
          : null,
      };
    });
    if (refsState.olItems === 5) pass(`5 Word refs collapsed into <ol> with ${refsState.olItems} <li>`);
    else fail('reference <ol> wrong item count', JSON.stringify(refsState));
    if (refsState.firstLiId === 'ref-1') pass('first <li> has id="ref-1"');
    else fail('ref IDs missing', JSON.stringify(refsState));
    if (refsState.msoLeftover === 0) pass('no MsoListParagraph paragraphs left over');
    else fail('MsoListParagraph remnants', `count=${refsState.msoLeftover}`);
    if (refsState.firstLiStartsWithNumber === false) {
      pass('Word\'s literal "N." prefix stripped — first <li> begins with "' + (refsState.firstLiText || '') + '"');
    } else fail('first <li> still starts with hardcoded number', JSON.stringify(refsState));

    // Legacy (pre-JATS, openWin popup) articles keep their original
    // "preview card" rendering — we only verify that each card lands under
    // the paragraph that contains its openWin link (so reading flow is
    // intact). The card structure itself is intentionally left as
    // article-inline-media (per editorial decision 2026-05-21).
    console.log('=== Legacy article placement (2636 preview-card flow) ===');
    await page.goto(BASE + '/site/article.html?id=2636&source=archive', { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1500));
    const legacy = await page.evaluate(() => {
      const body = document.querySelector('.article-body');
      const cards = Array.from(body.querySelectorAll('figure.article-inline-media'));
      // Each card's previous sibling should be a <p> (or <li>) that contains
      // a link pointing at the same image — i.e. the author-placed reference.
      return cards.map((c) => {
        const src = c.getAttribute('data-media-src');
        const prev = c.previousElementSibling;
        const prevHasMatchingLink = prev && !!prev.querySelector(`a[href="${src}"]`);
        const prevIsPrior = !!prev && (prev.tagName === 'P' || prev.tagName === 'LI');
        // Or the card directly follows another media card sharing the same host paragraph
        const prevIsSiblingCard = prev && prev.classList.contains('article-inline-media');
        return {
          label: ((c.querySelector('span.article-inline-media-kind') || {}).textContent || '').trim(),
          adjacent: prevIsSiblingCard || (prevIsPrior && prevHasMatchingLink),
        };
      });
    });
    // Every card must be adjacent to either its host paragraph or a sibling
    // card that shares the host paragraph (the "Figures 1, 2 illustrate…" case).
    const allAdjacent = legacy.length > 0 && legacy.every((c) => c.adjacent);
    if (allAdjacent) pass(`legacy 2636: all ${legacy.length} cards adjacent to their reference paragraphs`);
    else fail('legacy 2636: some cards not under their host paragraph', JSON.stringify(legacy));

    // Numerical order — Tables 1-5 then Figures 1-2 in author-mention order.
    const labels = legacy.map((c) => c.label);
    if (labels.join('|') === 'Table 1|Table 2|Table 3|Table 4|Table 5|Figure 1|Figure 2') {
      pass(`legacy 2636: cards in expected order [${labels.join(', ')}]`);
    } else {
      fail('legacy 2636: card order unexpected', labels.join('|'));
    }

  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
