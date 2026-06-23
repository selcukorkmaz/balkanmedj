<?php
namespace Repo;

/**
 * Homepage configuration singleton (currentIssue, featured/most-cited summaries,
 * popup, curated sections). Stored as one JSON row; exported to
 * js/data/homepage-articles.js.
 */
class Homepage
{
    public static function read(): array
    {
        $raw = \Db::scalar("SELECT data FROM singletons WHERE name = 'homepage'");
        $d = $raw ? json_decode($raw, true) : [];
        return is_array($d) ? $d : [];
    }

    public static function write(array $data): void
    {
        \Db::run(
            "INSERT INTO singletons (name, data) VALUES ('homepage', ?)
             ON DUPLICATE KEY UPDATE data = VALUES(data)",
            [json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]
        );
        \Site::writeHomepageData($data);
    }

    /** Merge editor-managed homepage config with freshly generated issue data. */
    public static function mergeIssueData(array $previous, array $generated): array
    {
        $sections = $previous['sections'] ?? [];
        $prevIssue = $previous['currentIssue'] ?? [];
        $genIssue = $generated['currentIssue'] ?? [];
        $issueChanged = (!empty($genIssue['volume']) || !empty($genIssue['issue'])) &&
            ((string)($prevIssue['volume'] ?? '') !== (string)($genIssue['volume'] ?? '') ||
             (string)($prevIssue['issue'] ?? '') !== (string)($genIssue['issue'] ?? ''));
        if ($issueChanged) $sections = array_merge($sections, ['latest-published' => []]);
        return array_merge($previous, $generated, ['sections' => $sections]);
    }

    // --- handlers -------------------------------------------------------------
    public static function handleGet(): void { \Http::json(self::read()); }

    public static function handlePut(): void
    {
        \Backup::snapshot();
        $home = \Http::body();
        if (array_key_exists('popup', $home)) {
            $home['popup'] = self::sanitizePopup($home['popup']);
        }
        self::write($home);
        \Http::json(['saved' => true]);
    }

    public static function handleGetPopup(): void
    {
        $home = self::read();
        $preserve = $home['popup']['updatedAt'] ?? '';
        \Http::json(self::sanitizePopup($home['popup'] ?? null, $preserve));
    }

    public static function handlePutPopup(): void
    {
        \Backup::snapshot();
        $home = self::read();
        $popup = self::sanitizePopup(\Http::body());
        $popup['updatedAt'] = gmdate('Y-m-d\TH:i:s.000\Z');
        $home['popup'] = $popup;
        self::write($home);
        \Http::json(['saved' => true, 'popup' => $popup]);
    }

    // --- popup sanitization (port of server.js sanitizeHomepagePopupConfig) ---
    private const POPUP_ITEM_TYPES = ['announcement', 'video', 'embed'];
    private const POPUP_FREQUENCIES = ['always', 'session', 'cooldown'];

    private static function clampInt($v, int $min, int $max, int $fallback): int
    {
        if (!is_numeric($v)) return $fallback;
        return max($min, min($max, (int)round((float)$v)));
    }

    private static function cleanStr($v, int $max = 2000): string
    {
        return mb_substr(trim((string)($v ?? '')), 0, $max);
    }

    private static function cleanMultiline($v, int $max = 12000): string
    {
        $s = str_replace(["\r\n", "\r"], "\n", (string)($v ?? ''));
        return mb_substr(trim($s), 0, $max);
    }

    private static function cleanEmbedUrl($v): string
    {
        $raw = self::cleanStr($v, 500);
        if ($raw === '') return '';
        $host = parse_url($raw, PHP_URL_HOST);
        if (!$host) return '';
        $host = strtolower(preg_replace('/^www\./i', '', $host));
        $allowed = ['youtu.be', 'youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'vimeo.com', 'player.vimeo.com'];
        return in_array($host, $allowed, true) ? $raw : '';
    }

    private static function sanitizeItem($item, int $index): array
    {
        $safe = is_array($item) ? $item : [];
        $type = in_array(trim((string)($safe['type'] ?? '')), self::POPUP_ITEM_TYPES, true)
            ? trim((string)$safe['type']) : 'announcement';
        return [
            'id' => self::cleanStr($safe['id'] ?? ('popup-item-' . (int)(microtime(true) * 1000) . '-' . ($index + 1)), 80),
            'active' => ($safe['active'] ?? null) !== false,
            'type' => $type,
            'badge' => self::cleanStr($safe['badge'] ?? '', 40),
            'title' => self::cleanStr($safe['title'] ?? '', 220),
            'body' => self::cleanMultiline($safe['body'] ?? '', 12000),
            'imageUrl' => self::cleanStr($safe['imageUrl'] ?? '', 500),
            'videoUrl' => self::cleanStr($safe['videoUrl'] ?? '', 500),
            'posterUrl' => self::cleanStr($safe['posterUrl'] ?? '', 500),
            'embedUrl' => self::cleanEmbedUrl($safe['embedUrl'] ?? ''),
            'buttonText' => self::cleanStr($safe['buttonText'] ?? '', 60),
            'buttonUrl' => self::cleanStr($safe['buttonUrl'] ?? '', 500),
            'openInNewTab' => ($safe['openInNewTab'] ?? null) !== false,
            'startsAt' => self::cleanStr($safe['startsAt'] ?? '', 40),
            'endsAt' => self::cleanStr($safe['endsAt'] ?? '', 40),
        ];
    }

    public static function sanitizePopup($input, string $preserveUpdatedAt = ''): array
    {
        $safe = is_array($input) ? $input : [];
        $frequency = in_array(trim((string)($safe['frequency'] ?? '')), self::POPUP_FREQUENCIES, true)
            ? trim((string)$safe['frequency']) : 'session';
        $items = [];
        if (!empty($safe['items']) && is_array($safe['items'])) {
            foreach (array_values($safe['items']) as $i => $it) {
                $item = self::sanitizeItem($it, $i);
                if ($item['title'] || $item['body'] || $item['imageUrl'] || $item['videoUrl'] || $item['embedUrl']) {
                    $items[] = $item;
                }
            }
            $items = array_slice($items, 0, 12);
        }
        return [
            'enabled' => !empty($safe['enabled']),
            'delayMs' => self::clampInt($safe['delayMs'] ?? null, 0, 10000, 700),
            'frequency' => $frequency,
            'dismissHours' => self::clampInt($safe['dismissHours'] ?? null, 1, 24 * 30, 24),
            'updatedAt' => self::cleanStr($safe['updatedAt'] ?? $preserveUpdatedAt, 80),
            'items' => $items,
        ];
    }

    // --- Discovery sections (Latest / In Press / Top Cited / ...) ------------
    private const SECTION_KEYS = ['latest-published', 'articles-in-press', 'top-cited', 'most-downloaded', 'image-corner', 'latest-news'];

    private static function slimNews(array $n): array
    {
        return [
            'id' => $n['id'] ?? null, 'title' => $n['title'] ?? '',
            'category' => $n['category'] ?? 'News', 'date' => $n['date'] ?? '',
            'excerpt' => mb_substr((string)($n['excerpt'] ?? ''), 0, 200),
        ];
    }

    private static function slimArticle(array $a): array
    {
        $authors = array_slice(array_values(array_filter(array_map(
            fn($x) => is_array($x) ? ($x['name'] ?? '') : (string)$x, $a['authors'] ?? []
        ), fn($s) => $s !== '')), 0, 5);
        return [
            'id' => $a['id'] ?? null, 'title' => $a['title'] ?? '', 'type' => $a['type'] ?? '',
            'authors' => $authors,
            'published' => $a['published'] ?? '', 'publishedOnline' => $a['publishedOnline'] ?? '',
            'publicationDate' => $a['publicationDate'] ?? '', 'onlineFirstDate' => $a['onlineFirstDate'] ?? '',
            'year' => $a['year'] ?? '', 'sourceIssueId' => $a['sourceIssueId'] ?? '',
            'volume' => $a['volume'] ?? '', 'issue' => $a['issue'] ?? '', 'pages' => $a['pages'] ?? '',
            'doi' => $a['doi'] ?? '', 'citations' => (int)($a['citations'] ?? 0),
            'downloads' => (int)($a['downloads'] ?? 0), 'views' => (int)($a['views'] ?? 0),
            'order' => isset($a['order']) ? (int)$a['order'] : null,
        ];
    }

    private static function ts(array $a): int
    {
        foreach (['published', 'publishedOnline', 'publicationDate', 'publishDate', 'onlineFirstDate', 'date'] as $f) {
            if (!empty($a[$f])) { $t = strtotime((string)$a[$f]); if ($t && $t > 0) return $t; }
        }
        $issueNo = (int)($a['issue'] ?? 0);
        $year = (int)($a['year'] ?? 0);
        if ($issueNo >= 1 && $issueNo <= 12 && $year > 1900) return (int)mktime(0, 0, 0, $issueNo, 1, $year);
        return 0;
    }

    private static function computeAuto(array $articles, array $aip, array $home): array
    {
        $cur = $home['currentIssue'] ?? [];
        $regular = array_values(array_filter($articles, fn($a) => trim((string)($a['type'] ?? '')) !== 'Cover Page'));
        $cutoff = (int)mktime(0, 0, 0, (int)date('n') - 24, 1, (int)date('Y'));
        $recent = array_values(array_filter($regular, fn($a) => self::ts($a) >= $cutoff && self::ts($a) > 0));

        $curSrc = (string)($cur['sourceIssueId'] ?? '');
        $curVol = (string)($cur['volume'] ?? '');
        $curIss = (string)($cur['issue'] ?? '');
        $latest = array_values(array_filter($regular, fn($a) => $curSrc
            ? (string)($a['sourceIssueId'] ?? '') === $curSrc
            : (string)($a['volume'] ?? '') === $curVol && (string)($a['issue'] ?? '') === $curIss));
        usort($latest, fn($a, $b) => (self::ts($b) <=> self::ts($a)) ?: ((int)($b['views'] ?? 0) <=> (int)($a['views'] ?? 0)));
        $latest = array_slice($latest, 0, 6);

        $inPress = $aip;
        usort($inPress, function ($a, $b) {
            $ao = (int)($a['order'] ?? 0); $bo = (int)($b['order'] ?? 0);
            if ($ao > 0 && $bo > 0 && $ao !== $bo) return $ao - $bo;
            if (($ao > 0) !== ($bo > 0)) return $ao > 0 ? -1 : 1;
            return 0;
        });
        $inPress = array_slice($inPress, 0, 6);

        $topCited = $recent;
        usort($topCited, fn($a, $b) => ((int)($b['citations'] ?? 0) <=> (int)($a['citations'] ?? 0)) ?: (self::ts($b) <=> self::ts($a)));
        $topCited = array_slice($topCited, 0, 6);

        $mostDl = $recent;
        usort($mostDl, fn($a, $b) => ((int)($b['downloads'] ?? 0) <=> (int)($a['downloads'] ?? 0)) ?: ((int)($b['views'] ?? 0) <=> (int)($a['views'] ?? 0)));
        $mostDl = array_slice($mostDl, 0, 6);

        $imageCorner = array_values(array_filter($recent, fn($a) => trim((string)($a['type'] ?? '')) === 'Clinical Image'));
        usort($imageCorner, fn($a, $b) => (int)($b['citations'] ?? 0) <=> (int)($a['citations'] ?? 0));
        $imageCorner = array_slice($imageCorner, 0, 2);

        return [
            'latest-published' => array_map([self::class, 'slimArticle'], $latest),
            'articles-in-press' => array_map([self::class, 'slimArticle'], $inPress),
            'top-cited' => array_map([self::class, 'slimArticle'], $topCited),
            'most-downloaded' => array_map([self::class, 'slimArticle'], $mostDl),
            'image-corner' => array_map([self::class, 'slimArticle'], $imageCorner),
        ];
    }

    private static function computeLatestNewsAuto(array $news): array
    {
        usort($news, function ($a, $b) {
            $da = strtotime((string)($a['date'] ?? '')); $db = strtotime((string)($b['date'] ?? ''));
            if ($da && $db && $da !== $db) return $db - $da;
            if ($da && !$db) return -1;
            if (!$da && $db) return 1;
            return (int)($b['id'] ?? 0) <=> (int)($a['id'] ?? 0);
        });
        return array_map([self::class, 'slimNews'], array_slice($news, 0, 3));
    }

    public static function handleGetSections(): void
    {
        $home = self::read();
        $articles = \Repo\Articles::all();
        $aip = \Repo\ArticlesInPress::all();
        $news = \Repo\News::all();
        $auto = self::computeAuto($articles, $aip, $home);
        $auto['latest-news'] = self::computeLatestNewsAuto($news);
        \Http::json([
            'sections' => $home['sections'] ?? new \stdClass(),
            'auto' => $auto,
            'candidates' => [
                'articles' => array_map([self::class, 'slimArticle'], array_values(array_filter($articles, fn($a) => trim((string)($a['type'] ?? '')) !== 'Cover Page'))),
                'aip' => array_map([self::class, 'slimArticle'], $aip),
                'news' => array_map([self::class, 'slimNews'], $news),
            ],
            'currentIssue' => $home['currentIssue'] ?? new \stdClass(),
        ]);
    }

    public static function handlePutSections(): void
    {
        \Backup::snapshot();
        $home = self::read();
        $incoming = \Http::body()['sections'] ?? [];
        $clean = [];
        foreach (self::SECTION_KEYS as $k) {
            if (isset($incoming[$k]) && is_array($incoming[$k])) {
                $clean[$k] = array_slice(array_values(array_filter($incoming[$k], fn($x) => $x !== null && $x !== '')), 0, 6);
            }
        }
        $home['sections'] = $clean;
        self::write($home);
        \Http::json(['saved' => true, 'sections' => $clean]);
    }
}
