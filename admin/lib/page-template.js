/**
 * Custom pages — persistence, template generation, and slug helpers.
 *
 * Custom pages live in `admin/data/custom-pages.json` as an array of
 * `{ slug, file, title, description, createdAt }`. The HTML file itself is
 * written to the site root alongside the hand-authored pages (about.html etc.).
 */

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./data-io');

const CUSTOM_PAGES_PATH = path.join(__dirname, '..', 'data', 'custom-pages.json');
const TEMPLATE_SOURCE = path.join(ROOT, 'journal-metrics.html');

// Slugs reserved by built-in pages or known site files — cannot be overwritten.
const RESERVED_SLUGS = new Set([
  'index', 'about', 'editorial-board', 'current-issue', 'articles-in-press',
  'archive', 'article', 'for-authors', 'for-reviewers', 'policies', 'news',
  'news-article', 'contact', 'forms', 'journal-metrics', 'search-results',
]);

function readCustomPages() {
  if (!fs.existsSync(CUSTOM_PAGES_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(CUSTOM_PAGES_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function writeCustomPages(pages) {
  fs.mkdirSync(path.dirname(CUSTOM_PAGES_PATH), { recursive: true });
  fs.writeFileSync(CUSTOM_PAGES_PATH, JSON.stringify(pages, null, 2), 'utf-8');
}

function normalizeSlug(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function validateSlug(slug) {
  if (!slug) return 'Slug boş olamaz';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug)) {
    return 'Slug yalnızca küçük harf, rakam ve tire içerebilir';
  }
  if (RESERVED_SLUGS.has(slug)) return 'Bu slug sistem sayfaları için ayrılmıştır';
  return null;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/**
 * Build a new HTML page by cloning an existing site page's shell
 * (so nav/footer/scripts match) and replacing head + main content.
 */
function createPageHtml({ slug, title, description }) {
  if (!fs.existsSync(TEMPLATE_SOURCE)) {
    throw new Error('Şablon dosyası bulunamadı: journal-metrics.html');
  }
  const source = fs.readFileSync(TEMPLATE_SOURCE, 'utf-8');

  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description || `${title} — Balkan Medical Journal`);
  const url = `https://balkanmedicaljournal.org/${slug}.html`;

  // Rebuild <head>: keep favicon/stylesheet links, rewrite title+meta.
  const newHead = `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} — Balkan Medical Journal</title>
  <meta name="description" content="${safeDesc}">
  <meta property="og:title" content="${safeTitle} — Balkan Medical Journal">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="https://balkanmedicaljournal.org/images/cover/cover1.jpeg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle} — Balkan Medical Journal">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image" content="https://balkanmedicaljournal.org/images/cover/cover1.jpeg">
  <link rel="icon" href="images/favicon.ico" type="image/x-icon">
  <link rel="icon" href="images/favicon-32x32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="images/apple-touch-icon.png">
  <link rel="stylesheet" href="css/style.css">
</head>`;

  let html = source.replace(/<head>[\s\S]*?<\/head>/, newHead);

  // Replace <main> content with breadcrumb + header + empty section.
  const newMain = `<main id="main-content">

    <!-- Breadcrumb -->
    <div class="bg-gray-50 border-b border-gray-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <nav aria-label="Breadcrumb">
          <ol class="flex items-center space-x-2 text-sm text-gray-500">
            <li>
              <a href="index.html" class="hover:text-teal-700 transition-colors">Home</a>
            </li>
            <li>
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </li>
            <li>
              <span class="text-gray-900 font-medium" aria-current="page">${safeTitle}</span>
            </li>
          </ol>
        </nav>
      </div>
    </div>

    <!-- Page Header -->
    <div class="bg-white border-b border-gray-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 class="text-3xl md:text-4xl font-bold text-gray-900">${safeTitle}</h1>
        <p class="mt-2 text-gray-500 text-lg font-serif">${safeDesc}</p>
      </div>
    </div>

    <!-- Content -->
    <section class="py-12 bg-white">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="prose prose-gray max-w-none text-gray-700 leading-relaxed space-y-4">
          <p>Bu sayfanın içeriğini yönetim panelinden düzenleyebilirsiniz.</p>
        </div>
      </div>
    </section>

  </main>`;

  html = html.replace(/<main\s+id="main-content"[^>]*>[\s\S]*?<\/main>/, newMain);

  return html;
}

function getAllHtmlFiles(staticList) {
  const custom = readCustomPages().map((p) => p.file);
  const merged = [...staticList];
  for (const f of custom) if (!merged.includes(f)) merged.push(f);
  return merged;
}

module.exports = {
  CUSTOM_PAGES_PATH,
  RESERVED_SLUGS,
  readCustomPages,
  writeCustomPages,
  normalizeSlug,
  validateSlug,
  createPageHtml,
  getAllHtmlFiles,
};
