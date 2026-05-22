/**
 * ZIP Importer — Extract a ZIP containing JATS XML + PDF + images,
 * parse articles, match media files by name, and import everything.
 */

const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const { parseJatsXml } = require('./jats-parser');
const dio = require('./data-io');

const IMPORTS_DIR = path.join(__dirname, '..', 'imports');
const PROCESSED_DIR = path.join(IMPORTS_DIR, 'processed');

// Ensure directories exist
for (const dir of [IMPORTS_DIR, PROCESSED_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.tif', '.tiff', '.svg', '.webp']);
const PDF_EXT = '.pdf';

// Canonical DOI comparison key. JATS exports occasionally tack a stray
// newline, leading whitespace or trailing slash onto the DOI; comparing
// with raw .toLowerCase() then silently misses duplicates. Centralising
// the normalisation also fixes the asymmetry between the ZIP importer
// and the JATS import endpoints — both should agree on what "same DOI"
// means.
function normalizeDoi(value) {
  if (value == null) return '';
  return String(value).trim().replace(/\/+$/, '').toLowerCase();
}

// Cap the total uncompressed size of a ZIP we're willing to extract. multer
// limits the compressed upload (currently 100 MB) but adm-zip will happily
// decompress something well above that — a malformed ZIP can claim a tiny
// compressed payload that expands to gigabytes of disk usage ("zip bomb").
// 2 GB is comfortably above any realistic legitimate issue (text + images +
// PDFs) but small enough to keep an attacker from filling the disk.
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
// Per-entry sanity cap so a single 1.9 GB file inside an otherwise normal ZIP
// still gets rejected (uncommon but cheap to defend against).
const MAX_ENTRY_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

/**
 * Normalize a figure/file basename so that fig1, figure1, Fig_1, Figure 1, fig01
 * all collapse to the same key 'fig1'. Used for fuzzy matching of figure refs
 * to image files inside a ZIP.
 *   "Figure 1"        → "figure1"
 *   "fig_01"          → "figure1"   (the optional leading 0s after "fig"/"figure")
 *   "f1"              → "figure1"
 *   "scheme2"         → "scheme2"
 *   "table_1"         → "table1"
 *   "graphical-abstract" → "graphicalabstract"
 */
function normalizeFigureKey(name) {
  if (!name) return '';
  let s = String(name).toLowerCase();
  s = s.replace(/\.[a-z0-9]+$/, '');           // drop extension
  s = s.replace(/[\s_.\-]+/g, '');              // strip separators
  // Map common figure-word prefixes to 'fig' so 'figure1' ~ 'fig1' ~ 'f1'.
  s = s.replace(/^figure(?=\d)/, 'fig');
  s = s.replace(/^fig(?=\d)/, 'fig');
  s = s.replace(/^f(?=\d)/, 'fig');
  // Strip leading zeros after the prefix (fig01 → fig1)
  s = s.replace(/^(fig|table|scheme|equation|chart|plate)0+(\d+)/, '$1$2');
  // Bare 01-style filenames (just digits like '01.jpg') get a 'fig' prefix.
  if (/^\d+$/.test(s)) s = 'fig' + s.replace(/^0+/, '');
  return s;
}

/**
 * Build a map: normalized-key → ZIP image file entry.
 * Used by both preview and import paths.
 */
function buildImageIndex(imageFiles) {
  const idx = new Map();
  for (const img of imageFiles) {
    const key = normalizeFigureKey(img.name);
    if (key && !idx.has(key)) idx.set(key, img);
  }
  return idx;
}

/**
 * Match a figure reference (from JATS) to an image file in the ZIP.
 * Tries: exact basename → exact lowercase → normalized key.
 */
function findImageMatch(figRef, imageFiles, imageIndex) {
  if (!figRef) return null;
  const figBase = path.parse(figRef).name;
  // 1. Exact basename
  let m = imageFiles.find((img) => path.parse(img.name).name === figBase);
  if (m) return m;
  // 2. Case-insensitive
  const figLower = figBase.toLowerCase();
  m = imageFiles.find((img) => path.parse(img.name).name.toLowerCase() === figLower);
  if (m) return m;
  // 3. Normalized fuzzy
  const key = normalizeFigureKey(figRef);
  if (key && imageIndex.has(key)) return imageIndex.get(key);
  return null;
}

/**
 * List existing on-disk assets for an article ID. Used by previewZip to
 * warn the user "you're about to re-import #N; these files will be wiped".
 * Returns empty arrays when the article has no prior files.
 */
function listExistingArticleAssets(id) {
  const result = { figures: [], supplementary: [], fullText: false };
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return result;
  const figDir = path.join(dio.PATHS.articleImagesDir, String(numericId));
  if (fs.existsSync(figDir)) {
    try {
      for (const f of fs.readdirSync(figDir)) {
        if (fs.statSync(path.join(figDir, f)).isFile()) result.figures.push(f);
      }
    } catch (_) { /* unreadable dir — skip */ }
  }
  const suppDir = path.join(dio.PATHS.supplementaryDir, String(numericId));
  if (fs.existsSync(suppDir)) {
    try {
      for (const f of fs.readdirSync(suppDir)) {
        if (fs.statSync(path.join(suppDir, f)).isFile()) result.supplementary.push(f);
      }
    } catch (_) {}
  }
  const ftHtml = path.join(dio.PATHS.articlesDir, String(numericId) + '.html');
  result.fullText = fs.existsSync(ftHtml);
  return result;
}

/**
 * Wipe all per-article media files for the given ID so a fresh import
 * doesn't inherit leftover figures/supplementaries from an earlier import
 * or test. The DIRECTORIES are preserved (importZip recreates them
 * via mkdirSync anyway) but every file inside is removed.
 *
 * Intentionally NOT touched:
 *   - js/data/pdfs/<id>.pdf      — overwritten in place by importZip
 *   - js/data/articles/<id>.html — overwritten in place by writeFullText
 *   - js/data/articles/<id>.js   — same
 *   - img/files/*                — global library, not keyed by article id
 *
 * Returns the list of file names actually removed (for the audit trail
 * exposed in the importZip response).
 */
function cleanArticleAssets(id, opts = {}) {
  // opts.wipePdf      → also delete js/data/pdfs/<id>.pdf
  // opts.wipeFullText → also delete js/data/articles/<id>.html and <id>.js
  // ZIP import uses defaults (figures + supp only) since it overwrites PDF
  // and full text by hand. Manual AIP create and DELETE use wipeAll to
  // prevent orphaned files from being inherited by the next ID reassignment.
  const removed = { figures: [], supplementary: [], pdf: false, fullText: false };
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return removed;
  const figDir = path.join(dio.PATHS.articleImagesDir, String(numericId));
  if (fs.existsSync(figDir)) {
    try {
      for (const f of fs.readdirSync(figDir)) {
        const p = path.join(figDir, f);
        try {
          if (fs.statSync(p).isFile()) {
            fs.unlinkSync(p);
            removed.figures.push(f);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  const suppDir = path.join(dio.PATHS.supplementaryDir, String(numericId));
  if (fs.existsSync(suppDir)) {
    try {
      for (const f of fs.readdirSync(suppDir)) {
        const p = path.join(suppDir, f);
        try {
          if (fs.statSync(p).isFile()) {
            fs.unlinkSync(p);
            removed.supplementary.push(f);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  if (opts.wipePdf) {
    const pdfPath = path.join(dio.PATHS.pdfsDir, String(numericId) + '.pdf');
    if (fs.existsSync(pdfPath)) {
      try { fs.unlinkSync(pdfPath); removed.pdf = true; } catch (_) {}
    }
  }
  if (opts.wipeFullText) {
    for (const ext of ['.html', '.js']) {
      const ftPath = path.join(dio.PATHS.articlesDir, String(numericId) + ext);
      if (fs.existsSync(ftPath)) {
        try { fs.unlinkSync(ftPath); removed.fullText = true; } catch (_) {}
      }
    }
  }
  return removed;
}

/**
 * Scan the imports directory for unprocessed ZIP files.
 */
function scanImportsDir() {
  if (!fs.existsSync(IMPORTS_DIR)) return [];
  return fs.readdirSync(IMPORTS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .map((f) => {
      const stat = fs.statSync(path.join(IMPORTS_DIR, f));
      return {
        filename: f,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        sizeHuman: formatBytes(stat.size),
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/**
 * Analyze a ZIP file: list contents grouped by type.
 */
function analyzeZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  const xmlFiles = [];
  const pdfFiles = [];
  const imageFiles = [];
  const otherFiles = [];
  let totalUncompressed = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    // __MACOSX traversal: filter both by the basename ("._foo.jpg") and the
    // full entry path ("__MACOSX/foo/.bar") so resource forks never sneak
    // through the basename check.
    if (entry.entryName.includes('__MACOSX/')) continue;
    const name = path.basename(entry.entryName);
    if (name.startsWith('.') || name.startsWith('__MACOSX')) continue;

    const entrySize = entry.header.size || 0;
    if (entrySize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      const err = new Error(
        'ZIP bomb koruması: tek dosya bekleneninden büyük (' +
        Math.round(entrySize / (1024 * 1024)) + ' MB): ' + name
      );
      err.code = 'ZIP_BOMB';
      throw err;
    }
    totalUncompressed += entrySize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      const err = new Error(
        'ZIP bomb koruması: toplam içerik 2 GB sınırını aşıyor. ' +
        'Lütfen ZIP\'i parçalara bölün veya gereksiz dosyaları çıkarın.'
      );
      err.code = 'ZIP_BOMB';
      throw err;
    }

    const ext = path.extname(name).toLowerCase();
    const info = { name, entryName: entry.entryName, size: entrySize };

    if (ext === '.xml') xmlFiles.push(info);
    else if (ext === PDF_EXT) pdfFiles.push(info);
    else if (IMAGE_EXTS.has(ext)) imageFiles.push(info);
    else otherFiles.push(info);
  }

  return { xmlFiles, pdfFiles, imageFiles, otherFiles, totalEntries: entries.length, totalUncompressed };
}

/**
 * Preview: parse all XMLs in the ZIP without importing.
 * Returns rich per-figure detail so the UI can show a clear match report.
 */
async function previewZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const analysis = analyzeZip(zipPath);
  const imageIndex = buildImageIndex(analysis.imageFiles);
  const articles = [];
  const errors = [];

  // Track every image file we end up consuming — leftover = orphan.
  const consumedImages = new Set();

  // Load existing published + AIP records once, so each XML's DOI can be
  // classified in the preview as "new" / "duplicate (already published)" /
  // "promote (in press → published)". Previously the importer only looked at
  // published articles, so AIP entries silently turned into duplicates.
  const publishedArticles = dio.readArticles();
  const aipArticles = dio.readArticlesInPress();
  const aipByDoi = new Map();
  for (const a of aipArticles) {
    if (a.doi) aipByDoi.set(normalizeDoi(a.doi), a);
  }
  const publishedByDoi = new Map();
  for (const a of publishedArticles) {
    if (a.doi) publishedByDoi.set(normalizeDoi(a.doi), a);
  }
  // Track DOIs we've already seen IN THIS ZIP, so we can flag duplicates
  // *inside* the same archive — two XMLs that share a DOI would otherwise
  // both be marked "new" in the preview and the importer would import the
  // first while the second got a confusing "duplicate" error after submit.
  const doisInZip = new Map();

  for (const xmlInfo of analysis.xmlFiles) {
    try {
      const xmlContent = zip.readAsText(xmlInfo.entryName);
      const parsed = await parseJatsXml(xmlContent);
      const baseName = path.parse(xmlInfo.name).name;

      const matchedPdf = analysis.pdfFiles.find((p) =>
        path.parse(p.name).name === baseName
      );

      // Per-figure detail: every figure from JATS, with its match status.
      const figures = (parsed.figures || []).map((fig) => {
        const match = findImageMatch(fig.imageFile, analysis.imageFiles, imageIndex);
        if (match) consumedImages.add(match.entryName);
        return {
          id: fig.id || '',
          label: fig.label || '',
          originalRef: fig.imageFile || '',
          matchedFile: match ? match.name : null,
          status: match ? 'matched' : (fig.imageFile ? 'missing' : 'no-ref'),
        };
      });

      // Legacy shape for backwards compatibility (some UI still reads these).
      const matchedImages = figures
        .filter((f) => f.status === 'matched')
        .map((f) => ({ figureId: f.id, figureLabel: f.label, originalRef: f.originalRef, file: f.matchedFile }));

      // Classify against existing data.
      const doiKey = normalizeDoi(parsed.doi);
      const aipMatch = doiKey ? aipByDoi.get(doiKey) : null;
      const publishedMatch = doiKey ? publishedByDoi.get(doiKey) : null;
      // Intra-zip duplicate detection — first occurrence wins, the rest are
      // flagged in the preview so the operator can decide which XML to keep.
      const intraZipDuplicate = doiKey && doisInZip.has(doiKey) ? doisInZip.get(doiKey) : null;
      if (doiKey && !intraZipDuplicate) {
        doisInZip.set(doiKey, xmlInfo.name);
      }
      let importStatus = 'new';
      if (publishedMatch) importStatus = 'duplicate';
      else if (aipMatch) importStatus = 'promote';
      else if (intraZipDuplicate) importStatus = 'duplicate-in-zip';

      // Surface "you are about to overwrite stale files" so the operator can
      // see what import will wipe. We only know the target ID up front when
      // promoting an existing AIP / duplicate; for brand-new IDs the cleanup
      // runs anyway during import but there's nothing to preview.
      const previewTargetId = (publishedMatch && publishedMatch.id)
        || (aipMatch && aipMatch.id) || null;
      let existingAssets = null;
      if (previewTargetId) {
        const probe = listExistingArticleAssets(previewTargetId);
        if (probe.figures.length || probe.supplementary.length || probe.fullText) {
          existingAssets = probe;
        }
      }

      articles.push({
        xmlFile: xmlInfo.name,
        baseName,
        title: parsed.title,
        type: parsed.type,
        doi: parsed.doi,
        volume: parsed.volume,
        issue: parsed.issue,
        pages: parsed.pages,
        authors: (parsed.authors || []).map((a) => a.name),
        matchedPdf: matchedPdf?.name || null,
        figures,
        figureCount: figures.length,
        figuresMatched: figures.filter((f) => f.status === 'matched').length,
        figuresMissing: figures.filter((f) => f.status === 'missing').length,
        matchedImages, // legacy
        importStatus,
        aipMatch: aipMatch ? { id: aipMatch.id, title: aipMatch.title } : null,
        publishedMatch: publishedMatch ? { id: publishedMatch.id, title: publishedMatch.title } : null,
        intraZipDuplicateOf: intraZipDuplicate || null,
        existingAssets, // null when nothing on disk, or { figures:[], supplementary:[], fullText: bool }
        parsed, // keep full parsed data for import
      });
    } catch (err) {
      errors.push({ xmlFile: xmlInfo.name, error: err.message });
    }
  }

  // Orphan images: in ZIP but no JATS figure refers to them.
  const orphanImages = analysis.imageFiles
    .filter((img) => !consumedImages.has(img.entryName))
    .map((img) => ({ name: img.name, size: img.size, sizeHuman: formatBytes(img.size) }));

  return {
    zipFile: path.basename(zipPath),
    analysis,
    articles,
    errors,
    orphanImages,
    summary: {
      totalXml: analysis.xmlFiles.length,
      parsedOk: articles.length,
      parsedFail: errors.length,
      pdfsMatched: articles.filter((a) => a.matchedPdf).length,
      imagesMatched: articles.reduce((sum, a) => sum + a.figuresMatched, 0),
      imagesMissing: articles.reduce((sum, a) => sum + a.figuresMissing, 0),
      orphanImages: orphanImages.length,
      newArticles: articles.filter((a) => a.importStatus === 'new').length,
      promotedFromAip: articles.filter((a) => a.importStatus === 'promote').length,
      duplicates: articles.filter((a) => a.importStatus === 'duplicate').length,
      duplicatesInZip: articles.filter((a) => a.importStatus === 'duplicate-in-zip').length,
    },
  };
}

/**
 * Full import: parse XMLs, save articles + PDFs + figures + supplementary.
 * @param {string} zipPath - path to the ZIP file
 * @param {object} options - { targetVolume, targetIssue, setAsCurrent }
 */
async function importZip(zipPath, options = {}) {
  const { targetVolume, targetIssue, setAsCurrent } = options;
  const zip = new AdmZip(zipPath);
  const analysis = analyzeZip(zipPath);
  const imageIndex = buildImageIndex(analysis.imageFiles);

  const articles = dio.readArticles();
  const allMeta = dio.readAuthorMetadata();
  // Load AIP list so DOI-matched articles can be "promoted" (moved from
  // articles-in-press to articles) atomically as part of the same import,
  // instead of silently creating duplicates.
  const aipList = dio.readArticlesInPress();
  const aipByDoi = new Map();
  for (const a of aipList) {
    if (a.doi) aipByDoi.set(normalizeDoi(a.doi), a);
  }
  const promotedAipIds = new Set();
  const imported = [];
  const promoted = [];
  const errors = [];

  // Parse all XMLs first
  const parsedArticles = [];
  for (const xmlInfo of analysis.xmlFiles) {
    try {
      const xmlContent = zip.readAsText(xmlInfo.entryName);
      const parsed = await parseJatsXml(xmlContent);
      parsedArticles.push({ xmlInfo, parsed, baseName: path.parse(xmlInfo.name).name });
    } catch (err) {
      errors.push({ file: xmlInfo.name, error: err.message });
    }
  }

  // Track DOIs we've already imported in THIS run so two XMLs in the same
  // ZIP that share a DOI don't both win.
  const doisInThisRun = new Set();

  // Import each parsed article
  for (const { xmlInfo, parsed, baseName } of parsedArticles) {
    try {
      const doiKey = normalizeDoi(parsed.doi);

      // Same DOI seen earlier in this ZIP — skip with a clear error so the
      // operator can decide which XML to keep next time.
      if (doiKey && doisInThisRun.has(doiKey)) {
        errors.push({ file: xmlInfo.name, error: `Aynı DOI ZIP içinde başka bir XML'de zaten işlendi: ${parsed.doi}` });
        continue;
      }

      // Check duplicate DOI in published articles (true duplicate, skip)
      if (doiKey && articles.find((a) => normalizeDoi(a.doi) === doiKey)) {
        errors.push({ file: xmlInfo.name, error: `DOI zaten yayınlanmış makalelerde mevcut: ${parsed.doi}` });
        continue;
      }

      // Check AIP: if matched, this is a promotion — preserve the AIP id and
      // any preserved stats (views/downloads) so existing links/citations stay valid.
      const aipMatch = doiKey ? aipByDoi.get(doiKey) : null;
      const id = aipMatch ? aipMatch.id : dio.nextArticleId(articles);
      if (aipMatch) promotedAipIds.add(aipMatch.id);

      // Wipe any leftover figures/supplementaries from a previous import of
      // the same ID (re-import or AIP promotion) so the panel doesn't show
      // ghost files the current XML doesn't reference. PDF / full-text are
      // overwritten in place a few lines below and don't need cleaning.
      const cleanup = cleanArticleAssets(id);

      const article = {
        id,
        type: parsed.type || '',
        title: parsed.title || '',
        authors: parsed.authors || [],
        abstract: parsed.abstract || '',
        abstractHtml: parsed.abstractHtml || '',
        previewText: parsed.previewText || '',
        keywords: parsed.keywords || [],
        doi: parsed.doi || '',
        received: parsed.received || '',
        accepted: parsed.accepted || '',
        published: parsed.published || '',
        volume: targetVolume != null ? Number(targetVolume)
          : (parsed.volume != null && parsed.volume !== '' ? Number(parsed.volume) : null),
        issue: targetIssue != null ? String(targetIssue) : (parsed.issue || ''),
        pages: parsed.pages || '',
        // Preserve view/download counts when promoting from AIP — these are
        // accumulated user metrics and should not reset to zero just because
        // the article transitioned from "in press" to "published".
        views: aipMatch?.views || 0,
        downloads: aipMatch?.downloads || 0,
        citations: aipMatch?.citations || 0,
        featured: false, imageCorner: false,
        hasFullText: !!parsed.fullTextHtml,
        sourceIssueId: '', sourceArticleId: '', sourceAbstractUrl: '',
        sourceTextUrl: '', sourcePdfUrl: '', localPdfUrl: '', pdfUrl: '',
        pmid: parsed.pmid || '',
        elocationId: parsed.elocationId || '',
        supplementary: parsed.supplementary || [],
        funding: parsed.funding || [],
        permissions: parsed.permissions || null,
        relatedArticles: parsed.relatedArticles || [],
      };

      // --- Match & save PDF ---
      const matchedPdf = analysis.pdfFiles.find((p) =>
        path.parse(p.name).name === baseName
      );
      if (matchedPdf) {
        const pdfData = zip.readFile(matchedPdf.entryName);
        const pdfDest = path.join(dio.PATHS.pdfsDir, `${id}.pdf`);
        fs.writeFileSync(pdfDest, pdfData);
        article.pdfUrl = `js/data/pdfs/${id}.pdf`;
        article.localPdfUrl = article.pdfUrl;
      } else if (aipMatch) {
        // ZIP doesn't carry a PDF for this article, but we're promoting an
        // AIP entry that may already have one uploaded via the admin panel.
        // Preserve those URLs so the reader still sees the PDF — wiping
        // them would silently destroy work the editorial team already did.
        if (aipMatch.pdfUrl) article.pdfUrl = aipMatch.pdfUrl;
        if (aipMatch.localPdfUrl) article.localPdfUrl = aipMatch.localPdfUrl;
      }

      // --- Match & save figures ---
      let fullTextHtml = parsed.fullTextHtml || '';
      if (parsed.figures?.length) {
        const articleImgDir = path.join(dio.PATHS.articleImagesDir, String(id));
        if (!fs.existsSync(articleImgDir)) fs.mkdirSync(articleImgDir, { recursive: true });

        for (const fig of parsed.figures) {
          if (!fig.imageFile) continue;
          const figBase = path.parse(fig.imageFile).name;

          // Use shared fuzzy matcher (exact → case-insensitive → normalized key)
          const match = findImageMatch(fig.imageFile, analysis.imageFiles, imageIndex);

          if (match) {
            const imgData = zip.readFile(match.entryName);
            const ext = path.extname(match.name).toLowerCase();
            // Sanitise the figure filename — JATS exports occasionally ship
            // Turkish characters, spaces, parentheses, etc. that survive the
            // file write but break the URL when the article page later
            // requests the image (Türkçe karakter → %-encoded mismatch).
            // Mirrors the supplementary-file sanitiser below.
            const safeBase = figBase.replace(/[^a-zA-Z0-9._-]/g, '_');
            const destName = `${safeBase}${ext}`;
            const destPath = path.join(articleImgDir, destName);
            fs.writeFileSync(destPath, imgData);

            const newUrl = `images/articles/${id}/${destName}`;
            // Replace in full text HTML — match both quote styles and any
            // attribute the upstream JATS may have used (src, data-src,
            // xlink:href). The original code only handled double-quoted
            // src="…" which silently skipped the rest.
            const escaped = fig.imageFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            fullTextHtml = fullTextHtml.replace(
              new RegExp('(src|data-src|xlink:href)=(["\\\'])' + escaped + '\\2', 'gi'),
              '$1=$2' + newUrl + '$2'
            );
          }
        }
      }

      // --- Save supplementary files ---
      if (parsed.supplementary?.length) {
        const suppDir = path.join(dio.PATHS.supplementaryDir, String(id));

        for (const supp of parsed.supplementary) {
          if (!supp.href) continue;
          const suppBase = path.basename(supp.href);
          // Find matching file in ZIP
          const match = [...analysis.otherFiles, ...analysis.pdfFiles, ...analysis.imageFiles]
            .find((f) => f.name === suppBase || f.name.toLowerCase() === suppBase.toLowerCase());
          if (match) {
            if (!fs.existsSync(suppDir)) fs.mkdirSync(suppDir, { recursive: true });
            const suppData = zip.readFile(match.entryName);
            const safeName = suppBase.replace(/[^a-zA-Z0-9._-]/g, '_');
            fs.writeFileSync(path.join(suppDir, safeName), suppData);

            const newUrl = `js/data/supplementary/${id}/${safeName}`;
            // Update href in supplementary data
            supp.href = newUrl;
            // Update in full text HTML
            const escaped = suppBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            fullTextHtml = fullTextHtml.replace(
              new RegExp(`href="${escaped}"`, 'g'),
              `href="${newUrl}"`
            );
          }
        }
      }

      // Write full text. If the XML didn't ship a body but we're promoting
      // an AIP that already had one stored, leave the existing file in
      // place — `hasFullText` reflects what's actually on disk now.
      if (fullTextHtml) {
        dio.writeFullText(id, fullTextHtml);
      } else if (aipMatch && aipMatch.hasFullText) {
        article.hasFullText = true;
      }

      // Author metadata
      if (parsed.authorMetadata) {
        allMeta[id] = parsed.authorMetadata;
      }

      articles.unshift(article);
      if (doiKey) doisInThisRun.add(doiKey);
      const cleanedCount = (cleanup.figures.length + cleanup.supplementary.length);
      const record = {
        id,
        title: parsed.title,
        doi: parsed.doi,
        hasPdf: !!article.pdfUrl,
        figureCount: parsed.figures?.length || 0,
        promotedFromAip: !!aipMatch,
        cleanedStaleFiles: cleanedCount > 0
          ? { count: cleanedCount, figures: cleanup.figures, supplementary: cleanup.supplementary }
          : null,
      };
      imported.push(record);
      if (aipMatch) promoted.push(record);
    } catch (err) {
      errors.push({ file: xmlInfo.name, error: err.message });
    }
  }

  // Persist in the right order: published articles FIRST, AIP removal
  // SECOND. If writeArticles failed before AIP removal (used to be the
  // other way around), we would have ended up with promoted records
  // dropped from the AIP list but never landing in the published list —
  // i.e. silent data loss. With this order, a write failure in the
  // published list still preserves the original AIP record.
  dio.writeArticles(articles);
  if (Object.keys(allMeta).length) {
    dio.writeAuthorMetadata(allMeta);
  }
  if (promotedAipIds.size) {
    const remaining = aipList.filter((a) => !promotedAipIds.has(a.id));
    dio.writeArticlesInPress(remaining);
  }

  // Register / refresh the archive-issues entry for every (volume, issue) the
  // imported articles belong to. This must CREATE a missing issue — not just
  // update an existing one — otherwise a ZIP-imported issue never appears in
  // the "Sayılar" list (especially in auto mode, where no targetVolume/Issue
  // was supplied and volume/issue come straight from the parsed XML).
  const importedIssues = new Map(); // "vol|iss" -> { volume, issue, year }
  for (const rec of imported) {
    const art = articles.find((a) => a.id === rec.id);
    if (!art || !art.volume || !art.issue) continue;
    const v = Number(art.volume);
    const i = String(art.issue);
    if (!v || !i) continue;
    const key = `${v}|${i}`;
    if (!importedIssues.has(key)) {
      const year = (String(art.published || '').match(/(?:19|20)\d{2}/) || [])[0]
        || String(new Date().getFullYear());
      importedIssues.set(key, { volume: v, issue: i, year: String(year) });
    }
  }

  if (importedIssues.size) {
    const archive = dio.readArchiveIssues();
    for (const { volume, issue, year } of importedIssues.values()) {
      const count = dio.rebuildVolumeJson(volume, issue, articles);
      let issObj = null;
      for (const y of archive) {
        const found = y.issues.find((i) => i.volume === volume && String(i.issue) === issue);
        if (found) { issObj = found; break; }
      }
      if (issObj) {
        issObj.articleCount = count;
        issObj.hasLocalData = true;
      } else {
        let yearGroup = archive.find((y) => y.year === year);
        if (!yearGroup) {
          yearGroup = { year, volume, issues: [] };
          archive.unshift(yearGroup);
          archive.sort((a, b) => Number(b.year) - Number(a.year));
        }
        yearGroup.issues.unshift({
          label: `Volume ${volume}, Issue ${issue}`,
          sourceId: '', sourceUrl: '',
          volume, issue,
          articleCount: count,
          hasLocalData: true,
        });
      }
    }
    dio.writeArchiveIssues(archive);
  }

  // Resolve the primary (volume, issue) for the return value / homepage: the
  // explicit target if given, otherwise the issue the articles were imported into.
  let vol = targetVolume != null ? Number(targetVolume) : null;
  let iss = targetIssue != null ? String(targetIssue) : null;
  if ((!vol || !iss) && importedIssues.size) {
    const first = importedIssues.values().next().value;
    if (!vol) vol = first.volume;
    if (!iss) iss = first.issue;
  }

  // Set as current issue if requested
  if (setAsCurrent && vol && iss) {
    rebuildHomepage(vol, iss, articles);
  }

  // Move ZIP to processed folder
  const zipName = path.basename(zipPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const processedName = `${timestamp}_${zipName}`;
  const processedPath = path.join(PROCESSED_DIR, processedName);
  try {
    fs.copyFileSync(zipPath, processedPath);
    // Only delete from imports if it was there
    if (zipPath.startsWith(IMPORTS_DIR) && !zipPath.startsWith(PROCESSED_DIR)) {
      fs.unlinkSync(zipPath);
    }
  } catch { /* ignore move errors */ }

  return {
    imported,
    promoted,
    errors,
    totalImported: imported.length,
    totalPromoted: promoted.length,
    totalErrors: errors.length,
    volume: vol,
    issue: iss,
  };
}

/**
 * Rebuild homepage data for a given issue.
 */
function rebuildHomepage(volume, issue, articles) {
  const vol = Number(volume);
  const issueArticles = articles.filter(
    (a) => a.volume === vol && String(a.issue) === String(issue)
  );

  const archive = dio.readArchiveIssues();
  let year = '';
  for (const y of archive) {
    const iss = y.issues.find((i) => i.volume === vol && String(i.issue) === String(issue));
    if (iss) { year = y.year; break; }
  }

  const mapArticle = (a) => ({
    id: a.id, type: a.type, title: a.title,
    authors: (a.authors || []).map((au) => ({ name: au.name })),
    doi: a.doi, volume: a.volume, issue: a.issue,
    pages: a.pages, published: a.published,
    previewText: a.previewText || '',
    imageUrl: a.imageUrl || '',
  });

  const featured = issueArticles.filter((a) => a.featured);
  const imageCorner = issueArticles.filter((a) => a.imageCorner);
  const mostCited = [...issueArticles].sort((a, b) => (b.citations || 0) - (a.citations || 0)).slice(0, 5);

  const homepageData = {
    generatedAt: new Date().toISOString().slice(0, 10),
    currentIssue: { volume: vol, issue: String(issue), year },
    featuredArticles: featured.map(mapArticle),
    imageCornerArticles: imageCorner.map(mapArticle),
    mostCitedArticles: mostCited.map(mapArticle),
    latestArticles: issueArticles.slice(0, 10).map(mapArticle),
  };

  dio.writeHomepageData(homepageData);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

module.exports = {
  IMPORTS_DIR,
  PROCESSED_DIR,
  scanImportsDir,
  analyzeZip,
  previewZip,
  importZip,
  normalizeFigureKey,
  normalizeDoi,
  findImageMatch,
  cleanArticleAssets,
  listExistingArticleAssets,
};
