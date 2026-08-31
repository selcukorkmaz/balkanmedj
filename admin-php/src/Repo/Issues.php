<?php
namespace Repo;

/**
 * Journal issues (the archive tree). Pure-data endpoints: list/create/rebuild/
 * articles/files(read)/set-current/delete. Issue PDF + cover uploads live in
 * Phase 4 (multipart/cover rendering).
 */
class Issues
{
    public static function handleList(): void { \Http::json(ArchiveIssues::read()); }

    public static function handleCreate(): void
    {
        \Backup::snapshot();
        $b = \Http::body();
        if (empty($b['year']) || empty($b['volume']) || empty($b['issue'])) \Http::error('year, volume, issue required', 400);
        $year = (string)$b['year']; $vol = (int)$b['volume']; $iss = (string)$b['issue'];

        $archive = ArchiveIssues::read();
        $yi = null;
        foreach ($archive as $k => $y) if (($y['year'] ?? '') === $year) { $yi = $k; break; }
        if ($yi === null) {
            array_unshift($archive, ['year' => $year, 'volume' => $vol, 'issues' => []]);
            usort($archive, fn($a, $c) => (int)$c['year'] <=> (int)$a['year']);
            foreach ($archive as $k => $y) if (($y['year'] ?? '') === $year) { $yi = $k; break; }
        }
        foreach ($archive[$yi]['issues'] as $i) {
            if ((string)($i['issue'] ?? '') === $iss) \Http::error('Issue already exists', 409);
        }
        $newIssue = [
            'label' => $b['label'] ?? "Volume {$vol}, Issue {$iss}",
            'sourceId' => '', 'sourceUrl' => '',
            'volume' => $vol, 'issue' => $iss, 'articleCount' => 0, 'hasLocalData' => true,
        ];
        array_unshift($archive[$yi]['issues'], $newIssue);
        ArchiveIssues::write($archive);
        \Site::rebuildVolumeJson($vol, $iss, Articles::all());
        \Http::json($newIssue, 201);
    }

    public static function handleRebuild(array $p): void
    {
        $vol = $p['volume']; $iss = $p['issue'];
        $count = \Site::rebuildVolumeJson($vol, $iss, Articles::all());
        $archive = ArchiveIssues::read();
        ArchiveIssues::updateArticleCount($archive, $vol, $iss, $count);
        ArchiveIssues::write($archive);
        \Http::json(['volume' => (int)$vol, 'issue' => $iss, 'articleCount' => $count]);
    }

    public static function handleGetArticles(array $p): void
    {
        $vol = (int)$p['volume']; $iss = (string)$p['issue'];
        $articles = array_values(array_filter(Articles::all(), fn($a) =>
            (int)($a['volume'] ?? 0) === $vol && (string)($a['issue'] ?? '') === $iss
        ));
        usort($articles, fn($a, $b) => ((int)$a['pages'] ?: 9999) <=> ((int)$b['pages'] ?: 9999));
        \Http::json($articles);
    }

    public static function handleGetFiles(array $p): void
    {
        $archive = ArchiveIssues::read();
        $rec = self::findRecord($archive, $p['volume'], $p['issue']);
        if (!$rec) \Http::error('Sayı bulunamadı', 404);
        \Http::json([
            'fullPdf'  => $rec['fullPdf']  ?? self::legacyPdf('full', $p['volume'], $p['issue']),
            'coverPdf' => $rec['coverPdf'] ?? self::legacyPdf('cover', $p['volume'], $p['issue']),
        ]);
    }

    public static function handleSetCurrent(array $p): void
    {
        \Backup::snapshot();
        $vol = (int)$p['volume']; $iss = (string)$p['issue'];
        $all = Articles::all();
        Articles::enforceSingleFeaturedForIssue($all, $vol, $iss);
        Articles::save($all);
        $articles = array_values(array_filter($all, fn($a) =>
            (int)($a['volume'] ?? 0) === $vol && (string)($a['issue'] ?? '') === $iss
        ));

        $archive = ArchiveIssues::read();
        $year = '';
        foreach ($archive as $y) foreach (($y['issues'] ?? []) as $i) {
            if ((int)($i['volume'] ?? 0) === $vol && (string)($i['issue'] ?? '') === $iss) { $year = $y['year']; break 2; }
        }

        $featured = array_slice(array_values(array_filter($articles, fn($a) => !empty($a['featured']))), 0, 1);
        $imageCorner = array_values(array_filter($articles, fn($a) => !empty($a['imageCorner'])));
        $mostCited = $articles;
        usort($mostCited, fn($a, $b) => (int)($b['citations'] ?? 0) <=> (int)($a['citations'] ?? 0));
        $mostCited = array_slice($mostCited, 0, 5);
        $map = fn($a) => [
            'id' => $a['id'] ?? null, 'type' => $a['type'] ?? null, 'title' => $a['title'] ?? null,
            'authors' => array_map(fn($au) => ['name' => is_array($au) ? ($au['name'] ?? '') : (string)$au], $a['authors'] ?? []),
            'doi' => $a['doi'] ?? null, 'volume' => $a['volume'] ?? null, 'issue' => $a['issue'] ?? null,
            'pages' => $a['pages'] ?? null, 'published' => $a['published'] ?? null,
            'previewText' => $a['previewText'] ?? '', 'imageUrl' => $a['imageUrl'] ?? '',
        ];

        $previous = Homepage::read();
        $homepage = Homepage::mergeIssueData($previous, [
            'generatedAt' => gmdate('Y-m-d'),
            'currentIssue' => ['volume' => $vol, 'issue' => $iss, 'year' => $year],
            'featuredArticles' => array_map($map, $featured),
            'imageCornerArticles' => array_map($map, $imageCorner),
            'mostCitedArticles' => array_map($map, $mostCited),
            'latestArticles' => array_map($map, array_slice($articles, 0, 10)),
        ]);
        Homepage::write($homepage);
        \Http::json(['updated' => true, 'articleCount' => count($articles)]);
    }

    public static function handleDelete(array $p): void
    {
        \Backup::snapshot();
        $year = (string)$p['year']; $vol = (int)$p['volume']; $iss = (string)$p['issue'];
        $deleteArticles = (($_GET['deleteArticles'] ?? '') === 'true');

        $archive = ArchiveIssues::read();
        $yi = null;
        foreach ($archive as $k => $y) if (($y['year'] ?? '') === $year) { $yi = $k; break; }
        if ($yi === null) \Http::error('Year not found', 404);
        $idx = null;
        foreach ($archive[$yi]['issues'] as $k => $i) {
            if ((int)($i['volume'] ?? 0) === $vol && (string)($i['issue'] ?? '') === $iss) { $idx = $k; break; }
        }
        if ($idx === null) \Http::error('Issue not found', 404);
        array_splice($archive[$yi]['issues'], $idx, 1);
        if (!$archive[$yi]['issues']) array_splice($archive, $yi, 1);
        ArchiveIssues::write($archive);

        // Clear currentIssue if it points at the deleted issue.
        $home = Homepage::read();
        $cur = $home['currentIssue'] ?? [];
        if ((int)($cur['volume'] ?? 0) === $vol && (string)($cur['issue'] ?? '') === $iss) {
            Homepage::write(array_merge($home, [
                'currentIssue' => [], 'featuredArticles' => [], 'imageCornerArticles' => [],
                'mostCitedArticles' => [], 'latestArticles' => [],
            ]));
        }

        $deletedCount = 0;
        if ($deleteArticles) {
            $articles = Articles::all();
            $remaining = [];
            foreach ($articles as $a) {
                if ((int)($a['volume'] ?? 0) === $vol && (string)($a['issue'] ?? '') === $iss) {
                    $deletedCount++;
                    @unlink(\Site::articlesDir() . "/{$a['id']}.js");
                    @unlink(\Site::articlesDir() . "/{$a['id']}.html");
                } else {
                    $remaining[] = $a;
                }
            }
            Articles::save($remaining);
        }

        // Remove volume + issue PDF files.
        @unlink(\Site::volumesDir() . "/vol{$vol}-{$iss}.json");
        @unlink(\Site::volumesDir() . "/vol{$vol}-{$iss}.js");
        $issuePdfsDir = \Config::projectRoot() . '/js/data/issue-pdfs';
        foreach (['full', 'cover'] as $suffix) {
            @unlink("$issuePdfsDir/vol{$vol}-{$iss}-{$suffix}.pdf");
        }
        \Http::json(['deleted' => true, 'deletedArticleCount' => $deletedCount]);
    }

    private const PDF_TYPES = ['full' => 'fullPdf', 'cover' => 'coverPdf'];

    public static function handleUploadFile(array $p): void
    {
        $type = $p['type'];
        if (!isset(self::PDF_TYPES[$type])) \Http::error('Geçersiz sayı PDF türü', 400);
        $field = self::PDF_TYPES[$type];
        $f = \Upload::single('pdf', 'pdf');
        \Backup::snapshot();

        $archive = ArchiveIssues::read();
        $loc = ArchiveIssues::findIssue($archive, $p['volume'], $p['issue']);
        if (!$loc) \Http::error('Sayı bulunamadı', 404);

        $vol = self::safePart($p['volume']); $iss = self::safePart($p['issue']);
        $filename = "vol{$vol}-{$iss}-{$type}.pdf";
        $dest = \Config::projectRoot() . "/js/data/issue-pdfs/{$filename}";
        \Upload::moveTo($f['tmp'], $dest);

        $record = [
            'url' => "js/data/issue-pdfs/{$filename}",
            'originalName' => basename($f['name']),
            'size' => $f['size'] ?: filesize($dest),
            'uploadedAt' => gmdate('c'),
        ];
        if ($type === 'cover') {
            $img = self::renderCover($dest, $vol, $iss);
            if ($img) $record['imageUrl'] = $img;
        }
        $archive[$loc['yearIndex']]['issues'][$loc['issueIndex']][$field] = $record;
        ArchiveIssues::write($archive);
        $rec = $archive[$loc['yearIndex']]['issues'][$loc['issueIndex']];
        \Http::json(['saved' => true, 'fullPdf' => $rec['fullPdf'] ?? null, 'coverPdf' => $rec['coverPdf'] ?? null]);
    }

    public static function handleDeleteFile(array $p): void
    {
        $type = $p['type'];
        if (!isset(self::PDF_TYPES[$type])) \Http::error('Geçersiz sayı PDF türü', 400);
        $field = self::PDF_TYPES[$type];
        \Backup::snapshot();
        $archive = ArchiveIssues::read();
        $loc = ArchiveIssues::findIssue($archive, $p['volume'], $p['issue']);
        if (!$loc) \Http::error('Sayı bulunamadı', 404);
        $rec =& $archive[$loc['yearIndex']]['issues'][$loc['issueIndex']];
        if (!empty($rec[$field]['url'])) {
            $base = basename($rec[$field]['url']);
            $dir = !empty($rec[$field]['legacy']) ? '/js/data/pdfs' : '/js/data/issue-pdfs';
            @unlink(\Config::projectRoot() . "$dir/$base");
        }
        if ($type === 'cover') {
            $vol = self::safePart($p['volume']); $iss = self::safePart($p['issue']);
            @unlink(\Config::projectRoot() . "/images/issue-covers/vol{$vol}-{$iss}-cover.png");
        }
        unset($rec[$field]);
        ArchiveIssues::write($archive);
        \Http::json(['deleted' => true, 'fullPdf' => $rec['fullPdf'] ?? null, 'coverPdf' => $rec['coverPdf'] ?? null]);
    }

    private static function safePart($v): string
    {
        $c = preg_replace('/[^a-zA-Z0-9._-]/', '_', (string)$v);
        if ($c === '' || $c === '.' || $c === '..') throw new \HttpError('Invalid issue identifier', 400);
        return $c;
    }

    /** Rasterize PDF page 1 to a cover PNG via Imagick (needs Ghostscript).
     *  Best-effort: returns the URL on success, null if unavailable. */
    private static function renderCover(string $pdfPath, string $vol, string $iss): ?string
    {
        if (!class_exists('Imagick')) return null;
        try {
            $dir = \Config::projectRoot() . '/images/issue-covers';
            if (!is_dir($dir)) mkdir($dir, 0775, true);
            $im = new \Imagick();
            $im->setResolution(150, 150);
            $im->readImage($pdfPath . '[0]');
            $im->setImageFormat('png');
            $im->setImageBackgroundColor('white');
            $im = $im->flattenImages();
            $out = "$dir/vol{$vol}-{$iss}-cover.png";
            $im->writeImage($out);
            $im->clear();
            return "images/issue-covers/vol{$vol}-{$iss}-cover.png";
        } catch (\Throwable $e) {
            return null;
        }
    }

    // --- helpers --------------------------------------------------------------
    private static function findRecord(array $archive, $volume, $issue): ?array
    {
        $vol = (int)$volume; $iss = (string)$issue;
        foreach ($archive as $y) foreach (($y['issues'] ?? []) as $i) {
            if ((int)($i['volume'] ?? 0) === $vol && (string)($i['issue'] ?? '') === $iss) return $i;
        }
        return null;
    }

    private static function legacyPdf(string $type, $volume, $issue): ?array
    {
        $vp = preg_replace('/[^a-zA-Z0-9._-]/', '_', (string)$volume);
        $ip = preg_replace('/[^a-zA-Z0-9._-]/', '_', (string)$issue);
        $filename = "issue-vol{$vp}-{$ip}-{$type}.pdf";
        $path = \Config::projectRoot() . "/js/data/pdfs/{$filename}";
        if (!is_file($path)) return null;
        return [
            'url' => "js/data/pdfs/{$filename}",
            'originalName' => $type === 'full' ? 'Full PDF.pdf' : 'Cover PDF.pdf',
            'size' => filesize($path),
            'uploadedAt' => gmdate('c', filemtime($path)),
            'legacy' => true,
        ];
    }
}
