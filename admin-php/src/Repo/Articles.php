<?php
namespace Repo;

/**
 * Published articles — data access + the create/update/delete/move/fulltext
 * orchestration ported from admin/server.js. MySQL is the source of truth; every
 * mutation re-exports the static files the public site reads (articles.js,
 * article-index.js, affected per-volume json/js, sitemap/rss) — parity with the
 * Node writeArticles -> rebuildVolumeJson -> rebuildArticleIndex chain.
 */
class Articles
{
    private const DATE_FIELDS = ['received', 'accepted', 'publishedOnline', 'published'];

    // --- Read -----------------------------------------------------------------
    public static function all(): array
    {
        $rows = \Db::all('SELECT data FROM articles ORDER BY seq, id');
        return array_map(fn($r) => json_decode($r['data'], true), $rows);
    }

    public static function find($id): ?array
    {
        $raw = \Db::scalar('SELECT data FROM articles WHERE id = ?', [(int)$id]);
        return $raw ? json_decode($raw, true) : null;
    }

    // --- Write (full replace + export) ---------------------------------------
    public static function save(array $articles): void
    {
        $articles = \Site::normalizeFeaturedArticles(array_values($articles));

        $pdo = \Db::pdo();
        $pdo->beginTransaction();
        $pdo->exec('DELETE FROM articles');
        $stmt = $pdo->prepare(
            'INSERT INTO articles (id, seq, type, volume, issue, featured, image_corner, citations, downloads, published, data)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)'
        );
        foreach ($articles as $seq => $a) {
            $stmt->execute([
                (int)$a['id'], $seq, $a['type'] ?? null,
                self::asInt($a['volume'] ?? null),
                isset($a['issue']) ? (string)$a['issue'] : null,
                !empty($a['featured']) ? 1 : 0,
                !empty($a['imageCorner']) ? 1 : 0,
                (int)($a['citations'] ?? 0),
                (int)($a['downloads'] ?? 0),
                self::toDate($a['published'] ?? ''),
                json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]);
        }
        $pdo->commit();

        \Site::writeArticles($articles);
        try { \Export\Seo::regenerate($articles, ArticlesInPress::all()); } catch (\Throwable $e) { /* best-effort */ }
    }

    public static function nextId(array $articles = null): int
    {
        $articles = $articles ?? self::all();
        $max = 0;
        foreach ($articles as $a) $max = max($max, (int)($a['id'] ?? 0));
        foreach (ArticlesInPress::all() as $a) $max = max($max, (int)($a['id'] ?? 0));
        return $max + 1;
    }

    // --- Date helpers (parity with normalizeArticleDateFields/validateOrder) --
    public static function normalizeDateFields(array $input): array
    {
        $data = $input;
        foreach (self::DATE_FIELDS as $field) {
            if (!array_key_exists($field, $data)) continue;
            $raw = trim((string)$data[$field]);
            if ($raw === '') { $data[$field] = ''; continue; }
            $norm = \Dates::parse($raw);
            if (!$norm) throw new \HttpError("$field alanında geçersiz tarih: $raw", 400);
            $data[$field] = $norm;
        }
        return $data;
    }

    public static function validateDateOrder(array $d): void
    {
        $t = fn($f) => !empty($d[$f]) ? strtotime($d[$f] . 'T00:00:00Z') : 0;
        $received = $t('received'); $accepted = $t('accepted');
        $online = $t('publishedOnline'); $published = $t('published');
        if ($received && $accepted && $accepted < $received) throw new \HttpError('Kabul tarihi, alındığı tarihten önce olamaz', 400);
        if ($accepted && $online && $online < $accepted) throw new \HttpError('Çevrimiçi yayın tarihi, kabul tarihinden önce olamaz', 400);
        if ($accepted && $published && $published < $accepted) throw new \HttpError('Makale yayın tarihi, kabul tarihinden önce olamaz', 400);
    }

    // --- Featured enforcement -------------------------------------------------
    public static function enforceSingleFeaturedForIssue(array &$articles, $volume, $issue, $preferredId = null): ?array
    {
        $candidates = [];
        foreach ($articles as $i => $a) {
            if (!empty($a['featured']) && (string)($a['volume'] ?? '') === (string)$volume && (string)($a['issue'] ?? '') === (string)$issue) {
                $candidates[] = $i;
            }
        }
        if (!$candidates) return null;
        $selectedIdx = $candidates[0];
        if ($preferredId !== null) {
            foreach ($candidates as $i) {
                if ((string)$articles[$i]['id'] === (string)$preferredId) { $selectedIdx = $i; break; }
            }
        }
        foreach ($candidates as $i) {
            $articles[$i]['featured'] = ($i === $selectedIdx);
        }
        return $articles[$selectedIdx];
    }

    private static function enforceSingleFeatured(array &$articles, array $selected): void
    {
        if (empty($selected['featured']) || empty($selected['volume']) || empty($selected['issue'])) return;
        self::enforceSingleFeaturedForIssue($articles, $selected['volume'], $selected['issue'], $selected['id']);
    }

    // --- Homepage sync (current issue) ---------------------------------------
    private static function homepageSummary(array $a): array
    {
        return [
            'id' => $a['id'] ?? null,
            'type' => $a['type'] ?? null,
            'title' => $a['title'] ?? null,
            'authors' => array_map(fn($au) => ['name' => is_array($au) ? ($au['name'] ?? '') : (string)$au], $a['authors'] ?? []),
            'doi' => $a['doi'] ?? null,
            'volume' => $a['volume'] ?? null,
            'issue' => $a['issue'] ?? null,
            'pages' => $a['pages'] ?? null,
            'published' => $a['published'] ?? null,
            'previewText' => $a['previewText'] ?? '',
            'imageUrl' => $a['imageUrl'] ?? '',
        ];
    }

    public static function syncCurrentIssueHomepage(array $articles): void
    {
        $home = Homepage::read();
        $current = $home['currentIssue'] ?? [];
        $volume = (string)($current['volume'] ?? '');
        $issue = (string)($current['issue'] ?? '');
        if ($volume === '' || $issue === '') return;

        self::enforceSingleFeaturedForIssue($articles, $volume, $issue);

        $issueArticles = array_values(array_filter($articles, fn($a) =>
            (string)($a['volume'] ?? '') === $volume && (string)($a['issue'] ?? '') === $issue
        ));
        $featured = array_values(array_filter($issueArticles, fn($a) => !empty($a['featured'])));
        $imageCorner = array_values(array_filter($issueArticles, fn($a) => !empty($a['imageCorner'])));
        $mostCited = $issueArticles;
        usort($mostCited, fn($a, $b) => (int)($b['citations'] ?? 0) <=> (int)($a['citations'] ?? 0));
        $mostCited = array_slice($mostCited, 0, 5);

        Homepage::write(array_merge($home, [
            'generatedAt' => gmdate('Y-m-d'),
            'featuredArticles' => array_map([self::class, 'homepageSummary'], $featured),
            'imageCornerArticles' => array_map([self::class, 'homepageSummary'], $imageCorner),
            'mostCitedArticles' => array_map([self::class, 'homepageSummary'], $mostCited),
            'latestArticles' => array_map([self::class, 'homepageSummary'], array_slice($issueArticles, 0, 10)),
        ]));
    }

    // ==========================================================================
    //  Route handlers
    // ==========================================================================
    public static function handleList(): void
    {
        $articles = self::all();
        $q = $_GET;
        if (!empty($q['type']))   $articles = array_filter($articles, fn($a) => ($a['type'] ?? '') === $q['type']);
        if (isset($q['volume']) && $q['volume'] !== '') $articles = array_filter($articles, fn($a) => (int)($a['volume'] ?? 0) === (int)$q['volume']);
        if (isset($q['issue']) && $q['issue'] !== '')   $articles = array_filter($articles, fn($a) => (string)($a['issue'] ?? '') === (string)$q['issue']);
        if (!empty($q['search'])) {
            $s = mb_strtolower($q['search']);
            $articles = array_filter($articles, function ($a) use ($s) {
                if (mb_strpos(mb_strtolower($a['title'] ?? ''), $s) !== false) return true;
                if (mb_strpos(mb_strtolower($a['doi'] ?? ''), $s) !== false) return true;
                foreach ($a['authors'] ?? [] as $au) {
                    if (mb_strpos(mb_strtolower($au['name'] ?? ''), $s) !== false) return true;
                }
                return false;
            });
        }
        $articles = array_values($articles);
        $total = count($articles);
        $p = max(1, (int)($q['page'] ?? 1));
        $l = min(200, max(1, (int)($q['limit'] ?? 50)));
        $paged = array_slice($articles, ($p - 1) * $l, $l);
        \Http::json(['total' => $total, 'page' => $p, 'limit' => $l, 'articles' => $paged]);
    }

    public static function handleGet(array $p): void
    {
        $a = self::find($p['id']);
        if (!$a) \Http::error('Article not found', 404);
        \Http::json($a);
    }

    public static function handleCreate(): void
    {
        \Backup::snapshot();
        $articles = self::all();
        $body = self::normalizeDateFields(\Http::body());
        $defaults = [
            'id' => self::nextId($articles), 'type' => '', 'title' => '', 'authors' => [],
            'abstract' => '', 'abstractHtml' => '', 'previewText' => '', 'keywords' => [],
            'doi' => '', 'received' => '', 'accepted' => '', 'published' => '',
            'volume' => null, 'issue' => '', 'pages' => '', 'views' => 0, 'downloads' => 0,
            'citations' => 0, 'featured' => false, 'imageCorner' => false, 'hasFullText' => false,
            'sourceIssueId' => '', 'sourceArticleId' => '', 'sourceAbstractUrl' => '',
            'sourceTextUrl' => '', 'sourcePdfUrl' => '', 'localPdfUrl' => '', 'pdfUrl' => '',
            'pmid' => '', 'relatedArticles' => [],
        ];
        $newArticle = array_merge($defaults, $body);
        self::validateDateOrder($newArticle);
        if (empty($newArticle['id'])) $newArticle['id'] = self::nextId($articles);

        // Wipe any orphan figures / full-text / PDF left at this id by a
        // previously deleted article, so a manually created article never
        // silently inherits an unrelated full-text body.
        \Site::cleanArticleAssets($newArticle['id'], true, true);
        \Site::clearFullText($newArticle['id']);

        array_unshift($articles, $newArticle);
        self::enforceSingleFeatured($articles, $newArticle);
        self::save($articles);
        self::syncCurrentIssueHomepage($articles);

        if (!empty($newArticle['volume']) && $newArticle['issue'] !== '') {
            \Site::rebuildVolumeJson($newArticle['volume'], $newArticle['issue'], $articles);
        }
        \Http::json($newArticle, 201);
    }

    public static function handleUpdate(array $p): void
    {
        \Backup::snapshot();
        $articles = self::all();
        $idx = self::indexOf($articles, $p['id']);
        if ($idx === -1) \Http::error('Article not found', 404);

        $old = $articles[$idx];
        $body = self::normalizeDateFields(\Http::body());
        $articles[$idx] = array_merge($old, $body, ['id' => $old['id']]);
        self::validateDateOrder($articles[$idx]);
        self::enforceSingleFeatured($articles, $articles[$idx]);
        self::save($articles);
        self::syncCurrentIssueHomepage($articles);

        $updated = $articles[$idx];
        if (!empty($updated['volume']) && $updated['issue'] !== '') {
            \Site::rebuildVolumeJson($updated['volume'], $updated['issue'], $articles);
        }
        if (!empty($old['volume']) && $old['issue'] !== '' &&
            ((string)$old['volume'] !== (string)$updated['volume'] || (string)$old['issue'] !== (string)$updated['issue'])) {
            \Site::rebuildVolumeJson($old['volume'], $old['issue'], $articles);
        }
        \Http::json($updated);
    }

    public static function handleDelete(array $p): void
    {
        \Backup::snapshot();
        $articles = self::all();
        $idx = self::indexOf($articles, $p['id']);
        if ($idx === -1) \Http::error('Article not found', 404);

        $removed = $articles[$idx];
        array_splice($articles, $idx, 1);
        self::save($articles);
        self::syncCurrentIssueHomepage($articles);
        if (!empty($removed['volume']) && $removed['issue'] !== '') {
            \Site::rebuildVolumeJson($removed['volume'], $removed['issue'], $articles);
        }
        \Http::json(['deleted' => true, 'id' => $removed['id']]);
    }

    public static function handleMove(): void
    {
        $body = \Http::body();
        $ids = $body['articleIds'] ?? null;
        if (!is_array($ids) || !$ids) \Http::error('articleIds gerekli', 400);
        if (!isset($body['targetVolume']) || empty($body['targetIssue'])) \Http::error('Hedef cilt ve sayı gerekli', 400);

        \Backup::snapshot();
        $articles = self::all();
        $vol = (int)$body['targetVolume'];
        $iss = (string)$body['targetIssue'];
        $rebuild = [];
        $preferred = null;
        $moved = 0;
        foreach ($ids as $id) {
            $idx = self::indexOf($articles, $id);
            if ($idx === -1) continue;
            $old = $articles[$idx];
            if (!empty($old['volume']) && !empty($old['issue'])) $rebuild["{$old['volume']}|{$old['issue']}"] = true;
            $articles[$idx]['volume'] = $vol;
            $articles[$idx]['issue'] = $iss;
            if (!empty($articles[$idx]['featured']) && $preferred === null) $preferred = $articles[$idx]['id'];
            $moved++;
        }
        $rebuild["$vol|$iss"] = true;
        self::enforceSingleFeaturedForIssue($articles, $vol, $iss, $preferred);
        self::save($articles);
        self::syncCurrentIssueHomepage($articles);
        foreach (array_keys($rebuild) as $key) {
            [$v, $i] = explode('|', $key);
            \Site::rebuildVolumeJson((int)$v, $i, $articles);
        }
        \Http::json(['moved' => $moved, 'targetVolume' => $vol, 'targetIssue' => $iss]);
    }

    // --- Full text ------------------------------------------------------------
    public static function handleGetFullText(array $p): void
    {
        $id = (int)$p['id'];
        $raw = \Db::scalar('SELECT html FROM article_fulltext WHERE article_id = ?', [$id]);
        if ($raw === null) $raw = \Site::readFullText($id); // fallback to file
        \Http::json(['id' => $id, 'html' => $raw ?? '']);
    }

    public static function handlePutFullText(array $p): void
    {
        \Backup::snapshot();
        $id = (int)$p['id'];
        $html = (string)(\Http::body()['html'] ?? '');
        \Db::run(
            'INSERT INTO article_fulltext (article_id, html) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE html = VALUES(html)',
            [$id, $html]
        );
        \Site::writeFullText($id, $html);

        // Mark hasFullText on whichever list holds this id.
        $articles = self::all();
        $idx = self::indexOf($articles, $id);
        if ($idx !== -1) {
            if (empty($articles[$idx]['hasFullText'])) {
                $articles[$idx]['hasFullText'] = true;
                self::save($articles);
            }
        } else {
            $aip = ArticlesInPress::all();
            foreach ($aip as $i => $a) {
                if ((int)$a['id'] === $id && empty($a['hasFullText'])) {
                    $aip[$i]['hasFullText'] = true;
                    ArticlesInPress::save($aip);
                    break;
                }
            }
        }
        \Http::json(['id' => $id, 'saved' => true]);
    }

    // --- Metrics --------------------------------------------------------------
    public static function handleMetrics(array $p): void
    {
        $articles = self::all();
        $idx = self::indexOf($articles, $p['id']);
        if ($idx === -1) \Http::error('Article not found', 404);
        $b = \Http::body();
        foreach (['views', 'downloads', 'citations'] as $f) {
            if (array_key_exists($f, $b) && $b[$f] !== null) $articles[$idx][$f] = max(0, (int)$b[$f]);
        }
        self::save($articles);
        \Http::json([
            'id' => $articles[$idx]['id'],
            'views' => $articles[$idx]['views'] ?? 0,
            'downloads' => $articles[$idx]['downloads'] ?? 0,
            'citations' => $articles[$idx]['citations'] ?? 0,
        ]);
    }

    // --- Related-article links (erratum/retraction/reply/comment) ------------
    private const REVERSE_LINK = [
        'erratum-for' => 'has-erratum', 'has-erratum' => 'erratum-for',
        'retraction-of' => 'is-retracted', 'is-retracted' => 'retraction-of',
        'reply-to' => 'has-reply', 'has-reply' => 'reply-to',
        'comment-on' => 'has-comment', 'has-comment' => 'comment-on',
        'related-to' => 'related-to',
    ];

    public static function handleAddLink(array $p): void
    {
        \Backup::snapshot();
        $articles = self::all();
        $id = (int)$p['id'];
        $sourceIdx = self::indexOf($articles, $id);
        if ($sourceIdx === -1) \Http::error('Source article not found', 404);
        $b = \Http::body();
        $type = $b['type'] ?? null;
        $targetId = $b['targetId'] ?? null;
        if (!$type || !$targetId) \Http::error('type and targetId required', 400);
        $targetIdx = self::indexOf($articles, $targetId);
        if ($targetIdx === -1) \Http::error('Target article not found', 404);

        if (empty($articles[$sourceIdx]['relatedArticles'])) $articles[$sourceIdx]['relatedArticles'] = [];
        $articles[$sourceIdx]['relatedArticles'][] = [
            'type' => $type, 'targetId' => (int)$targetId,
            'targetDoi' => $b['targetDoi'] ?? ($articles[$targetIdx]['doi'] ?? ''),
            'targetPmid' => $b['targetPmid'] ?? '',
            'label' => $b['label'] ?? ($articles[$targetIdx]['title'] ?? ''),
        ];

        if (empty($articles[$targetIdx]['relatedArticles'])) $articles[$targetIdx]['relatedArticles'] = [];
        $reverse = self::REVERSE_LINK[$type] ?? 'related-to';
        $already = false;
        foreach ($articles[$targetIdx]['relatedArticles'] as $r) {
            if ((int)($r['targetId'] ?? 0) === $id && ($r['type'] ?? '') === $reverse) { $already = true; break; }
        }
        if (!$already) {
            $articles[$targetIdx]['relatedArticles'][] = [
                'type' => $reverse, 'targetId' => $id,
                'targetDoi' => $articles[$sourceIdx]['doi'] ?? '', 'targetPmid' => '',
                'label' => $articles[$sourceIdx]['title'] ?? '',
            ];
        }
        self::save($articles);
        \Http::json(['source' => $articles[$sourceIdx], 'target' => $articles[$targetIdx]]);
    }

    public static function handleDeleteLink(array $p): void
    {
        \Backup::snapshot();
        $articles = self::all();
        $id = (int)$p['id'];
        $targetId = (int)$p['targetId'];
        $si = self::indexOf($articles, $id);
        $ti = self::indexOf($articles, $targetId);
        if ($si !== -1 && !empty($articles[$si]['relatedArticles'])) {
            $articles[$si]['relatedArticles'] = array_values(array_filter(
                $articles[$si]['relatedArticles'], fn($r) => (int)($r['targetId'] ?? 0) !== $targetId));
        }
        if ($ti !== -1 && !empty($articles[$ti]['relatedArticles'])) {
            $articles[$ti]['relatedArticles'] = array_values(array_filter(
                $articles[$ti]['relatedArticles'], fn($r) => (int)($r['targetId'] ?? 0) !== $id));
        }
        self::save($articles);
        \Http::json(['deleted' => true]);
    }

    /** Return a published article to Articles in Press (keeps id/files). */
    public static function handleReturnToInPress(array $p): void
    {
        \Backup::snapshot();
        $id = (int)$p['id'];
        $articles = self::all();
        $ai = self::indexOf($articles, $id);
        if ($ai === -1) \Http::error('Makale bulunamadı', 404);

        $aip = ArticlesInPress::all();
        foreach ($aip as $a) if ((int)$a['id'] === $id) \Http::error('Bu makale e-Pub Makaleler bölümünde zaten mevcut', 409);

        $article = $articles[$ai];
        array_splice($articles, $ai, 1);
        $doi = strtolower(trim((string)($article['doi'] ?? '')));
        if ($doi) foreach ($aip as $a) {
            if (strtolower(trim((string)($a['doi'] ?? ''))) === $doi) \Http::error('Aynı DOI ile başka bir e-Pub makale zaten mevcut', 409);
        }
        $oldVol = $article['volume'] ?? null;
        $oldIss = $article['issue'] ?? '';
        $prev = $article['_aipBeforeIssue'] ?? [];
        $article['volume'] = $prev['volume'] ?? null;
        $article['issue'] = $prev['issue'] ?? '';
        $article['pages'] = $prev['pages'] ?? '';
        $article['published'] = $prev['published'] ?? '';
        $article['sourceIssueId'] = $prev['sourceIssueId'] ?? '';
        $article['aheadOfPrint'] = true;
        $article['featured'] = false;
        $article['imageCorner'] = false;
        $article['order'] = count($aip) + 1;
        unset($article['_aipBeforeIssue']);
        $aip[] = $article;

        self::save($articles);
        ArticlesInPress::save($aip);
        self::syncCurrentIssueHomepage($articles);

        $remaining = 0;
        if ($oldVol && $oldIss) {
            $remaining = \Site::rebuildVolumeJson($oldVol, $oldIss, $articles);
            $archive = ArchiveIssues::read();
            ArchiveIssues::updateArticleCount($archive, $oldVol, $oldIss, $remaining);
            ArchiveIssues::write($archive);
        }
        \Http::json([
            'moved' => true, 'article' => $article,
            'previousIssue' => ($oldVol && $oldIss) ? ['volume' => $oldVol, 'issue' => (string)$oldIss] : null,
            'remainingCount' => $remaining,
        ]);
    }

    // --- small utils ----------------------------------------------------------
    private static function indexOf(array $articles, $id): int
    {
        foreach ($articles as $i => $a) if ((int)($a['id'] ?? 0) === (int)$id) return $i;
        return -1;
    }
    private static function asInt($v): ?int { return is_numeric($v) ? (int)$v : null; }
    private static function toDate($v): ?string
    {
        $s = trim((string)$v);
        if ($s === '') return null;
        return preg_match('/^\d{4}-\d{2}-\d{2}/', $s, $m) ? $m[0] : null;
    }
}
