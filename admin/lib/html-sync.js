/**
 * HTML Sync — inject nav/footer data into all HTML pages.
 */

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./data-io');
const { getAllHtmlFiles } = require('./page-template');

const NAV_FOOTER_PATH = path.join(__dirname, '..', 'data', 'nav-footer.json');

const BUILTIN_HTML_FILES = [
  'index.html', 'about.html', 'editorial-board.html', 'current-issue.html',
  'articles-in-press.html', 'archive.html', 'article.html', 'for-authors.html',
  'for-reviewers.html', 'policies.html', 'news.html', 'news-article.html',
  'contact.html', 'forms.html', 'journal-metrics.html', 'search-results.html',
  'manuscript-submission.html',
];

function readNavFooterData() {
  if (!fs.existsSync(NAV_FOOTER_PATH)) return null;
  return JSON.parse(fs.readFileSync(NAV_FOOTER_PATH, 'utf-8'));
}

/**
 * Seed the nav/footer data file with the default structured model and the
 * HTML generated from it. The form-based editor works on the model; the
 * generated navHtml/footerHtml are what syncAllPages writes into the pages.
 */
function bootstrapNavFooterData() {
  const tpl = require('./nav-footer-template');
  const data = tpl.buildNavFooterData(tpl.DEFAULT_MODEL);
  fs.mkdirSync(path.dirname(NAV_FOOTER_PATH), { recursive: true });
  fs.writeFileSync(NAV_FOOTER_PATH, JSON.stringify(data, null, 2), 'utf-8');
  return data;
}

/**
 * Sync nav/footer HTML into all pages.
 */
function syncAllPages() {
  let data = readNavFooterData();
  if (!data) {
    data = bootstrapNavFooterData();
  }

  const results = [];
  const HTML_FILES = getAllHtmlFiles(BUILTIN_HTML_FILES);

  for (const file of HTML_FILES) {
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) {
      results.push({ file, status: 'skipped', reason: 'file not found' });
      continue;
    }

    try {
      const original = fs.readFileSync(filePath, 'utf-8');
      let html = original;

      // Replace nav
      if (data.navHtml) {
        const navRegex = /<nav\s[^>]*class="[^"]*bg-white[^"]*border-b[^"]*"[^>]*>[\s\S]*?<\/nav>/;
        if (navRegex.test(html)) html = html.replace(navRegex, data.navHtml);
      }

      // Replace footer
      if (data.footerHtml) {
        const footerRegex = /<footer\s[^>]*class="[^"]*bg-teal-900[^"]*"[^>]*>[\s\S]*?<\/footer>/;
        if (footerRegex.test(html)) html = html.replace(footerRegex, data.footerHtml);
      }

      // Only write if content actually changed — keeps the sync idempotent and
      // gives the UI an accurate "unchanged" count on subsequent runs.
      if (html !== original) {
        fs.writeFileSync(filePath, html, 'utf-8');
        results.push({ file, status: 'updated' });
      } else {
        results.push({ file, status: 'unchanged' });
      }
    } catch (err) {
      results.push({ file, status: 'error', reason: err.message });
    }
  }

  return { syncedAt: new Date().toISOString(), results };
}

module.exports = { syncAllPages, bootstrapNavFooterData, readNavFooterData };
