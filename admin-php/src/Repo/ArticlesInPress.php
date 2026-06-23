<?php
namespace Repo;

/**
 * Articles in Press — separate ordered list (sort_order). Stored one row each;
 * exported to js/data/articles-in-press.js.
 */
class ArticlesInPress
{
    public static function all(): array
    {
        $rows = \Db::all('SELECT data FROM articles_in_press ORDER BY sort_order, id');
        return array_map(fn($r) => json_decode($r['data'], true), $rows);
    }

    public static function find($id): ?array
    {
        $raw = \Db::scalar('SELECT data FROM articles_in_press WHERE id = ?', [(int)$id]);
        return $raw ? json_decode($raw, true) : null;
    }

    /** Replace the whole list (parity with rewriting the JS array), then export. */
    public static function save(array $aip): void
    {
        $aip = array_values($aip);
        $pdo = \Db::pdo();
        $pdo->beginTransaction();
        $pdo->exec('DELETE FROM articles_in_press');
        $stmt = $pdo->prepare('INSERT INTO articles_in_press (id, sort_order, data) VALUES (?,?,?)');
        foreach ($aip as $i => $a) {
            $stmt->execute([(int)$a['id'], $i, json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
        }
        $pdo->commit();

        \Site::writeArticlesInPress($aip);
        try { \Export\Seo::regenerate(Articles::all(), $aip); } catch (\Throwable $e) { /* best-effort */ }
    }

    private static function indexOf(array $aip, $id): int
    {
        foreach ($aip as $i => $a) if ((int)($a['id'] ?? 0) === (int)$id) return $i;
        return -1;
    }

    private static function assertDoiUnique(array $aip, string $doi, $excludeId = null): void
    {
        if ($doi === '') return;
        $lower = strtolower($doi);
        foreach ($aip as $a) {
            if ($excludeId !== null && (int)$a['id'] === (int)$excludeId) continue;
            if (strtolower(trim((string)($a['doi'] ?? ''))) === $lower) {
                throw new \HttpError("Bu DOI baskıda makalede zaten kayıtlı (#{$a['id']})", 409);
            }
        }
        foreach (Articles::all() as $a) {
            if (strtolower(trim((string)($a['doi'] ?? ''))) === $lower) {
                throw new \HttpError("Bu DOI yayınlanmış makalede zaten kayıtlı (#{$a['id']})", 409);
            }
        }
    }

    /** Parse a Galenos-style .docx → AIP form metadata + full text. */
    public static function handleParseDocx(): void
    {
        $f = \Upload::single('file', 'docx');
        try {
            $meta = \Import\DocxParser::parseAipDocx($f['tmp']);
        } finally {
            @unlink($f['tmp']);
        }
        \Http::json($meta);
    }

    // --- handlers -------------------------------------------------------------
    public static function handleList(): void { \Http::json(self::all()); }

    public static function handleGet(array $p): void
    {
        $a = self::find($p['id']);
        if (!$a) \Http::error('Not found', 404);
        \Http::json($a);
    }

    /**
     * Read full text only when the requested id belongs to an AIP record that
     * explicitly has full text. This prevents an orphan DB/file entry with a
     * reused numeric id from leaking another article's body into the editor.
     */
    public static function handleGetFullText(array $p): void
    {
        $id = (int)$p['id'];
        $a = self::find($id);
        if (!$a) \Http::error('Not found', 404);

        $html = '';
        if (!empty($a['hasFullText'])) {
            $raw = \Db::scalar('SELECT html FROM article_fulltext WHERE article_id = ?', [$id]);
            if ($raw === null) $raw = \Site::readFullText($id);
            $html = (string)($raw ?? '');
        }
        \Http::json(['id' => $id, 'html' => $html, 'hasFullText' => !empty($a['hasFullText'])]);
    }

    /**
     * Save AIP full text and update only the matching AIP record's visibility
     * flag. Published-article metadata must not be changed through this route.
     */
    public static function handlePutFullText(array $p): void
    {
        \Backup::snapshot();
        $id = (int)$p['id'];
        $aip = self::all();
        $idx = self::indexOf($aip, $id);
        if ($idx === -1) \Http::error('Not found', 404);

        $html = (string)(\Http::body()['html'] ?? '');
        \Db::run(
            'INSERT INTO article_fulltext (article_id, html) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE html = VALUES(html)',
            [$id, $html]
        );
        \Site::writeFullText($id, $html);

        $aip[$idx]['hasFullText'] = trim($html) !== '';
        self::save($aip);
        \Http::json(['id' => $id, 'saved' => true, 'hasFullText' => $aip[$idx]['hasFullText']]);
    }

    public static function handleCreate(): void
    {
        \Backup::snapshot();
        $aip = self::all();
        $body = Articles::normalizeDateFields(\Http::body());
        $title = trim((string)($body['title'] ?? ''));
        $type = trim((string)($body['type'] ?? ''));
        if ($title === '') \Http::error('Başlık zorunludur', 400);
        if ($type === '') \Http::error('Makale türü zorunludur', 400);
        $doi = trim((string)($body['doi'] ?? ''));
        self::assertDoiUnique($aip, $doi);

        $newId = Articles::nextId();
        $wiped = \Site::cleanArticleAssets($newId, true, true);
        $defaults = ['id' => $newId, 'order' => count($aip) + 1, 'aheadOfPrint' => true,
                     'volume' => null, 'issue' => '', 'pages' => '', 'published' => ''];
        $newArt = array_merge($defaults, $body, ['title' => $title, 'type' => $type, 'doi' => $doi]);
        Articles::validateDateOrder($newArt);
        $aip[] = $newArt;
        self::save($aip);
        \Http::json($newArt + ['_cleanedOrphans' => $wiped], 201);
    }

    public static function handleUpdate(array $p): void
    {
        \Backup::snapshot();
        $aip = self::all();
        $idx = self::indexOf($aip, $p['id']);
        if ($idx === -1) \Http::error('Not found', 404);

        $raw = \Http::body();
        if (array_key_exists('title', $raw) && trim((string)$raw['title']) === '') \Http::error('Başlık boş olamaz', 400);
        if (array_key_exists('type', $raw) && trim((string)$raw['type']) === '') \Http::error('Makale türü boş olamaz', 400);
        if (array_key_exists('doi', $raw)) self::assertDoiUnique($aip, trim((string)$raw['doi']), $aip[$idx]['id']);

        $body = Articles::normalizeDateFields($raw);
        $aip[$idx] = array_merge($aip[$idx], $body, ['id' => $aip[$idx]['id']]);
        Articles::validateDateOrder($aip[$idx]);
        self::save($aip);
        \Http::json($aip[$idx]);
    }

    public static function handleReorder(): void
    {
        \Backup::snapshot();
        $ids = \Http::body()['ids'] ?? null;
        if (!is_array($ids)) \Http::error('ids array required', 400);
        $aip = self::all();
        $byId = [];
        foreach ($aip as $a) $byId[(int)$a['id']] = $a;
        $reordered = [];
        foreach ($ids as $id) if (isset($byId[(int)$id])) $reordered[] = $byId[(int)$id];
        $idSet = array_flip(array_map('intval', $ids));
        foreach ($aip as $a) if (!isset($idSet[(int)$a['id']])) $reordered[] = $a;
        foreach ($reordered as $i => &$a) $a['order'] = $i + 1;
        unset($a);
        self::save($reordered);
        \Http::json(['ok' => true, 'count' => count($reordered)]);
    }

    public static function handleDelete(array $p): void
    {
        \Backup::snapshot();
        $aip = self::all();
        $idx = self::indexOf($aip, $p['id']);
        if ($idx === -1) \Http::error('Not found', 404);
        array_splice($aip, $idx, 1);
        self::save($aip);
        $wiped = \Site::cleanArticleAssets($p['id'], true, true);
        \Http::json(['deleted' => true, '_cleanedOrphans' => $wiped]);
    }

    /** Move one AIP record into published articles. */
    public static function handlePublish(array $p): void
    {
        \Backup::snapshot();
        $aip = self::all();
        $idx = self::indexOf($aip, $p['id']);
        if ($idx === -1) \Http::error('Not found', 404);
        $b = \Http::body();
        if (empty($b['volume']) || empty($b['issue'])) \Http::error('volume and issue required', 400);

        $src = $aip[$idx];
        $article = array_merge($src, [
            '_aipBeforeIssue' => [
                'volume' => $src['volume'] ?? null, 'issue' => $src['issue'] ?? '',
                'pages' => $src['pages'] ?? '', 'published' => $src['published'] ?? '',
                'sourceIssueId' => $src['sourceIssueId'] ?? '',
            ],
            'volume' => (int)$b['volume'], 'issue' => (string)$b['issue'],
            'pages' => $b['pages'] ?? '', 'published' => $b['published'] ?? gmdate('Y-m-d'),
            'aheadOfPrint' => false,
        ]);
        array_splice($aip, $idx, 1);
        self::save($aip);

        $articles = Articles::all();
        array_unshift($articles, $article);
        if (!empty($article['featured'])) {
            Articles::enforceSingleFeaturedForIssue($articles, $article['volume'], $article['issue'], $article['id']);
        }
        Articles::save($articles);
        Articles::syncCurrentIssueHomepage($articles);
        $count = \Site::rebuildVolumeJson($article['volume'], $article['issue'], $articles);
        $archive = ArchiveIssues::read();
        ArchiveIssues::updateArticleCount($archive, $article['volume'], $article['issue'], $count);
        ArchiveIssues::write($archive);
        \Http::json($article);
    }

    /** Batch publish (POST /articles-in-press/publish). */
    public static function handlePublishBatch(): void
    {
        \Backup::snapshot();
        $b = \Http::body();
        $ids = $b['articleIds'] ?? null;
        if (!is_array($ids) || !$ids || empty($b['volume']) || empty($b['issue'])) {
            \Http::error('articleIds, volume, issue required', 400);
        }
        $vol = (int)$b['volume']; $iss = (string)$b['issue'];
        $publishedDate = $b['published'] ?? gmdate('Y-m-d');

        $aip = self::all();
        $articles = Articles::all();
        $moved = [];
        $preferred = null;
        foreach ($ids as $id) {
            $idx = self::indexOf($aip, $id);
            if ($idx === -1) continue;
            $art = $aip[$idx];
            array_splice($aip, $idx, 1);
            $art['_aipBeforeIssue'] = [
                'volume' => $art['volume'] ?? null, 'issue' => $art['issue'] ?? '',
                'pages' => $art['pages'] ?? '', 'published' => $art['published'] ?? '',
                'sourceIssueId' => $art['sourceIssueId'] ?? '',
            ];
            $art['volume'] = $vol; $art['issue'] = $iss;
            $art['pages'] = $art['pages'] ?? ($b['pages'] ?? '');
            $art['published'] = $art['published'] ?: $publishedDate;
            $art['aheadOfPrint'] = false;
            unset($art['order']);
            array_unshift($articles, $art);
            if (!empty($art['featured']) && $preferred === null) $preferred = $art['id'];
            $moved[] = $art['id'];
        }
        self::save($aip);
        Articles::enforceSingleFeaturedForIssue($articles, $vol, $iss, $preferred);
        Articles::save($articles);
        Articles::syncCurrentIssueHomepage($articles);
        $count = \Site::rebuildVolumeJson($vol, $iss, $articles);
        $archive = ArchiveIssues::read();
        ArchiveIssues::updateArticleCount($archive, $vol, $iss, $count);
        ArchiveIssues::write($archive);
        \Http::json(['moved' => $moved, 'count' => count($moved)]);
    }
}
