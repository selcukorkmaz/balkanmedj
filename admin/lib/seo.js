/**
 * SEO / discoverability file generation.
 *
 * Regenerates two files in the repo root from the current article data so search
 * engines and aggregators always see the latest content:
 *   - sitemap.xml  (static pages + every published & in-press article)
 *   - rss.xml      (RSS 2.0 feed of the most recent published articles)
 *
 * Kept separate from data-io.js to avoid a circular require (this module reads
 * via data-io). Call regenerateSeoFiles() from the admin endpoints that create,
 * update, delete, or publish articles.
 */

const fs = require('fs');
const path = require('path');
const dio = require('./data-io');

const BASE = 'https://balkanmedicaljournal.org';
const FEED_MAX = 60; // most-recent published articles included in the RSS feed

// Static pages (mirrors the hand-maintained sitemap so nothing is lost).
const STATIC_PAGES = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/current-issue.html', changefreq: 'monthly', priority: '0.9' },
  { loc: '/articles-in-press.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/archive.html', changefreq: 'monthly', priority: '0.7' },
  { loc: '/about.html', changefreq: 'yearly', priority: '0.5' },
  { loc: '/editorial-board.html', changefreq: 'yearly', priority: '0.5' },
  { loc: '/for-authors.html', changefreq: 'yearly', priority: '0.6' },
  { loc: '/for-reviewers.html', changefreq: 'yearly', priority: '0.5' },
  { loc: '/policies.html', changefreq: 'yearly', priority: '0.5' },
  { loc: '/contact.html', changefreq: 'yearly', priority: '0.4' },
  { loc: '/news.html', changefreq: 'weekly', priority: '0.6' },
  { loc: '/forms.html', changefreq: 'yearly', priority: '0.3' },
];

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripHtml(s) {
  return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// "2026-06-01" → "2026-06-01" (sitemap lastmod wants W3C date; keep as-is if valid)
function isoDate(s) {
  const m = String(s || '').match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
}

// "2026-06-01" → RFC-822 for RSS pubDate.
function rfc822(s) {
  const iso = isoDate(s);
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return isNaN(d.getTime()) ? '' : d.toUTCString();
}

function articleUrl(id) { return `${BASE}/article.html?id=${id}`; }

function buildSitemap(articles, aip, today) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  lines.push('  <!-- Static Pages -->');
  STATIC_PAGES.forEach((p) => {
    lines.push(`  <url><loc>${xmlEscape(BASE + p.loc)}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`);
  });
  lines.push('  <!-- Published Articles -->');
  articles.forEach((a) => {
    if (!a || !a.id) return;
    const lastmod = isoDate(a.published) || today;
    lines.push(`  <url><loc>${xmlEscape(articleUrl(a.id))}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`);
  });
  if (aip && aip.length) {
    lines.push('  <!-- Articles in Press -->');
    aip.forEach((a) => {
      if (!a || !a.id) return;
      const lastmod = isoDate(a.publishedOnline) || isoDate(a.published) || today;
      lines.push(`  <url><loc>${xmlEscape(articleUrl(a.id))}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`);
    });
  }
  lines.push('</urlset>');
  return lines.join('\n') + '\n';
}

function buildRss(articles, buildDateRfc) {
  // Most-recent published first.
  const sorted = articles
    .filter((a) => a && a.id && a.title)
    .slice()
    .sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')))
    .slice(0, FEED_MAX);

  const items = sorted.map((a) => {
    const link = articleUrl(a.id);
    const guid = a.doi ? `https://doi.org/${a.doi}` : link;
    const desc = stripHtml(a.abstractHtml || a.abstract || a.previewText || '').slice(0, 600);
    const authors = (a.authors || []).map((x) => x && x.name).filter(Boolean).join(', ');
    const pub = rfc822(a.published);
    const parts = [];
    parts.push('    <item>');
    parts.push(`      <title>${xmlEscape(a.title)}</title>`);
    parts.push(`      <link>${xmlEscape(link)}</link>`);
    parts.push(`      <guid isPermaLink="${a.doi ? 'false' : 'true'}">${xmlEscape(guid)}</guid>`);
    if (pub) parts.push(`      <pubDate>${pub}</pubDate>`);
    if (a.doi) parts.push(`      <dc:identifier>doi:${xmlEscape(a.doi)}</dc:identifier>`);
    if (authors) parts.push(`      <dc:creator>${xmlEscape(authors)}</dc:creator>`);
    if (a.type) parts.push(`      <category>${xmlEscape(a.type)}</category>`);
    parts.push(`      <description>${xmlEscape(desc)}</description>`);
    parts.push('    </item>');
    return parts.join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>Balkan Medical Journal</title>',
    `    <link>${BASE}/</link>`,
    '    <description>Balkan Medical Journal — latest published articles</description>',
    '    <language>en</language>',
    `    <atom:link href="${BASE}/rss.xml" rel="self" type="application/rss+xml" />`,
    buildDateRfc ? `    <lastBuildDate>${buildDateRfc}</lastBuildDate>` : '',
    items.join('\n'),
    '  </channel>',
    '</rss>',
    '',
  ].filter((l) => l !== '').join('\n');
}

/**
 * Regenerate sitemap.xml + rss.xml from the current data. Best-effort: throws
 * are caught by callers so a feed glitch never blocks an article save.
 * Returns { articles, aip } counts.
 */
function regenerateSeoFiles() {
  const articles = dio.readArticles() || [];
  let aip = [];
  try { aip = dio.readArticlesInPress() || []; } catch (_) { aip = []; }
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const buildDateRfc = now.toUTCString();

  const sitemap = buildSitemap(articles, aip, today);
  const rss = buildRss(articles, buildDateRfc);

  const write = (file, content) => {
    const full = path.join(dio.ROOT, file);
    const tmp = full + '.tmp';
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, full);
  };
  write('sitemap.xml', sitemap);
  write('rss.xml', rss);
  return { articles: articles.length, aip: aip.length };
}

module.exports = { regenerateSeoFiles, buildSitemap, buildRss, BASE };
