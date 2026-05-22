// End-to-end manual e-Pub (AIP) creation for the Kounis Syndrome article.
// 1. Wipe the half-baked existing #2867 (DB record + leftover files on disk)
// 2. Create a fresh AIP via POST /api/articles-in-press with full DOCX metadata
// 3. Upload PDF via /api/media/upload/pdf
// 4. Upload 2 figures via /api/media/upload/figures/:id
// 5. Patch the AIP with pdfUrl / localPdfUrl so the public preview resolves
// 6. Synthesise a minimal full-text HTML so the figures have a place to render
// 7. Verify preview surfaces (admin record, article.html?source=aip, AIP list)

const fs = require('fs');
const path = require('path');
const dio = require('./lib/data-io');
const { cleanArticleAssets } = require('./lib/zip-importer');

const BASE = process.env.BASE_URL || 'http://localhost:3098';
const SRC = String.raw`C:\Users\Selçuk\Downloads\Desktop`;
const OLD_ID = 2867;

const meta = {
  type: 'Invited Review',
  title: 'Contrast Media Side Effects and Kounis Syndrome: Timeo Danaos et Dona Ferentes',
  doi: '10.4274/balkanmedj.galenos.2026.2026-3-89',
  pages: '297-308',
  received: '2026-04-01',
  accepted: '2026-05-05',
  published: '2026-06-01',
  volume: 43,
  issue: '4',
  hasFullText: true,
  keywords: [],
  authors: [
    { name: 'Nicholas G. Kounis',   affiliation: 'Department of Cardiology, University of Patras Faculty of Medicine, Patras, Greece', orcid: '0000-0002-9751-6710', corresponding: true, email: 'ngkounis@otenet.gr' },
    { name: 'Ming-Yow Hung',        affiliation: 'Division of Cardiology, Department of Internal Medicine, Taipei Medical University, Shuang Ho Hospital, New Taipei City, Taiwan', orcid: '0000-0002-6912-7523' },
    { name: 'Alexandr Ceasovschih', affiliation: 'Department of Internal Medicine, Grigore T. Popa University of Medicine and Pharmacy, Iaşi, Romania', orcid: '0000-0002-0043-9051' },
    { name: 'Cesare de Gregorio',   affiliation: 'Department of Clinical and Experimental Medicine, University of Messina, Messina, Italy', orcid: '0000-0003-3022-266X' },
    { name: 'Anastasia Mavromati',  affiliation: 'Department of Cardiology, University of Patras Faculty of Medicine, Patras, Greece', orcid: '0009-0009-0391-5218' },
    { name: 'Marta Bernaola',       affiliation: 'Clinic of Allergy Hospital, Central de la Defensa "Gómez Ulla", Madrid, Spain', orcid: '0000-0003-4199-573X' },
    { name: 'Ioanna Koniari',       affiliation: 'Department of Electrophysiology and Device, University of Patras, Patras, Greece', orcid: '0000-0002-1033-5299' },
  ],
  abstract: [
    'Kounis syndrome is defined as the occurrence of acute coronary events in the setting of allergic, hypersensitivity, or anaphylactic reactions. It is mediated by mast cell activation and the interaction of inflammatory cells, including T lymphocytes and macrophages. This process leads to the release of multiple inflammatory mediators, such as platelet-activating factor, histamine, neutral proteases (tryptase and chymase), arachidonic acid metabolites, cytokines, and chemokines. Kounis syndrome represents a unique form of acute vascular disorder that may involve not only the coronary arteries but also peripheral, cerebral, and mesenteric vessels as well as the venous system. Contrast media are widely used in diagnostic imaging to enhance visualization and characterization of pathological conditions. These agents can be administered via several routes, including oral, intravenous, intra-arterial, or rectal administration. Although most hypersensitivity reactions to contrast media are mild to moderate, severe complications such as anaphylaxis, cardiac arrest, and Kounis syndrome may occur. In particular, contrast media-induced Kounis syndrome has been associated with significant clinical consequences, including an increased risk of life-threatening cardiac events.',
    'This narrative review aims to summarize current evidence regarding contrast media-related adverse effects, with a focus on hypersensitivity reactions, Kounis syndrome, and associated cardiovascular complications. Emphasis is also placed on preventive strategies, including the importance of obtaining a detailed patient history of prior hypersensitivity reactions prior to contrast administration, to reduce the risk of recurrence and severe outcomes.',
  ],
};

function abstractHtml() {
  return meta.abstract.map((p) => `<p>${p}</p>`).join('\n');
}

function buildFullTextHtml(id) {
  // Minimal stand-in body so the AIP page has something to render under
  // the abstract and the uploaded figures have a place to anchor. When the
  // article is officially published with full content, this will be replaced
  // by the proper JATS-rendered body.
  return [
    '<div class="article-section">',
    '  <h3>Abstract</h3>',
    '  ' + abstractHtml(),
    '</div>',
    '',
    `<figure id="figure-1" class="article-figure">`,
    `  <img src="images/articles/${id}/figure-1.png" alt="Figure 1" loading="lazy">`,
    '  <p>Figure 1 from the published manuscript.</p>',
    '</figure>',
    '',
    `<figure id="figure-2" class="article-figure">`,
    `  <img src="images/articles/${id}/figure-2.png" alt="Figure 2" loading="lazy">`,
    '  <p>Figure 2 from the published manuscript.</p>',
    '</figure>',
    '',
    '<div class="article-footnotes">',
    '  <p><strong>Note:</strong> Full text and references will appear here once the article is published. Until then, the complete PDF is available via the Download button above.</p>',
    '</div>',
  ].join('\n');
}

async function api(method, p, body, isMultipart) {
  const url = BASE + p;
  const opts = { method };
  if (isMultipart) { opts.body = body; }
  else if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status}: ${data.error || data.raw || text.slice(0, 120)}`);
  return data;
}

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

async function uploadFile(p, fieldName, filePath, extraFields = {}) {
  const fd = new FormData();
  const buf = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  const mime = MIME_BY_EXT[path.extname(name).toLowerCase()] || 'application/octet-stream';
  // Multer's file filter checks both extension AND MIME — must pass a typed
  // Blob, otherwise it defaults to application/octet-stream and gets rejected.
  const blob = new Blob([buf], { type: mime });
  fd.append(fieldName, blob, name);
  for (const [k, v] of Object.entries(extraFields)) fd.append(k, String(v));
  return api('POST', p, fd, true);
}

(async () => {
  // ── STEP 1: Wipe old #2867 ────────────────────────────────────────────
  console.log('=== STEP 1: Clean up old #2867 ===');
  // Disk cleanup uses the helper we just added.
  const cleanup = cleanArticleAssets(OLD_ID);
  console.log(`  Removed ${cleanup.figures.length} figure(s), ${cleanup.supplementary.length} supp file(s) from disk`);
  for (const p of [
    path.join(dio.PATHS.pdfsDir, `${OLD_ID}.pdf`),
    path.join(dio.PATHS.articlesDir, `${OLD_ID}.html`),
    path.join(dio.PATHS.articlesDir, `${OLD_ID}.js`),
  ]) {
    if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('  Removed file:', p); }
  }
  try {
    await api('DELETE', `/api/articles-in-press/${OLD_ID}`);
    console.log(`  Deleted AIP record #${OLD_ID} from articles-in-press.js`);
  } catch (e) {
    console.log(`  AIP #${OLD_ID} not found in record (already deleted?)`);
  }

  // ── STEP 2: Create the AIP record ─────────────────────────────────────
  console.log('\n=== STEP 2: Create fresh AIP record ===');
  const aipBody = {
    type: meta.type,
    title: meta.title,
    doi: meta.doi,
    pages: meta.pages,
    received: meta.received,
    accepted: meta.accepted,
    published: meta.published,
    volume: meta.volume,
    issue: meta.issue,
    authors: meta.authors,
    abstract: meta.abstract.join('\n\n'),
    abstractHtml: abstractHtml(),
    keywords: meta.keywords,
    hasFullText: false, // flip to true after we write the full-text file
    aheadOfPrint: true,
    figures: [
      { id: 'figure-1', label: 'Figure 1', url: '' /* filled after upload */ },
      { id: 'figure-2', label: 'Figure 2', url: '' },
    ],
    supplementary: [],
  };
  const created = await api('POST', '/api/articles-in-press', aipBody);
  const id = created.id;
  console.log(`  Created AIP #${id}: ${created.title}`);

  // ── STEP 3: Upload PDF ────────────────────────────────────────────────
  console.log('\n=== STEP 3: Upload PDF ===');
  const pdfResult = await uploadFile('/api/media/upload/pdf', 'pdf',
    path.join(SRC, '297-308.pdf'), { articleId: String(id) });
  console.log(`  PDF saved at ${pdfResult.pdfUrl}`);

  // ── STEP 4: Upload figures ────────────────────────────────────────────
  console.log('\n=== STEP 4: Upload figures ===');
  // We rename the local files to figure-1.png / figure-2.png so the full-text
  // body's <img src="images/articles/<id>/figure-1.png"> resolves cleanly.
  // The upload endpoint preserves the original filename; we'll rename on the
  // wire by writing the blobs with the desired name.
  const figDir = path.join(dio.PATHS.articleImagesDir, String(id));
  fs.mkdirSync(figDir, { recursive: true });
  fs.copyFileSync(path.join(SRC, '297-308-f1.png'), path.join(figDir, 'figure-1.png'));
  fs.copyFileSync(path.join(SRC, '297-308-f2.png'), path.join(figDir, 'figure-2.png'));
  console.log(`  Figure 1 saved at images/articles/${id}/figure-1.png`);
  console.log(`  Figure 2 saved at images/articles/${id}/figure-2.png`);

  // ── STEP 5: Patch AIP with pdfUrl + figures and flip hasFullText ──────
  console.log('\n=== STEP 5: Patch AIP record with media URLs ===');
  const patch = {
    pdfUrl: pdfResult.pdfUrl,
    localPdfUrl: pdfResult.pdfUrl,
    hasFullText: true,
    figures: [
      { id: 'figure-1', label: 'Figure 1', url: `images/articles/${id}/figure-1.png` },
      { id: 'figure-2', label: 'Figure 2', url: `images/articles/${id}/figure-2.png` },
    ],
  };
  const patched = await api('PUT', `/api/articles-in-press/${id}`, patch);
  console.log(`  Updated #${id} — pdfUrl=${patched.pdfUrl}, figures=${patched.figures.length}`);

  // ── STEP 6: Write the full-text HTML ─────────────────────────────────
  console.log('\n=== STEP 6: Write full-text HTML ===');
  await api('PUT', `/api/articles/${id}/fulltext`, { html: buildFullTextHtml(id) });
  console.log(`  Full text written to js/data/articles/${id}.html`);

  // ── STEP 7: Verify ALL preview surfaces ──────────────────────────────
  console.log('\n=== STEP 7: Verify preview surfaces ===');
  let okCount = 0, failCount = 0;
  function v(label, ok, detail) {
    if (ok) { okCount++; console.log('  ✓', label); }
    else { failCount++; console.log('  ✗', label, detail ? '—' + detail : ''); }
  }

  // 7a) Server: AIP record contains everything
  const fetched = await api('GET', `/api/articles-in-press/${id}`);
  v(`server: GET returns AIP #${id}`, fetched.id === id);
  v(`server: pdfUrl present`, fetched.pdfUrl === pdfResult.pdfUrl, fetched.pdfUrl);
  v(`server: localPdfUrl present`, fetched.localPdfUrl === pdfResult.pdfUrl);
  v(`server: 7 authors persisted`, (fetched.authors || []).length === 7);
  v(`server: hasFullText=true`, fetched.hasFullText === true);
  v(`server: figures has 2 entries`, (fetched.figures || []).length === 2);

  // 7b) Disk: files exist where expected
  v(`disk: PDF file exists`, fs.existsSync(path.join(dio.PATHS.pdfsDir, `${id}.pdf`)));
  v(`disk: figure-1.png exists`, fs.existsSync(path.join(figDir, 'figure-1.png')));
  v(`disk: figure-2.png exists`, fs.existsSync(path.join(figDir, 'figure-2.png')));
  v(`disk: full-text HTML exists`, fs.existsSync(path.join(dio.PATHS.articlesDir, `${id}.html`)));

  // 7c) Public site preview via puppeteer
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

    // 7c-i) article.html?id=<id>&source=aip — main public preview
    await page.goto(`${BASE}/site/article.html?id=${id}&source=aip`, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    const pubPreview = await page.evaluate(() => ({
      title: document.title,
      heading: (document.querySelector('h1') || {}).textContent,
      pdfLinks: Array.from(document.querySelectorAll('a[href$=".pdf"]')).map((a) => a.getAttribute('href')),
      figureCount: document.querySelectorAll('figure[id^="figure-"]').length,
      figureSrcs: Array.from(document.querySelectorAll('figure[id^="figure-"] img')).map((i) => i.getAttribute('src')),
      authorsShown: document.body.textContent.includes('Kounis') && document.body.textContent.includes('Koniari'),
    }));
    v(`public: page title contains article title`, /Contrast Media Side Effects/.test(pubPreview.title), pubPreview.title);
    v(`public: H1 heading matches`, /Contrast Media Side Effects/.test(pubPreview.heading || ''));
    v(`public: PDF download link present`, pubPreview.pdfLinks.length > 0, JSON.stringify(pubPreview.pdfLinks.slice(0, 2)));
    v(`public: PDF link points at our file`, pubPreview.pdfLinks.some((l) => l.includes(`${id}.pdf`)), pubPreview.pdfLinks[0]);
    v(`public: both figures rendered`, pubPreview.figureCount === 2, `count=${pubPreview.figureCount}`);
    v(`public: figure 1 src points at uploaded image`, (pubPreview.figureSrcs[0] || '').includes(`/${id}/figure-1.png`), pubPreview.figureSrcs[0]);
    v(`public: first + last author both shown`, pubPreview.authorsShown);

    // 7c-ii) articles-in-press.html — the AIP list page
    await page.goto(`${BASE}/site/articles-in-press.html`, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800));
    const listShown = await page.evaluate((targetId) => {
      const links = Array.from(document.querySelectorAll(`a[href*="id=${targetId}"]`));
      return {
        linkCount: links.length,
        sampleHref: links[0] ? links[0].getAttribute('href') : null,
        titleInPage: document.body.textContent.includes('Contrast Media Side Effects and Kounis Syndrome'),
      };
    }, id);
    v(`AIP list: article title appears`, listShown.titleInPage);
    v(`AIP list: link to article.html?id=${id} present`, listShown.linkCount > 0, `count=${listShown.linkCount}`);

    // 7c-iii) Admin: AIP edit page renders
    await page.goto(`${BASE}/#/articles-in-press/${id}/edit`, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2000));
    const adminEdit = await page.evaluate(() => ({
      hasTitleInput: !!document.querySelector('input[name="title"], #aipf-title, #title'),
      bodyMentionsContrast: document.body.textContent.includes('Contrast Media'),
    }));
    v(`admin: AIP edit page renders with title context`, adminEdit.bodyMentionsContrast);

  } finally {
    await browser.close();
  }

  console.log(`\n${okCount} passed, ${failCount} failed`);
  if (failCount === 0) {
    console.log(`\n✓ AIP #${id} fully wired up — ready for preview.`);
    console.log(`  Public:  ${BASE}/site/article.html?id=${id}&source=aip`);
    console.log(`  Admin:   ${BASE}/#/articles-in-press/${id}/edit`);
    console.log(`  AIP list: ${BASE}/site/articles-in-press.html`);
  }
  process.exit(failCount ? 1 : 0);
})().catch((e) => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
