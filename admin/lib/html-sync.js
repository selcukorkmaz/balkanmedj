/**
 * HTML Sync — inject nav/footer data into all HTML pages.
 */

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./data-io');

const NAV_FOOTER_PATH = path.join(__dirname, '..', 'data', 'nav-footer.json');

const HTML_FILES = [
  'index.html', 'about.html', 'editorial-board.html', 'current-issue.html',
  'articles-in-press.html', 'archive.html', 'article.html', 'for-authors.html',
  'for-reviewers.html', 'policies.html', 'news.html', 'news-article.html',
  'contact.html', 'forms.html', 'journal-metrics.html', 'search-results.html',
];

function readNavFooterData() {
  if (!fs.existsSync(NAV_FOOTER_PATH)) return null;
  return JSON.parse(fs.readFileSync(NAV_FOOTER_PATH, 'utf-8'));
}

/**
 * Extract current nav/footer from a reference HTML file and save as JSON.
 */
function bootstrapNavFooterData() {
  const refFile = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(refFile, 'utf-8');

  // Extract nav HTML
  const navMatch = html.match(/<nav\s[^>]*class="[^"]*bg-white[^"]*border-b[^"]*"[^>]*>([\s\S]*?)<\/nav>/);
  const navHtml = navMatch ? navMatch[0] : '';

  // Extract footer HTML
  const footerMatch = html.match(/<footer\s[^>]*class="[^"]*bg-teal-900[^"]*"[^>]*>([\s\S]*?)<\/footer>/);
  const footerHtml = footerMatch ? footerMatch[0] : '';

  const data = {
    _note: 'Auto-extracted from index.html. Edit via admin panel.',
    navHtml,
    footerHtml,
  };

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

  for (const file of HTML_FILES) {
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) {
      results.push({ file, status: 'skipped', reason: 'file not found' });
      continue;
    }

    try {
      let html = fs.readFileSync(filePath, 'utf-8');
      let changed = false;

      // Replace nav
      if (data.navHtml) {
        const navRegex = /<nav\s[^>]*class="[^"]*bg-white[^"]*border-b[^"]*"[^>]*>[\s\S]*?<\/nav>/;
        if (navRegex.test(html)) {
          html = html.replace(navRegex, data.navHtml);
          changed = true;
        }
      }

      // Replace footer
      if (data.footerHtml) {
        const footerRegex = /<footer\s[^>]*class="[^"]*bg-teal-900[^"]*"[^>]*>[\s\S]*?<\/footer>/;
        if (footerRegex.test(html)) {
          html = html.replace(footerRegex, data.footerHtml);
          changed = true;
        }
      }

      if (changed) {
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
