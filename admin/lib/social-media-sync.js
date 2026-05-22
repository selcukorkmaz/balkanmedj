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

// All SVG paths are from Simple Icons (CC0). Brand colors used in the admin
// preview only — on the live footer all icons render in --teal-300 as before.
const PLATFORMS = [
  {
    key: 'instagram',
    label: 'Instagram',
    color: '#E4405F',
    placeholder: 'https://www.instagram.com/balkanmedj/',
    svgPath: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
  },
  {
    key: 'twitter',
    label: 'X (Twitter)',
    color: '#000000',
    placeholder: 'https://x.com/balkanmedj',
    svgPath: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    color: '#0A66C2',
    placeholder: 'https://www.linkedin.com/company/balkan-med-j/',
    svgPath: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  },
  {
    key: 'facebook',
    label: 'Facebook',
    color: '#1877F2',
    placeholder: 'https://www.facebook.com/balkanmedj',
    svgPath: 'M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0z',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    color: '#FF0000',
    placeholder: 'https://www.youtube.com/@balkanmedj',
    svgPath: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    color: '#000000',
    placeholder: 'https://www.tiktok.com/@balkanmedj',
    svgPath: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  },
  {
    key: 'bluesky',
    label: 'Bluesky',
    color: '#0085FF',
    placeholder: 'https://bsky.app/profile/balkanmedj.bsky.social',
    svgPath: 'M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z',
  },
  {
    key: 'researchgate',
    label: 'ResearchGate',
    color: '#00CCBB',
    placeholder: 'https://www.researchgate.net/journal/Balkan-Medical-Journal',
    svgPath: 'M19.586 0c-.818 0-1.508.19-2.073.565-.563.377-.97.936-1.213 1.68a3.193 3.193 0 0 0-.112.437 8.365 8.365 0 0 0-.078.53 9 9 0 0 0-.05.727c-.01.282-.013.621-.013 1.016a31.121 31.121 0 0 0 .014 1.017 9 9 0 0 0 .05.727 7.946 7.946 0 0 0 .077.53h.001a3.13 3.13 0 0 0 .111.438c.243.743.65 1.303 1.214 1.68.565.376 1.256.564 2.075.564.8 0 1.536-.213 2.105-.638.57-.428.94-1.026 1.082-1.74a7.07 7.07 0 0 0 .088-.51c.02-.197.035-.42.048-.67.013-.251.022-.537.026-.86.005-.322.007-.692.007-1.11 0-.39-.002-.741-.006-1.05a31.402 31.402 0 0 0-.024-.794 12.59 12.59 0 0 0-.044-.612 7.492 7.492 0 0 0-.082-.518 2.875 2.875 0 0 0-.096-.387 2.32 2.32 0 0 0-.116-.306 2.629 2.629 0 0 0-.36-.59 2.626 2.626 0 0 0-.512-.471 2.832 2.832 0 0 0-.62-.34 3.371 3.371 0 0 0-.71-.18A4.785 4.785 0 0 0 19.587 0zm-8.376 5.535c.46 0 .81.13 1.05.39.241.26.362.633.362 1.12 0 .298-.034.54-.1.728-.066.187-.16.336-.282.446a.94.94 0 0 1-.418.222 2.05 2.05 0 0 1-.508.06h-.972V5.535zM0 7.221V24h3.075v-6.45h2.084L8.69 24h3.498L8.27 16.937c1.066-.428 1.853-1.04 2.36-1.835.508-.795.762-1.785.762-2.97 0-.788-.13-1.482-.39-2.082-.26-.6-.625-1.103-1.094-1.51-.47-.408-1.04-.715-1.71-.92-.67-.205-1.413-.31-2.232-.31z',
  },
  {
    key: 'orcid',
    label: 'ORCID',
    color: '#A6CE39',
    placeholder: 'https://orcid.org/0000-0000-0000-0000',
    svgPath: 'M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zM7.369 4.378c.525 0 .947.431.947.947s-.422.947-.947.947a.95.95 0 0 1-.947-.947c0-.525.422-.947.947-.947zm-.722 3.038h1.444v10.041H6.647V7.416zm3.562 0h3.9c3.712 0 5.344 2.653 5.344 5.025 0 2.578-2.016 5.025-5.325 5.025h-3.919V7.416zm1.444 1.303v7.444h2.297c3.272 0 4.022-2.484 4.022-3.722 0-2.016-1.284-3.722-4.097-3.722h-2.222z',
  },
  {
    key: 'rss',
    label: 'RSS Feed',
    color: '#F26522',
    placeholder: 'https://www.balkanmedicaljournal.org/rss',
    svgPath: 'M19.199 24C19.199 13.467 10.533 4.8 0 4.8V0c13.165 0 24 10.835 24 24h-4.801zM3.291 17.415a3.293 3.293 0 0 1 3.293 3.295A3.29 3.29 0 0 1 3.295 24C1.46 24 0 22.526 0 20.71s1.46-3.294 3.291-3.294zM15.909 24h-4.665c0-6.169-5.075-11.245-11.244-11.245V8.09c8.727 0 15.909 7.184 15.909 15.91z',
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
