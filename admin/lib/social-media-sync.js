const fs = require('fs');
const path = require('path');
const { ROOT } = require('./data-io');
const { getAllHtmlFiles } = require('./page-template');

const BUILTIN_HTML_FILES = [
  'index.html', 'about.html', 'editorial-board.html', 'current-issue.html',
  'articles-in-press.html', 'archive.html', 'article.html', 'for-authors.html',
  'for-reviewers.html', 'policies.html', 'news.html', 'news-article.html',
  'contact.html', 'forms.html', 'journal-metrics.html', 'search-results.html',
];

const PLATFORMS = [
  {
    key: 'instagram',
    label: 'Instagram',
    svgPath: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
  },
  {
    key: 'twitter',
    label: 'X (Twitter)',
    svgPath: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    svgPath: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  },
  {
    key: 'facebook',
    label: 'Facebook',
    svgPath: 'M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0z',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    svgPath: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  },
];

const LABELS_FOR_REGEX = PLATFORMS.map((p) => p.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const SOCIAL_BLOCK_RE = new RegExp(
  '<a[^>]*aria-label="(?:' + LABELS_FOR_REGEX + ')"[^>]*>[\\s\\S]*?<\\/a>(?:\\s*<a[^>]*aria-label="(?:' + LABELS_FOR_REGEX + ')"[^>]*>[\\s\\S]*?<\\/a>)*'
);

function escapeHtmlAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildSocialLink(platform, url) {
  return '<a href="' + escapeHtmlAttr(url) + '" target="_blank" rel="noopener" aria-label="' + platform.label + '" class="text-teal-300 hover:text-white transition-colors"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="' + platform.svgPath + '"/></svg></a>';
}

function buildBlock(socialUrls) {
  const links = PLATFORMS
    .filter((p) => socialUrls && typeof socialUrls[p.key] === 'string' && socialUrls[p.key].trim())
    .map((p) => buildSocialLink(p, socialUrls[p.key].trim()));
  return links.join('\n              ');
}

function syncSocialMedia(socialUrls) {
  const blockHtml = buildBlock(socialUrls);
  const replacement = blockHtml || '';

  const results = [];
  const HTML_FILES = getAllHtmlFiles(BUILTIN_HTML_FILES);
  for (const file of HTML_FILES) {
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) {
      results.push({ file, status: 'skipped', reason: 'file not found' });
      continue;
    }
    try {
      const html = fs.readFileSync(filePath, 'utf-8');
      if (!SOCIAL_BLOCK_RE.test(html)) {
        results.push({ file, status: 'no-block' });
        continue;
      }
      const updated = html.replace(SOCIAL_BLOCK_RE, replacement);
      if (updated === html) {
        results.push({ file, status: 'unchanged' });
        continue;
      }
      fs.writeFileSync(filePath, updated, 'utf-8');
      results.push({ file, status: 'updated' });
    } catch (err) {
      results.push({ file, status: 'error', reason: err.message });
    }
  }
  return { syncedAt: new Date().toISOString(), results };
}

module.exports = { syncSocialMedia, PLATFORMS };
