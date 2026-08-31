// E2E test — article 2811 should render with:
//   • figure/table refs styled as links (.article-media-ref-link)
//   • <sup>N</sup> citations wrapped in <a class="article-ref-citation">
//   • Figure 1 placed right after the paragraph that first mentions it (P4)
//   • Table 1 placed right after the paragraph that first mentions it (P3)
//
// Requires the admin server up; it serves the public site at /site/.

const puppeteer = require('puppeteer');

const BASE = process.env.BASE_URL || 'http://localhost:3098';

function pass(name) { console.log('  PASS:', name); }
function fail(name, detail) { console.log('  FAIL:', name, detail ? '— ' + detail : ''); process.exitCode = 1; }

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  try {
    await page.goto(BASE + '/site/article.html?id=2811', { waitUntil: 'networkidle2', timeout: 20000 });
    // Wait for full-text injection + enhancers to run.
    await page.waitForSelector('.article-body figure[id="figure-1"]', { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 500));

    // ── T1: Figure/table cross-reference links carry the highlight class ─
    console.log('=== T1: Figure/table reference styling ===');
    const linkClasses = await page.evaluate(() => {
      const fig1 = document.querySelector('.article-body a[href="#figure-1"]');
      const tab1 = document.querySelector('.article-body a[href="#table-1"]');
      return {
        fig1ClassList: fig1 ? Array.from(fig1.classList) : null,
        tab1ClassList: tab1 ? Array.from(tab1.classList) : null,
        fig1Color: fig1 ? window.getComputedStyle(fig1).color : null,
        tab1Color: tab1 ? window.getComputedStyle(tab1).color : null,
      };
    });
    if (linkClasses.fig1ClassList && linkClasses.fig1ClassList.includes('article-media-ref-link')) {
      pass('Figure 1 reference link has .article-media-ref-link class');
    } else fail('Figure 1 link missing class', JSON.stringify(linkClasses.fig1ClassList));
    if (linkClasses.tab1ClassList && linkClasses.tab1ClassList.includes('article-media-ref-link')) {
      pass('Table 1 reference link has .article-media-ref-link class');
    } else fail('Table 1 link missing class', JSON.stringify(linkClasses.tab1ClassList));
    // Color should be the teal brand color — not the default (#1f2937 dark gray).
    if (linkClasses.fig1Color && linkClasses.fig1Color !== 'rgb(31, 41, 55)') {
      pass(`Figure 1 link is visually distinct from body text (color=${linkClasses.fig1Color})`);
    } else fail('Figure 1 link blends into body text', linkClasses.fig1Color);

    // ── T2: <sup> citations are wrapped in <a class="article-ref-citation"> ──
    console.log('=== T2: Citation linking ===');
    const supLinkInfo = await page.evaluate(() => {
      const sups = Array.from(document.querySelectorAll('.article-body sup'));
      let inner = 0, withAnchor = 0;
      for (const s of sups) {
        if (s.closest('.article-references, .article-footnotes')) continue;
        if (!/^[\s\d,\-–— ]+$/.test((s.textContent || '').trim())) continue;
        if (!/\d/.test(s.textContent || '')) continue;
        // Skip outer wrappers that only contain other sups.
        if (s.querySelector('sup')) continue;
        inner++;
        if (s.querySelector('a.article-ref-citation')) withAnchor++;
      }
      return { inner, withAnchor };
    });
    if (supLinkInfo.inner > 0 && supLinkInfo.withAnchor === supLinkInfo.inner) {
      pass(`all ${supLinkInfo.inner} citation <sup> tags wrapped in <a.article-ref-citation>`);
    } else fail('citation linking incomplete', JSON.stringify(supLinkInfo));

    // The reference list <li> elements must have id="ref-N" so the anchors work.
    const refIdCount = await page.evaluate(() =>
      document.querySelectorAll('.article-body .article-references ol > li[id^="ref-"]').length
    );
    if (refIdCount >= 13) pass(`reference list <li> have id="ref-N" (${refIdCount} items)`);
    else fail('reference list missing IDs', `count=${refIdCount}`);

    // ── T3: Figure/table relocation ─────────────────────────────────────────
    console.log('=== T3: Figures and tables follow their first-referencing paragraph ===');
    const layout = await page.evaluate(() => {
      const body = document.querySelector('.article-body');
      if (!body) return null;
      // Find the paragraph that contains the first reference to Figure 1.
      const fig1Anchor = body.querySelector('a[href="#figure-1"]');
      const tab1Anchor = body.querySelector('a[href="#table-1"]');
      const fig1Host = fig1Anchor ? fig1Anchor.closest('p') : null;
      const tab1Host = tab1Anchor ? tab1Anchor.closest('p') : null;
      const fig1 = body.querySelector('figure[id="figure-1"]');
      const tab1 = body.querySelector('[id="table-1"]');
      return {
        fig1FollowsHost: !!(fig1Host && fig1Host.nextElementSibling === fig1),
        tab1FollowsHost: !!(tab1Host && tab1Host.nextElementSibling === tab1),
        // For diagnostics: which sibling actually follows the host paragraph?
        actualFig1Sibling: fig1Host && fig1Host.nextElementSibling
          ? (fig1Host.nextElementSibling.id || fig1Host.nextElementSibling.tagName) : null,
        actualTab1Sibling: tab1Host && tab1Host.nextElementSibling
          ? (tab1Host.nextElementSibling.id || tab1Host.nextElementSibling.tagName) : null,
      };
    });
    if (layout.tab1FollowsHost) pass('Table 1 sits directly after the paragraph that references it');
    else fail('Table 1 not adjacent to its host paragraph', `next sibling=${layout.actualTab1Sibling}`);
    if (layout.fig1FollowsHost) pass('Figure 1 sits directly after the paragraph that references it');
    else fail('Figure 1 not adjacent to its host paragraph', `next sibling=${layout.actualFig1Sibling}`);

    // ── T5: Figure caption normalization ────────────────────────────────────
    console.log('=== T5: Figure caption shows "FIG. N." and drops redundant top label ===');
    const captions = await page.evaluate(() => {
      const fig = document.querySelector('.article-body figure[id="figure-1"]');
      if (!fig) return null;
      // Collect direct figcaption children that just say "Figure 1"
      const topLabels = Array.from(fig.children)
        .filter((c) => c.tagName === 'FIGCAPTION')
        .map((c) => (c.textContent || '').trim());
      // First non-empty <p> child = the descriptive caption.
      const captionP = Array.from(fig.children).find((c) => c.tagName === 'P' && (c.textContent || '').trim());
      const captionText = captionP ? (captionP.textContent || '').trim() : null;
      const firstChildTag = captionP && captionP.firstElementChild ? captionP.firstElementChild.tagName : null;
      const firstChildText = captionP && captionP.firstElementChild ? (captionP.firstElementChild.textContent || '').trim() : null;
      return { topLabels, captionText, firstChildTag, firstChildText };
    });
    if (captions.topLabels.length === 0) pass('redundant "Figure 1" top label removed');
    else fail('top label still present', JSON.stringify(captions.topLabels));
    if (captions.firstChildTag === 'STRONG' && /^FIG\.\s*1\.?$/i.test((captions.firstChildText || '').trim())) {
      pass('caption is prefixed with bold "FIG. 1."');
    } else fail('caption prefix missing or wrong', `firstChild=${captions.firstChildTag} text="${captions.firstChildText}"`);
    if (captions.captionText && /^FIG\.\s*1\.\s+Kaplan/.test(captions.captionText)) {
      pass(`caption now reads "${captions.captionText.slice(0, 50)}…"`);
    } else fail('caption text not in expected form', captions.captionText);

    // ── T6: Multiple figures sharing one host paragraph stay in numerical order ──
    // (Regression test for article 2849: paragraph 19 references "Figures 2, 3, 4"
    // in one shot. Earlier code placed them in reverse — fig 4, fig 3, fig 2.)
    console.log('=== T6: Multi-figure paragraph keeps numerical order (article 2849) ===');
    await page.goto(BASE + '/site/article.html?id=2849', { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForSelector('.article-body figure[id="figure-1"]', { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 500));

    const figOrder = await page.evaluate(() => {
      const body = document.querySelector('.article-body');
      return Array.from(body.querySelectorAll('figure[id^="figure-"]')).map((f) => f.id);
    });
    const expected = ['figure-1', 'figure-2', 'figure-3', 'figure-4', 'figure-5'];
    if (figOrder.join(',') === expected.join(',')) {
      pass(`figures appear in numerical order: ${figOrder.join(', ')}`);
    } else {
      fail('figures out of order', `expected=${expected.join(',')} got=${figOrder.join(',')}`);
    }

    // Verify fig 2/3/4 are consecutive siblings (i.e. all placed after the same host paragraph).
    const grouping = await page.evaluate(() => {
      const f2 = document.querySelector('.article-body figure[id="figure-2"]');
      const f3 = document.querySelector('.article-body figure[id="figure-3"]');
      const f4 = document.querySelector('.article-body figure[id="figure-4"]');
      return {
        f2NextIsF3: f2 && f2.nextElementSibling === f3,
        f3NextIsF4: f3 && f3.nextElementSibling === f4,
      };
    });
    if (grouping.f2NextIsF3 && grouping.f3NextIsF4) {
      pass('figures 2-3-4 are consecutive siblings (placed together after shared host paragraph)');
    } else {
      fail('figures 2-3-4 not contiguous', JSON.stringify(grouping));
    }

    // ── T4: Reference list and footnotes still at the bottom ────────────────
    console.log('=== T4: Trailing sections untouched ===');
    const trailing = await page.evaluate(() => {
      const body = document.querySelector('.article-body');
      const children = body ? Array.from(body.children) : [];
      const refIdx = children.findIndex((c) => c.classList && c.classList.contains('article-references'));
      const ackIdx = children.findIndex((c) => c.classList && c.classList.contains('article-acknowledgments'));
      const footIdx = children.findIndex((c) => c.classList && c.classList.contains('article-footnotes'));
      return { total: children.length, refIdx, ackIdx, footIdx };
    });
    // References should still come after acknowledgments and footnotes — i.e.,
    // we shouldn't have shuffled the trailing sections.
    if (trailing.refIdx > trailing.ackIdx && trailing.refIdx > trailing.footIdx) {
      pass(`references remain after ack/footnotes (ref@${trailing.refIdx} > ack@${trailing.ackIdx}, foot@${trailing.footIdx})`);
    } else fail('trailing sections shuffled', JSON.stringify(trailing));

  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
