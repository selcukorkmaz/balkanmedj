<?php
/**
 * Inject nav/footer HTML into all public pages. PHP port of admin/lib/html-sync.js.
 * nav/footer model lives in the `nav_footer` singleton.
 */
class HtmlSync
{
    private const BUILTIN_HTML_FILES = [
        'index.html', 'about.html', 'editorial-board.html', 'current-issue.html',
        'articles-in-press.html', 'archive.html', 'article.html', 'for-authors.html',
        'for-reviewers.html', 'policies.html', 'news.html', 'news-article.html',
        'contact.html', 'forms.html', 'journal-metrics.html', 'search-results.html',
    ];

    /** Built-in pages plus any custom page files (from the pages table). */
    public static function allHtmlFiles(): array
    {
        $files = self::BUILTIN_HTML_FILES;
        foreach (\Db::all('SELECT slug, data FROM pages') as $r) {
            $d = $r['data'] ? json_decode($r['data'], true) : [];
            $f = $d['file'] ?? ($r['slug'] . '.html');
            if (!in_array($f, $files, true)) $files[] = $f;
        }
        return $files;
    }

    public static function bootstrapNavFooterData(): array
    {
        $data = NavFooterTemplate::buildNavFooterData(NavFooterTemplate::defaultModel());
        \Repo\Store::put('nav_footer', $data);
        return $data;
    }

    public static function syncAllPages(): array
    {
        $data = \Repo\Store::get('nav_footer', null);
        if (!is_array($data) || empty($data['navHtml'])) $data = self::bootstrapNavFooterData();
        $root = \Config::projectRoot();
        $results = [];
        $navRe = '/<nav\s[^>]*class="[^"]*bg-white[^"]*border-b[^"]*"[^>]*>.*?<\/nav>/s';
        $footerRe = '/<footer\s[^>]*class="[^"]*bg-teal-900[^"]*"[^>]*>.*?<\/footer>/s';

        foreach (self::allHtmlFiles() as $file) {
            $path = "$root/$file";
            if (!is_file($path)) { $results[] = ['file' => $file, 'status' => 'skipped', 'reason' => 'file not found']; continue; }
            $original = (string)file_get_contents($path);
            $html = $original;
            if (!empty($data['navHtml']) && preg_match($navRe, $html)) {
                $html = preg_replace($navRe, self::replSafe($data['navHtml']), $html, 1);
            }
            if (!empty($data['footerHtml']) && preg_match($footerRe, $html)) {
                $html = preg_replace($footerRe, self::replSafe($data['footerHtml']), $html, 1);
            }
            if ($html !== $original) {
                \JsFile::atomicPut($path, $html);
                $results[] = ['file' => $file, 'status' => 'updated'];
            } else {
                $results[] = ['file' => $file, 'status' => 'unchanged'];
            }
        }
        return ['syncedAt' => gmdate('c'), 'results' => $results];
    }

    private static function replSafe(string $s): string
    {
        return str_replace(['\\', '$'], ['\\\\', '\\$'], $s);
    }
}
