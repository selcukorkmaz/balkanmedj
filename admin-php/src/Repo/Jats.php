<?php
namespace Repo;

use Import\JatsParser;
use Import\Util;

/** JATS XML parse + import endpoints. Port of admin/server.js /api/jats/*. */
class Jats
{
    public static function handleParse(): void
    {
        $f = \Upload::single('xml', 'xml');
        $xml = (string)file_get_contents($f['tmp']);
        @unlink($f['tmp']);
        \Http::json(JatsParser::parse($xml));
    }

    public static function handleParseBatch(): void
    {
        $files = \Upload::many('xml', 'xml');
        if (!$files) \Http::error('No XML files uploaded', 400);
        $results = [];
        foreach ($files as $f) {
            $xml = (string)file_get_contents($f['tmp']);
            @unlink($f['tmp']);
            try { $results[] = ['filename' => $f['name'], 'success' => true, 'article' => JatsParser::parse($xml)]; }
            catch (\Throwable $e) { $results[] = ['filename' => $f['name'], 'success' => false, 'error' => $e->getMessage()]; }
        }
        \Http::json(['results' => $results]);
    }

    public static function handleImport(): void
    {
        $lock = self::lock('jats:import');
        try {
            \Backup::snapshot();
            $b = \Http::body();
            $pa = $b['parsedArticle'] ?? null;
            if (!$pa) \Http::error('parsedArticle required', 400);

            $articles = Articles::all();
            $incomingDoi = Util::normalizeDoi($pa['doi'] ?? '');
            if ($incomingDoi) {
                foreach ($articles as $a) {
                    if (Util::normalizeDoi($a['doi'] ?? '') === $incomingDoi) {
                        \Http::json(['error' => "Bu DOI zaten yayınlanmış makalelerde mevcut: #{$a['id']} \"" . mb_substr($a['title'] ?? '', 0, 60) . '"', 'existingId' => $a['id']], 409);
                    }
                }
                foreach (ArticlesInPress::all() as $a) {
                    if (Util::normalizeDoi($a['doi'] ?? '') === $incomingDoi) {
                        \Http::json(['error' => "Bu DOI baskıda makalelerde mevcut: #{$a['id']} \"" . mb_substr($a['title'] ?? '', 0, 60) . '" — önce baskıdan yayına geçirin veya ZIP içe aktarımı kullanın', 'existingId' => $a['id']], 409);
                    }
                }
            }

            $id = Articles::nextId($articles);
            $ftHtml = $b['fullTextHtml'] ?? ($pa['fullTextHtml'] ?? '');
            $article = self::buildArticle($id, $pa, $ftHtml);

            array_unshift($articles, $article);
            Articles::save($articles);

            if ($ftHtml) {
                \Db::run('INSERT INTO article_fulltext (article_id, html) VALUES (?, ?) ON DUPLICATE KEY UPDATE html=VALUES(html)', [$id, $ftHtml]);
                \Site::writeFullText($id, $ftHtml);
            } else {
                // No full text in this import — drop any orphan left at this id.
                \Site::clearFullText($id);
            }
            if (!empty($pa['authorMetadata'])) {
                $all = Store::get('author_metadata', []);
                if (!is_array($all)) $all = [];
                $all[(string)$id] = $pa['authorMetadata'];
                Store::put('author_metadata', $all);
                \Site::writeAuthorMetadata($all);
            }
            if (!empty($article['volume']) && $article['issue'] !== '') {
                $archive = ArchiveIssues::read();
                self::ensureArchiveEntry($archive, $article['volume'], $article['issue'], $b['year'] ?? null, !empty($b['createIssue']));
                $count = \Site::rebuildVolumeJson($article['volume'], $article['issue'], $articles);
                ArchiveIssues::updateArticleCount($archive, $article['volume'], $article['issue'], $count);
                ArchiveIssues::write($archive);
            }
            if (!empty($article['relatedArticles'])) {
                self::handleRelatedLinks($articles, $article);
                Articles::save($articles);
            }
            \Http::json($article, 201);
        } finally {
            self::unlock($lock);
        }
    }

    public static function handleImportBatch(): void
    {
        $lock = self::lock('jats:import-batch');
        try {
            \Backup::snapshot();
            $b = \Http::body();
            $pas = $b['parsedArticles'] ?? null;
            if (!is_array($pas) || !$pas) \Http::error('parsedArticles array required', 400);
            $targetVolume = $b['targetVolume'] ?? null;
            $targetIssue = $b['targetIssue'] ?? null;

            $articles = Articles::all();
            $aipList = ArticlesInPress::all();
            $allMeta = Store::get('author_metadata', []);
            if (!is_array($allMeta)) $allMeta = [];
            $imported = []; $errors = []; $touched = []; $seen = []; $fullTexts = [];

            foreach ($pas as $pa) {
                try {
                    $doi = Util::normalizeDoi($pa['doi'] ?? '');
                    if ($doi) {
                        if (isset($seen[$doi])) { $errors[] = ['title' => $pa['title'] ?? '', 'error' => "Aynı DOI bu batch içinde birden fazla XML'de mevcut: {$pa['doi']}"]; continue; }
                        foreach ($articles as $a) if (Util::normalizeDoi($a['doi'] ?? '') === $doi) { $errors[] = ['title' => $pa['title'] ?? '', 'error' => "DOI zaten yayınlanmış makalelerde mevcut: {$pa['doi']}"]; continue 2; }
                        foreach ($aipList as $a) if (Util::normalizeDoi($a['doi'] ?? '') === $doi) { $errors[] = ['title' => $pa['title'] ?? '', 'error' => "DOI baskıda makalelerde mevcut: {$pa['doi']} — ZIP içe aktarımı promote eder, JATS batch etmez"]; continue 2; }
                        $seen[$doi] = true;
                    }
                    $id = Articles::nextId($articles);
                    $ft = $pa['fullTextHtml'] ?? '';
                    $article = self::buildArticle($id, $pa, $ft);
                    if ($targetVolume !== null) $article['volume'] = (int)$targetVolume;
                    if ($targetIssue !== null) $article['issue'] = (string)$targetIssue;
                    array_unshift($articles, $article);
                    if ($ft) $fullTexts[$id] = $ft; else \Site::clearFullText($id);
                    if (!empty($pa['authorMetadata'])) $allMeta[(string)$id] = $pa['authorMetadata'];
                    if (!empty($article['volume']) && $article['issue'] !== '') $touched["{$article['volume']}|{$article['issue']}"] = ['volume' => $article['volume'], 'issue' => (string)$article['issue']];
                    $imported[] = ['id' => $id, 'title' => $pa['title'] ?? '', 'doi' => $pa['doi'] ?? ''];
                } catch (\Throwable $e) { $errors[] = ['title' => $pa['title'] ?? '', 'error' => $e->getMessage()]; }
            }

            Articles::save($articles);
            foreach ($fullTexts as $fid => $html) {
                \Db::run('INSERT INTO article_fulltext (article_id, html) VALUES (?, ?) ON DUPLICATE KEY UPDATE html=VALUES(html)', [$fid, $html]);
                \Site::writeFullText($fid, $html);
            }
            if ($allMeta) { Store::put('author_metadata', $allMeta); \Site::writeAuthorMetadata($allMeta); }

            if ($touched) {
                $archive = ArchiveIssues::read();
                foreach ($touched as $ti) {
                    self::ensureArchiveEntry($archive, $ti['volume'], $ti['issue'], $b['year'] ?? null, !empty($b['createIssue']));
                    $count = \Site::rebuildVolumeJson($ti['volume'], $ti['issue'], $articles);
                    ArchiveIssues::updateArticleCount($archive, $ti['volume'], $ti['issue'], $count);
                }
                ArchiveIssues::write($archive);
            }

            $linked = false;
            foreach ($imported as $imp) {
                $idx = self::idxOf($articles, $imp['id']);
                if ($idx >= 0 && !empty($articles[$idx]['relatedArticles'])) { self::handleRelatedLinks($articles, $articles[$idx]); $linked = true; }
            }
            if ($linked) Articles::save($articles);

            \Http::json(['imported' => $imported, 'errors' => $errors, 'totalImported' => count($imported), 'totalErrors' => count($errors)], 201);
        } finally {
            self::unlock($lock);
        }
    }

    public static function handleImportInPress(): void
    {
        $lock = self::lock('jats:import-in-press');
        try {
            \Backup::snapshot();
            $b = \Http::body();
            $pas = $b['parsedArticles'] ?? null;
            if (!is_array($pas) || !$pas) \Http::error('parsedArticles array required', 400);

            $aip = ArticlesInPress::all();
            $main = Articles::all();
            $imported = []; $errors = []; $seen = []; $fullTexts = [];

            foreach ($pas as $pa) {
                try {
                    $doi = Util::normalizeDoi($pa['doi'] ?? '');
                    if ($doi) {
                        if (isset($seen[$doi])) { $errors[] = ['title' => $pa['title'] ?? '', 'error' => "Aynı DOI bu batch içinde birden fazla XML'de mevcut: {$pa['doi']}"]; continue; }
                        $dup = false;
                        foreach ($main as $a) if (Util::normalizeDoi($a['doi'] ?? '') === $doi) { $dup = true; break; }
                        if (!$dup) foreach ($aip as $a) if (Util::normalizeDoi($a['doi'] ?? '') === $doi) { $dup = true; break; }
                        if ($dup) { $errors[] = ['title' => $pa['title'] ?? '', 'error' => "DOI zaten mevcut: {$pa['doi']}"]; continue; }
                        $seen[$doi] = true;
                    }
                    $maxAll = array_merge($main, $aip);
                    $id = Articles::nextId($maxAll);
                    $ft = $pa['fullTextHtml'] ?? '';
                    $article = [
                        'id' => $id, 'type' => $pa['type'] ?? '', 'title' => $pa['title'] ?? '',
                        'authors' => $pa['authors'] ?? [], 'abstract' => $pa['abstract'] ?? '',
                        'abstractHtml' => $pa['abstractHtml'] ?? '', 'previewText' => $pa['previewText'] ?? '',
                        'keywords' => $pa['keywords'] ?? [], 'doi' => $pa['doi'] ?? '',
                        'received' => $pa['received'] ?? '', 'accepted' => $pa['accepted'] ?? '', 'published' => $pa['published'] ?? '',
                        'volume' => null, 'issue' => '', 'pages' => $pa['pages'] ?? '',
                        'pmid' => $pa['pmid'] ?? '', 'elocationId' => $pa['elocationId'] ?? '', 'hasFullText' => (bool)$ft,
                    ];
                    array_unshift($aip, $article);
                    if ($ft) $fullTexts[$id] = $ft; else \Site::clearFullText($id);
                    $imported[] = ['id' => $id, 'title' => $pa['title'] ?? '', 'doi' => $pa['doi'] ?? ''];
                } catch (\Throwable $e) { $errors[] = ['title' => $pa['title'] ?? '', 'error' => $e->getMessage()]; }
            }

            ArticlesInPress::save($aip);
            foreach ($fullTexts as $fid => $html) {
                \Db::run('INSERT INTO article_fulltext (article_id, html) VALUES (?, ?) ON DUPLICATE KEY UPDATE html=VALUES(html)', [$fid, $html]);
                \Site::writeFullText($fid, $html);
            }
            \Http::json(['imported' => $imported, 'errors' => $errors, 'totalImported' => count($imported)], 201);
        } finally {
            self::unlock($lock);
        }
    }

    private static function idxOf(array $arr, $id): int
    {
        foreach ($arr as $i => $a) if ((int)($a['id'] ?? 0) === (int)$id) return $i;
        return -1;
    }

    private static function buildArticle(int $id, array $pa, string $ftHtml): array
    {
        return [
            'id' => $id, 'type' => $pa['type'] ?? '', 'title' => $pa['title'] ?? '',
            'authors' => $pa['authors'] ?? [], 'abstract' => $pa['abstract'] ?? '',
            'abstractHtml' => $pa['abstractHtml'] ?? '', 'previewText' => $pa['previewText'] ?? '',
            'keywords' => $pa['keywords'] ?? [], 'doi' => $pa['doi'] ?? '',
            'received' => $pa['received'] ?? '', 'accepted' => $pa['accepted'] ?? '', 'published' => $pa['published'] ?? '',
            'volume' => $pa['volume'] ?? null, 'issue' => $pa['issue'] ?? '', 'pages' => $pa['pages'] ?? '',
            'views' => 0, 'downloads' => 0, 'citations' => 0, 'featured' => false, 'imageCorner' => false,
            'hasFullText' => (bool)($ftHtml ?: ($pa['fullTextHtml'] ?? '')),
            'sourceIssueId' => '', 'sourceArticleId' => '', 'sourceAbstractUrl' => '', 'sourceTextUrl' => '',
            'sourcePdfUrl' => '', 'localPdfUrl' => '', 'pdfUrl' => '',
            'pmid' => $pa['pmid'] ?? '', 'elocationId' => $pa['elocationId'] ?? '',
            'supplementary' => $pa['supplementary'] ?? [], 'funding' => $pa['funding'] ?? [],
            'permissions' => $pa['permissions'] ?? null, 'relatedArticles' => $pa['relatedArticles'] ?? [],
        ];
    }

    private static function ensureArchiveEntry(array &$archive, $volume, $issue, $year, bool $shouldCreate): void
    {
        if (ArchiveIssues::findIssue($archive, $volume, $issue)) return;
        if (!$shouldCreate) return;
        $vol = (int)$volume; $iss = (string)$issue;
        $yr = (string)($year ?: gmdate('Y'));
        $yi = null;
        foreach ($archive as $k => $y) if (($y['year'] ?? '') === $yr) { $yi = $k; break; }
        if ($yi === null) {
            array_unshift($archive, ['year' => $yr, 'volume' => $vol, 'issues' => []]);
            usort($archive, fn($a, $b) => (int)$b['year'] <=> (int)$a['year']);
            foreach ($archive as $k => $y) if (($y['year'] ?? '') === $yr) { $yi = $k; break; }
        }
        array_unshift($archive[$yi]['issues'], [
            'label' => "Volume {$vol}, Issue {$iss}", 'sourceId' => '', 'sourceUrl' => '',
            'volume' => $vol, 'issue' => $iss, 'articleCount' => 0, 'hasLocalData' => true,
        ]);
        $volPath = \Site::volumesDir() . "/vol{$vol}-{$iss}.json";
        if (!is_file($volPath)) \Site::rebuildVolumeJson($vol, $iss, []);
    }

    private static function handleRelatedLinks(array &$articles, array $source): void
    {
        $reverse = ['erratum-for' => 'has-erratum', 'retraction-of' => 'is-retracted', 'reply-to' => 'has-reply', 'comment-on' => 'has-comment', 'related-to' => 'related-to'];
        $find = function ($pred) use (&$articles) {
            foreach ($articles as $i => $a) if ($pred($a)) return $i;
            return -1;
        };
        foreach ($source['relatedArticles'] as $link) {
            $ti = -1;
            if (!empty($link['targetId'])) $ti = $find(fn($a) => (int)($a['id'] ?? 0) === (int)$link['targetId']);
            if ($ti === -1 && !empty($link['targetPmid'])) $ti = $find(fn($a) => ($a['pmid'] ?? '') === $link['targetPmid']);
            if ($ti === -1 && !empty($link['targetDoi'])) $ti = $find(fn($a) => ($a['doi'] ?? '') === $link['targetDoi']);
            if ($ti === -1 && !empty($link['targetVolume']) && !empty($link['targetPages'])) {
                $ti = $find(fn($a) => (int)($a['volume'] ?? 0) === (int)$link['targetVolume'] && !empty($a['pages']) && str_starts_with((string)$a['pages'], (string)$link['targetPages']));
            }
            if ($ti === -1) continue;
            if (empty($articles[$ti]['relatedArticles'])) $articles[$ti]['relatedArticles'] = [];
            $rt = $reverse[$link['type']] ?? 'related-to';
            $already = false;
            foreach ($articles[$ti]['relatedArticles'] as $r) {
                if ((int)($r['targetId'] ?? 0) === (int)$source['id'] && ($r['type'] ?? '') === $rt) { $already = true; break; }
            }
            if (!$already) {
                $articles[$ti]['relatedArticles'][] = ['type' => $rt, 'targetId' => $source['id'], 'targetDoi' => $source['doi'] ?? '', 'targetPmid' => '', 'label' => $source['title'] ?? ''];
            }
        }
    }

    // --- simple cross-request import lock (flock) ----------------------------
    private static function lock(string $label)
    {
        $fp = fopen(sys_get_temp_dir() . '/bmj-import.lock', 'c');
        if (!$fp || !flock($fp, LOCK_EX | LOCK_NB)) {
            if ($fp) fclose($fp);
            \Http::error("Başka bir içe aktarma devam ediyor: $label", 409);
        }
        return $fp;
    }
    private static function unlock($fp): void
    {
        if ($fp) { flock($fp, LOCK_UN); fclose($fp); }
    }
}
