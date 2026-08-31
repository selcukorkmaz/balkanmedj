<?php
/**
 * Static-file export layer — PHP port of admin/lib/data-io.js writers.
 * MySQL is the source of truth; these methods regenerate the exact files the
 * public static site reads (js/data/*.js, per-volume json/js, article fulltext,
 * article index). Pure filesystem I/O — no DB.
 */
class Site
{
    public static function dataDir(): string { return Config::projectRoot() . '/js/data'; }
    public static function volumesDir(): string { return self::dataDir() . '/volumes'; }
    public static function articlesDir(): string { return self::dataDir() . '/articles'; }

    // --- Featured normalization (one featured article per volume+issue) ------
    public static function normalizeFeaturedArticles(array $articles): array
    {
        $seen = [];
        foreach ($articles as &$a) {
            if (empty($a['featured']) || empty($a['volume']) || empty($a['issue'])) continue;
            $key = $a['volume'] . '|' . $a['issue'];
            if (isset($seen[$key])) $a['featured'] = false;
            else $seen[$key] = true;
        }
        unset($a);
        return $articles;
    }

    // --- Articles -------------------------------------------------------------
    public static function writeArticles(array $articles): void
    {
        $articles = self::normalizeFeaturedArticles($articles);
        JsFile::write(self::dataDir() . '/articles.js', 'ARTICLES', array_values($articles), 'Articles Data');
        self::rebuildArticleIndex($articles);
    }

    /** ID -> [volume, issue] index used by article.html to lazy-load a volume. */
    public static function rebuildArticleIndex(array $articles): void
    {
        $index = [];
        foreach ($articles as $a) {
            if (!empty($a['id']) && !empty($a['volume']) && !empty($a['issue'])) {
                $index[(string)$a['id']] = [$a['volume'], (string)$a['issue']];
            }
        }
        $json = json_encode($index, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        JsFile::atomicPut(self::dataDir() . '/article-index.js', 'window.ARTICLE_INDEX = ' . $json . ";\n");
    }

    public static function rebuildVolumeJson($volume, $issue, array $articles): int
    {
        $filtered = array_values(array_filter($articles, fn($a) =>
            (int)($a['volume'] ?? 0) === (int)$volume && (string)($a['issue'] ?? '') === (string)$issue
        ));
        JsFile::writeJson(self::volumesDir() . "/vol{$volume}-{$issue}.json", $filtered);
        self::writeVolumeJs($volume, $issue, $filtered);
        return count($filtered);
    }

    public static function writeVolumeJs($volume, $issue, array $data): void
    {
        $body = JsFile::encode(array_values($data));
        JsFile::atomicPut(self::volumesDir() . "/vol{$volume}-{$issue}.js", "window.PAGE_ARTICLES = {$body};\n");
    }

    // --- Article full text ----------------------------------------------------
    private static function safeArticleId($id): string
    {
        $s = preg_replace('/[^a-zA-Z0-9._-]/', '_', (string)$id);
        if ($s === '' || $s === '.' || $s === '..') throw new RuntimeException('Invalid articleId');
        return $s;
    }

    public static function readFullText($id): ?string
    {
        $sid = self::safeArticleId($id);
        $html = self::articlesDir() . "/{$sid}.html";
        if (is_file($html)) return (string)file_get_contents($html);
        return null;
    }

    public static function writeFullText($id, string $html): void
    {
        $sid = self::safeArticleId($id);
        JsFile::atomicPut(self::articlesDir() . "/{$sid}.html", $html);
        // file:// fallback companion: window._articleFullText[id] = "...";
        $escaped = str_replace(['\\', '"'], ['\\\\', '\\"'], $html);
        $escaped = str_replace(["\r\n", "\r", "\n"], ['\\n', '\\n', '\\n'], $escaped);
        $js = "window._articleFullText = window._articleFullText || {};\n" .
              "window._articleFullText[{$sid}] = \"{$escaped}\";\n";
        JsFile::atomicPut(self::articlesDir() . "/{$sid}.js", $js);
    }

    // --- Simple single-file writers (added as resources are ported) ----------
    public static function writeArticlesInPress(array $data): void
    {
        JsFile::write(self::dataDir() . '/articles-in-press.js', 'ARTICLES_IN_PRESS', array_values($data), 'Articles in Press');
    }

    public static function writeNews(array $data): void
    {
        JsFile::write(self::dataDir() . '/news.js', 'NEWS', array_values($data), 'News & Announcements');
    }

    public static function writeEditorialBoard($data): void
    {
        JsFile::write(self::dataDir() . '/editorial-board.js', 'EDITORIAL_BOARD', $data, 'Editorial Board');
    }

    public static function writeEditorialExtended($data): void
    {
        JsFile::write(self::dataDir() . '/editorial-extended.js', 'EDITORIAL_EXTENDED', $data, 'Editorial Extended');
    }

    public static function writeHomepageData($data): void
    {
        JsFile::write(self::dataDir() . '/homepage-articles.js', 'HOMEPAGE_DATA', $data, 'Homepage Data');
    }

    public static function writeArchiveIssues(array $data): void
    {
        JsFile::write(self::dataDir() . '/archive-issues.js', 'ARCHIVE_ISSUES', array_values($data), 'Archive Issues');
    }

    public static function writeAuthorMetadata($data): void
    {
        JsFile::write(self::dataDir() . '/author-metadata.js', 'AUTHOR_METADATA', $data, 'Author Metadata');
    }

    /**
     * Remove on-disk artefacts for an article id so a re-used id can't inherit
     * orphaned files. Port of zip-importer.js cleanArticleAssets.
     */
    public static function cleanArticleAssets($id, bool $wipePdf = false, bool $wipeFullText = false): array
    {
        $removed = ['figures' => [], 'supplementary' => [], 'pdf' => false, 'fullText' => false];
        $n = (int)$id;
        if ($n <= 0) return $removed;
        $root = Config::projectRoot();

        $unlinkDirFiles = function (string $dir, string $key) use (&$removed) {
            if (!is_dir($dir)) return;
            foreach (scandir($dir) as $f) {
                if ($f === '.' || $f === '..') continue;
                $p = "$dir/$f";
                if (is_file($p) && @unlink($p)) $removed[$key][] = $f;
            }
        };
        $unlinkDirFiles("$root/images/articles/$n", 'figures');
        $unlinkDirFiles(self::dataDir() . "/supplementary/$n", 'supplementary');

        if ($wipePdf) {
            $pdf = self::dataDir() . "/pdfs/$n.pdf";
            if (is_file($pdf) && @unlink($pdf)) $removed['pdf'] = true;
        }
        if ($wipeFullText) {
            foreach (['.html', '.js'] as $ext) {
                $ft = self::articlesDir() . "/$n$ext";
                if (is_file($ft) && @unlink($ft)) $removed['fullText'] = true;
            }
        }
        return $removed;
    }

    /**
     * Drop an article's full text everywhere it lives — the article_fulltext DB
     * row AND the on-disk static companions — so a freshly assigned / re-used id
     * can't inherit an unrelated body. Call this on import/create paths whenever
     * the incoming record carries no full text of its own.
     */
    public static function clearFullText($id): void
    {
        $n = (int)$id;
        if ($n <= 0) return;
        try { \Db::run('DELETE FROM article_fulltext WHERE article_id = ?', [$n]); } catch (\Throwable $e) { /* DB optional in static-only contexts */ }
        self::cleanArticleAssets($n, false, true);
    }
}
