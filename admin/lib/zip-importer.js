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

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = path.basename(entry.entryName);
    if (name.startsWith('.') || name.startsWith('__MACOSX')) continue;

    const ext = path.extname(name).toLowerCase();
    const info = { name, entryName: entry.entryName, size: entry.header.size };

    if (ext === '.xml') xmlFiles.push(info);
    else if (ext === PDF_EXT) pdfFiles.push(info);
    else if (IMAGE_EXTS.has(ext)) imageFiles.push(info);
    else otherFiles.push(info);
  }

  return { xmlFiles, pdfFiles, imageFiles, otherFiles, totalEntries: entries.length };
}

/**
 * Preview: parse all XMLs in the ZIP without importing.
 */
async function previewZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const analysis = analyzeZip(zipPath);
  const articles = [];
  const errors = [];

  for (const xmlInfo of analysis.xmlFiles) {
    try {
      const xmlContent = zip.readAsText(xmlInfo.entryName);
      const parsed = await parseJatsXml(xmlContent);
      const baseName = path.parse(xmlInfo.name).name;

      // Find matching PDF
      const matchedPdf = analysis.pdfFiles.find((p) =>
        path.parse(p.name).name === baseName
      );

      // Find matching images (by figure references in parsed data)
      const matchedImages = [];
      for (const fig of parsed.figures || []) {
        if (fig.imageFile) {
          const figBase = path.parse(fig.imageFile).name;
          const match = analysis.imageFiles.find((img) => {
            const imgBase = path.parse(img.name).name;
            return imgBase === figBase || imgBase.toLowerCase() === figBase.toLowerCase();
          });
          if (match) {
            matchedImages.push({ figureId: fig.id, figureLabel: fig.label, originalRef: fig.imageFile, file: match.name });
          }
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
        matchedImages,
        figureCount: (parsed.figures || []).length,
        parsed, // keep full parsed data for import
      });
    } catch (err) {
      errors.push({ xmlFile: xmlInfo.name, error: err.message });
    }
  }

  return {
    zipFile: path.basename(zipPath),
    analysis,
    articles,
    errors,
    summary: {
      totalXml: analysis.xmlFiles.length,
      parsedOk: articles.length,
      parsedFail: errors.length,
      pdfsMatched: articles.filter((a) => a.matchedPdf).length,
      imagesMatched: articles.reduce((sum, a) => sum + a.matchedImages.length, 0),
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

  const articles = dio.readArticles();
  const allMeta = dio.readAuthorMetadata();
  const imported = [];
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

  // Import each parsed article
  for (const { xmlInfo, parsed, baseName } of parsedArticles) {
    try {
      // Check duplicate DOI
      if (parsed.doi && articles.find((a) => a.doi === parsed.doi)) {
        errors.push({ file: xmlInfo.name, error: `DOI zaten mevcut: ${parsed.doi}` });
        continue;
      }

      const id = dio.nextArticleId(articles);

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
        volume: targetVolume != null ? Number(targetVolume) : (parsed.volume || null),
        issue: targetIssue != null ? String(targetIssue) : (parsed.issue || ''),
        pages: parsed.pages || '',
        views: 0, downloads: 0, citations: 0,
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
      }

      // --- Match & save figures ---
      let fullTextHtml = parsed.fullTextHtml || '';
      if (parsed.figures?.length) {
        const articleImgDir = path.join(dio.PATHS.articleImagesDir, String(id));
        if (!fs.existsSync(articleImgDir)) fs.mkdirSync(articleImgDir, { recursive: true });

        for (const fig of parsed.figures) {
          if (!fig.imageFile) continue;
          const figBase = path.parse(fig.imageFile).name;

          // Find matching image in ZIP (try exact name, then case-insensitive)
          const match = analysis.imageFiles.find((img) => {
            const imgBase = path.parse(img.name).name;
            return imgBase === figBase || imgBase.toLowerCase() === figBase.toLowerCase();
          });

          if (match) {
            const imgData = zip.readFile(match.entryName);
            const ext = path.extname(match.name).toLowerCase();
            const destName = `${figBase}${ext}`;
            const destPath = path.join(articleImgDir, destName);
            fs.writeFileSync(destPath, imgData);

            const newUrl = `images/articles/${id}/${destName}`;
            // Replace in full text HTML
            const escaped = fig.imageFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            fullTextHtml = fullTextHtml.replace(
              new RegExp(`src="${escaped}"`, 'g'),
              `src="${newUrl}"`
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

      // Write full text
      if (fullTextHtml) {
        dio.writeFullText(id, fullTextHtml);
      }

      // Author metadata
      if (parsed.authorMetadata) {
        allMeta[id] = parsed.authorMetadata;
      }

      articles.unshift(article);
      imported.push({
        id,
        title: parsed.title,
        doi: parsed.doi,
        hasPdf: !!article.pdfUrl,
        figureCount: parsed.figures?.length || 0,
      });
    } catch (err) {
      errors.push({ file: xmlInfo.name, error: err.message });
    }
  }

  // Write all data
  dio.writeArticles(articles);
  if (Object.keys(allMeta).length) {
    dio.writeAuthorMetadata(allMeta);
  }

  // Rebuild volume JSON
  const vol = targetVolume != null ? Number(targetVolume) : null;
  const iss = targetIssue != null ? String(targetIssue) : null;
  if (vol && iss) {
    const count = dio.rebuildVolumeJson(vol, iss, articles);
    const archive = dio.readArchiveIssues();
    for (const y of archive) {
      const issObj = y.issues.find((i) => i.volume === vol && String(i.issue) === iss);
      if (issObj) { issObj.articleCount = count; issObj.hasLocalData = true; break; }
    }
    dio.writeArchiveIssues(archive);
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
    errors,
    totalImported: imported.length,
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
};
