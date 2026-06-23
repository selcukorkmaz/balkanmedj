<?php
namespace Export;

use JsFile;

/**
 * Regenerates sitemap.xml + rss.xml from current article data.
 * PHP port of admin/lib/seo.js. Best-effort: callers ignore failures so a feed
 * glitch never blocks a save.
 */
class Seo
{
    const BASE = 'https://balkanmedicaljournal.org';
    const FEED_MAX = 60;

    private static array $STATIC_PAGES = [
        ['/', 'weekly', '1.0'],
        ['/current-issue.html', 'monthly', '0.9'],
        ['/articles-in-press.html', 'weekly', '0.8'],
        ['/archive.html', 'monthly', '0.7'],
        ['/about.html', 'yearly', '0.5'],
        ['/editorial-board.html', 'yearly', '0.5'],
        ['/for-authors.html', 'yearly', '0.6'],
        ['/for-reviewers.html', 'yearly', '0.5'],
        ['/policies.html', 'yearly', '0.5'],
        ['/contact.html', 'yearly', '0.4'],
        ['/news.html', 'weekly', '0.6'],
        ['/forms.html', 'yearly', '0.3'],
    ];

    private static function xmlEscape($s): string
    {
        $s = (string)($s ?? '');
        return str_replace(
            ['&', '<', '>', '"', "'"],
            ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;'],
            $s
        );
    }

    private static function stripHtml($s): string
    {
        $s = preg_replace('/<[^>]*>/', ' ', (string)($s ?? ''));
        return trim(preg_replace('/\s+/', ' ', $s));
    }

    private static function isoDate($s): string
    {
        return preg_match('/^\d{4}-\d{2}-\d{2}/', (string)$s, $m) ? $m[0] : '';
    }

    private static function rfc822($s): string
    {
        $iso = self::isoDate($s);
        if (!$iso) return '';
        $t = strtotime($iso . 'T00:00:00Z');
        return $t ? gmdate('D, d M Y H:i:s', $t) . ' GMT' : '';
    }

    private static function articleUrl($id): string { return self::BASE . '/article.html?id=' . $id; }

    public static function buildSitemap(array $articles, array $aip, string $today): string
    {
        $lines = [];
        $lines[] = '<?xml version="1.0" encoding="UTF-8"?>';
        $lines[] = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
        $lines[] = '  <!-- Static Pages -->';
        foreach (self::$STATIC_PAGES as [$loc, $cf, $pr]) {
            $lines[] = '  <url><loc>' . self::xmlEscape(self::BASE . $loc) . "</loc><lastmod>$today</lastmod><changefreq>$cf</changefreq><priority>$pr</priority></url>";
        }
        $lines[] = '  <!-- Published Articles -->';
        foreach ($articles as $a) {
            if (empty($a['id'])) continue;
            $lastmod = self::isoDate($a['published'] ?? '') ?: $today;
            $lines[] = '  <url><loc>' . self::xmlEscape(self::articleUrl($a['id'])) . "</loc><lastmod>$lastmod</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>";
        }
        if ($aip) {
            $lines[] = '  <!-- Articles in Press -->';
            foreach ($aip as $a) {
                if (empty($a['id'])) continue;
                $lastmod = self::isoDate($a['publishedOnline'] ?? '') ?: (self::isoDate($a['published'] ?? '') ?: $today);
                $lines[] = '  <url><loc>' . self::xmlEscape(self::articleUrl($a['id'])) . "</loc><lastmod>$lastmod</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>";
            }
        }
        $lines[] = '</urlset>';
        return implode("\n", $lines) . "\n";
    }

    public static function buildRss(array $articles, string $buildDateRfc): string
    {
        $sorted = array_values(array_filter($articles, fn($a) => !empty($a['id']) && !empty($a['title'])));
        usort($sorted, fn($a, $b) => strcmp((string)($b['published'] ?? ''), (string)($a['published'] ?? '')));
        $sorted = array_slice($sorted, 0, self::FEED_MAX);

        $items = [];
        foreach ($sorted as $a) {
            $link = self::articleUrl($a['id']);
            $guid = !empty($a['doi']) ? 'https://doi.org/' . $a['doi'] : $link;
            $desc = mb_substr(self::stripHtml($a['abstractHtml'] ?? ($a['abstract'] ?? ($a['previewText'] ?? ''))), 0, 600);
            $authors = implode(', ', array_filter(array_map(fn($x) => $x['name'] ?? null, $a['authors'] ?? [])));
            $pub = self::rfc822($a['published'] ?? '');
            $p = [];
            $p[] = '    <item>';
            $p[] = '      <title>' . self::xmlEscape($a['title']) . '</title>';
            $p[] = '      <link>' . self::xmlEscape($link) . '</link>';
            $p[] = '      <guid isPermaLink="' . (!empty($a['doi']) ? 'false' : 'true') . '">' . self::xmlEscape($guid) . '</guid>';
            if ($pub) $p[] = "      <pubDate>$pub</pubDate>";
            if (!empty($a['doi'])) $p[] = '      <dc:identifier>doi:' . self::xmlEscape($a['doi']) . '</dc:identifier>';
            if ($authors) $p[] = '      <dc:creator>' . self::xmlEscape($authors) . '</dc:creator>';
            if (!empty($a['type'])) $p[] = '      <category>' . self::xmlEscape($a['type']) . '</category>';
            $p[] = '      <description>' . self::xmlEscape($desc) . '</description>';
            $p[] = '    </item>';
            $items[] = implode("\n", $p);
        }

        $out = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
            '  <channel>',
            '    <title>Balkan Medical Journal</title>',
            '    <link>' . self::BASE . '/</link>',
            '    <description>Balkan Medical Journal — latest published articles</description>',
            '    <language>en</language>',
            '    <atom:link href="' . self::BASE . '/rss.xml" rel="self" type="application/rss+xml" />',
            $buildDateRfc ? "    <lastBuildDate>$buildDateRfc</lastBuildDate>" : '',
            implode("\n", $items),
            '  </channel>',
            '</rss>',
            '',
        ];
        return implode("\n", array_filter($out, fn($l) => $l !== ''));
    }

    /** Regenerate both files from the given data. */
    public static function regenerate(array $articles, array $aip): array
    {
        $root = \Config::projectRoot();
        $today = gmdate('Y-m-d');
        $buildDateRfc = gmdate('D, d M Y H:i:s') . ' GMT';
        JsFile::atomicPut($root . '/sitemap.xml', self::buildSitemap($articles, $aip, $today));
        JsFile::atomicPut($root . '/rss.xml', self::buildRss($articles, $buildDateRfc));
        return ['articles' => count($articles), 'aip' => count($aip)];
    }
}
