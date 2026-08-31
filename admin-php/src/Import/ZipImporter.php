<?php
namespace Import;

use Repo\Articles;
use Repo\ArticlesInPress;
use Repo\ArchiveIssues;
use Repo\Homepage;
use Repo\Store;

/**
 * ZIP importer — extract a ZIP of JATS XML + PDF + images, parse articles, match
 * media by filename, import everything. PHP/ZipArchive port of
 * admin/lib/zip-importer.js. Reuses Import\JatsParser, \Site, \Repo\*.
 */
class ZipImporter
{
    private const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'tif', 'tiff', 'svg', 'webp'];
    private const MAX_TOTAL = 2147483648;      // 2 GB
    private const MAX_ENTRY = 524288000;       // 500 MB

    public static function importsDir(): string { return dirname(__DIR__, 2) . '/imports'; }
    public static function processedDir(): string { return self::importsDir() . '/processed'; }

    private static function ensureDirs(): void
    {
        foreach ([self::importsDir(), self::processedDir()] as $d) if (!is_dir($d)) mkdir($d, 0775, true);
    }

    private static function fileBase(string $name): string { return pathinfo($name, PATHINFO_FILENAME); }
    private static function ext(string $name): string { return strtolower(pathinfo($name, PATHINFO_EXTENSION)); }

    private static function formatBytes(int $b): string
    {
        if ($b < 1024) return "$b B";
        if ($b < 1048576) return round($b / 1024, 1) . ' KB';
        return round($b / 1048576, 1) . ' MB';
    }

    // --- scan -----------------------------------------------------------------
    public static function scanImportsDir(): array
    {
        self::ensureDirs();
        $out = [];
        foreach (scandir(self::importsDir()) as $f) {
            if (strtolower(substr($f, -4)) !== '.zip') continue;
            $p = self::importsDir() . "/$f";
            if (!is_file($p)) continue;
            $out[] = ['filename' => $f, 'size' => filesize($p), 'modified' => gmdate('c', filemtime($p)), 'sizeHuman' => self::formatBytes(filesize($p))];
        }
        usort($out, fn($a, $b) => strcmp($b['modified'], $a['modified']));
        return $out;
    }

    // --- analyze --------------------------------------------------------------
    private static function analyze(\ZipArchive $zip): array
    {
        $xml = []; $pdf = []; $image = []; $other = [];
        $total = 0;
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $st = $zip->statIndex($i);
            $entryName = $st['name'];
            if (substr($entryName, -1) === '/') continue;
            if (strpos($entryName, '__MACOSX/') !== false) continue;
            $name = basename($entryName);
            if ($name[0] === '.' || strncmp($name, '__MACOSX', 8) === 0) continue;
            $size = (int)$st['size'];
            if ($size > self::MAX_ENTRY) throw new \HttpError('ZIP bomb koruması: tek dosya çok büyük: ' . $name, 400);
            $total += $size;
            if ($total > self::MAX_TOTAL) throw new \HttpError('ZIP bomb koruması: toplam içerik 2 GB sınırını aşıyor.', 400);
            $ext = self::ext($name);
            $info = ['name' => $name, 'entryName' => $entryName, 'size' => $size];
            if ($ext === 'xml') $xml[] = $info;
            elseif ($ext === 'pdf') $pdf[] = $info;
            elseif (in_array($ext, self::IMAGE_EXTS, true)) $image[] = $info;
            else $other[] = $info;
        }
        return ['xmlFiles' => $xml, 'pdfFiles' => $pdf, 'imageFiles' => $image, 'otherFiles' => $other, 'totalEntries' => $zip->numFiles, 'totalUncompressed' => $total];
    }

    private static function buildImageIndex(array $imageFiles): array
    {
        $idx = [];
        foreach ($imageFiles as $img) {
            $key = Util::normalizeFigureKey($img['name']);
            if ($key && !isset($idx[$key])) $idx[$key] = $img;
        }
        return $idx;
    }
    private static function findImageMatch(?string $figRef, array $imageFiles, array $imageIndex): ?array
    {
        if (!$figRef) return null;
        $figBase = self::fileBase($figRef);
        foreach ($imageFiles as $img) if (self::fileBase($img['name']) === $figBase) return $img;
        $figLower = strtolower($figBase);
        foreach ($imageFiles as $img) if (strtolower(self::fileBase($img['name'])) === $figLower) return $img;
        $key = Util::normalizeFigureKey($figRef);
        return $key && isset($imageIndex[$key]) ? $imageIndex[$key] : null;
    }

    private static function listExistingAssets($id): array
    {
        $result = ['figures' => [], 'supplementary' => [], 'fullText' => false];
        $n = (int)$id;
        if ($n <= 0) return $result;
        $root = \Config::projectRoot();
        $figDir = "$root/images/articles/$n";
        if (is_dir($figDir)) foreach (scandir($figDir) as $f) if ($f[0] !== '.' && is_file("$figDir/$f")) $result['figures'][] = $f;
        $suppDir = "$root/js/data/supplementary/$n";
        if (is_dir($suppDir)) foreach (scandir($suppDir) as $f) if ($f[0] !== '.' && is_file("$suppDir/$f")) $result['supplementary'][] = $f;
        $result['fullText'] = is_file("$root/js/data/articles/$n.html");
        return $result;
    }

    // --- preview --------------------------------------------------------------
    public static function preview(string $zipPath): array
    {
        $zip = new \ZipArchive();
        if ($zip->open($zipPath) !== true) throw new \HttpError('ZIP açılamadı', 400);
        $analysis = self::analyze($zip);
        $imageIndex = self::buildImageIndex($analysis['imageFiles']);
        $articles = []; $errors = []; $consumed = [];

        $aipByDoi = [];
        foreach (ArticlesInPress::all() as $a) if (!empty($a['doi'])) $aipByDoi[Util::normalizeDoi($a['doi'])] = $a;
        $pubByDoi = [];
        foreach (Articles::all() as $a) if (!empty($a['doi'])) $pubByDoi[Util::normalizeDoi($a['doi'])] = $a;
        $doisInZip = [];

        foreach ($analysis['xmlFiles'] as $xmlInfo) {
            try {
                $parsed = JatsParser::parse($zip->getFromName($xmlInfo['entryName']));
                $baseName = self::fileBase($xmlInfo['name']);
                $matchedPdf = null;
                foreach ($analysis['pdfFiles'] as $p) if (self::fileBase($p['name']) === $baseName) { $matchedPdf = $p; break; }

                $figures = array_map(function ($fig) use ($analysis, $imageIndex, &$consumed) {
                    $match = self::findImageMatch($fig['imageFile'] ?? '', $analysis['imageFiles'], $imageIndex);
                    if ($match) $consumed[$match['entryName']] = true;
                    return [
                        'id' => $fig['id'] ?? '', 'label' => $fig['label'] ?? '', 'originalRef' => $fig['imageFile'] ?? '',
                        'matchedFile' => $match ? $match['name'] : null,
                        'status' => $match ? 'matched' : (!empty($fig['imageFile']) ? 'missing' : 'no-ref'),
                    ];
                }, $parsed['figures'] ?? []);

                $doiKey = Util::normalizeDoi($parsed['doi'] ?? '');
                $aipMatch = $doiKey ? ($aipByDoi[$doiKey] ?? null) : null;
                $pubMatch = $doiKey ? ($pubByDoi[$doiKey] ?? null) : null;
                $intraDup = ($doiKey && isset($doisInZip[$doiKey])) ? $doisInZip[$doiKey] : null;
                if ($doiKey && !$intraDup) $doisInZip[$doiKey] = $xmlInfo['name'];
                $status = 'new';
                if ($pubMatch) $status = 'duplicate';
                elseif ($aipMatch) $status = 'promote';
                elseif ($intraDup) $status = 'duplicate-in-zip';

                $targetId = ($pubMatch['id'] ?? null) ?: ($aipMatch['id'] ?? null);
                $existingAssets = null;
                if ($targetId) {
                    $probe = self::listExistingAssets($targetId);
                    if ($probe['figures'] || $probe['supplementary'] || $probe['fullText']) $existingAssets = $probe;
                }

                $articles[] = [
                    'xmlFile' => $xmlInfo['name'], 'baseName' => $baseName, 'title' => $parsed['title'],
                    'type' => $parsed['type'], 'doi' => $parsed['doi'], 'volume' => $parsed['volume'],
                    'issue' => $parsed['issue'], 'pages' => $parsed['pages'],
                    'authors' => array_map(fn($a) => $a['name'], $parsed['authors'] ?? []),
                    'matchedPdf' => $matchedPdf['name'] ?? null, 'figures' => $figures,
                    'figureCount' => count($figures),
                    'figuresMatched' => count(array_filter($figures, fn($f) => $f['status'] === 'matched')),
                    'figuresMissing' => count(array_filter($figures, fn($f) => $f['status'] === 'missing')),
                    'importStatus' => $status,
                    'aipMatch' => $aipMatch ? ['id' => $aipMatch['id'], 'title' => $aipMatch['title'] ?? ''] : null,
                    'publishedMatch' => $pubMatch ? ['id' => $pubMatch['id'], 'title' => $pubMatch['title'] ?? ''] : null,
                    'intraZipDuplicateOf' => $intraDup,
                    'existingAssets' => $existingAssets,
                ];
            } catch (\Throwable $e) {
                $errors[] = ['xmlFile' => $xmlInfo['name'], 'error' => $e->getMessage()];
            }
        }
        $orphan = [];
        foreach ($analysis['imageFiles'] as $img) {
            if (!isset($consumed[$img['entryName']])) $orphan[] = ['name' => $img['name'], 'size' => $img['size'], 'sizeHuman' => self::formatBytes($img['size'])];
        }
        $zip->close();
        return [
            'zipFile' => basename($zipPath), 'analysis' => $analysis, 'articles' => $articles, 'errors' => $errors, 'orphanImages' => $orphan,
            'summary' => [
                'totalXml' => count($analysis['xmlFiles']), 'parsedOk' => count($articles), 'parsedFail' => count($errors),
                'pdfsMatched' => count(array_filter($articles, fn($a) => $a['matchedPdf'])),
                'imagesMatched' => array_sum(array_map(fn($a) => $a['figuresMatched'], $articles)),
                'imagesMissing' => array_sum(array_map(fn($a) => $a['figuresMissing'], $articles)),
                'orphanImages' => count($orphan),
                'newArticles' => count(array_filter($articles, fn($a) => $a['importStatus'] === 'new')),
                'promotedFromAip' => count(array_filter($articles, fn($a) => $a['importStatus'] === 'promote')),
                'duplicates' => count(array_filter($articles, fn($a) => $a['importStatus'] === 'duplicate')),
                'duplicatesInZip' => count(array_filter($articles, fn($a) => $a['importStatus'] === 'duplicate-in-zip')),
            ],
        ];
    }

    // --- import ---------------------------------------------------------------
    public static function import(string $zipPath, array $options = []): array
    {
        $targetVolume = $options['targetVolume'] ?? null;
        $targetIssue = $options['targetIssue'] ?? null;
        $setAsCurrent = !empty($options['setAsCurrent']);
        $overwrite = !empty($options['overwrite']);

        $zip = new \ZipArchive();
        if ($zip->open($zipPath) !== true) throw new \HttpError('ZIP açılamadı', 400);
        $analysis = self::analyze($zip);
        $imageIndex = self::buildImageIndex($analysis['imageFiles']);
        $root = \Config::projectRoot();

        $articles = Articles::all();
        $allMeta = Store::get('author_metadata', []);
        if (!is_array($allMeta)) $allMeta = [];
        $aipList = ArticlesInPress::all();
        $aipByDoi = [];
        foreach ($aipList as $a) if (!empty($a['doi'])) $aipByDoi[Util::normalizeDoi($a['doi'])] = $a;
        $promotedAipIds = []; $imported = []; $promoted = []; $errors = [];
        $fullTexts = []; // id => html to persist after
        // Issues an overwrite relocated an article out of — their volume JSON
        // must be rebuilt so the moved article is dropped. "vol|iss" => [v,i,year].
        $staleIssues = [];

        // parse all XML first
        $parsedArticles = [];
        foreach ($analysis['xmlFiles'] as $xmlInfo) {
            try {
                $parsedArticles[] = ['xmlInfo' => $xmlInfo, 'parsed' => JatsParser::parse($zip->getFromName($xmlInfo['entryName'])), 'baseName' => self::fileBase($xmlInfo['name'])];
            } catch (\Throwable $e) { $errors[] = ['file' => $xmlInfo['name'], 'error' => $e->getMessage()]; }
        }

        $doisInRun = [];
        $indexById = function (array $arr, $id) { foreach ($arr as $i => $a) if ((int)($a['id'] ?? 0) === (int)$id) return $i; return -1; };

        foreach ($parsedArticles as $row) {
            $xmlInfo = $row['xmlInfo']; $parsed = $row['parsed']; $baseName = $row['baseName'];
            try {
                $doiKey = Util::normalizeDoi($parsed['doi'] ?? '');
                if ($doiKey && isset($doisInRun[$doiKey])) {
                    $errors[] = ['file' => $xmlInfo['name'], 'error' => "Aynı DOI ZIP içinde başka bir XML'de zaten işlendi: {$parsed['doi']}"];
                    continue;
                }
                $existingMain = null;
                if ($doiKey) {
                    $dupIdx = -1;
                    foreach ($articles as $i => $a) if (Util::normalizeDoi($a['doi'] ?? '') === $doiKey) { $dupIdx = $i; break; }
                    if ($dupIdx >= 0) {
                        // overwrite=true: update the existing published article in
                        // place (id preserved), regardless of its current volume/
                        // issue. overwrite off: reject so the operator decides.
                        if (!$overwrite) { $errors[] = ['file' => $xmlInfo['name'], 'error' => "DOI zaten yayınlanmış makalelerde mevcut: {$parsed['doi']} — güncellemek için \"Mevcut makaleleri güncelle\" seçeneğini işaretleyin."]; continue; }
                        $existingMain = $articles[$dupIdx];
                    }
                }
                $aipMatch = (!$existingMain && $doiKey) ? ($aipByDoi[$doiKey] ?? null) : null;
                $id = $existingMain ? $existingMain['id'] : ($aipMatch ? $aipMatch['id'] : Articles::nextId($articles));
                if ($aipMatch) $promotedAipIds[(int)$aipMatch['id']] = true;

                $cleanup = \Site::cleanArticleAssets($id);
                // Brand-new id with no incoming full text: drop any orphan body
                // (DB + static) so it can't be inherited. Overwrite/promote keep
                // theirs — writeFullText below replaces it when present.
                if (!$existingMain && !$aipMatch && empty($parsed['fullTextHtml'])) {
                    \Site::clearFullText($id);
                }
                $keep = $existingMain ?: $aipMatch;

                $article = [
                    'id' => $id, 'type' => $parsed['type'] ?? '', 'title' => $parsed['title'] ?? '',
                    'authors' => $parsed['authors'] ?? [], 'abstract' => $parsed['abstract'] ?? '',
                    'abstractHtml' => $parsed['abstractHtml'] ?? '', 'previewText' => $parsed['previewText'] ?? '',
                    'keywords' => $parsed['keywords'] ?? [], 'doi' => $parsed['doi'] ?? '',
                    'received' => $parsed['received'] ?? '', 'accepted' => $parsed['accepted'] ?? '', 'published' => $parsed['published'] ?? '',
                    // Keep the existing placement when overwriting without an explicit
                    // target and without volume/issue in the XML.
                    'volume' => $targetVolume !== null ? (int)$targetVolume
                        : (($parsed['volume'] ?? '') !== '' && $parsed['volume'] !== null ? (int)$parsed['volume']
                        : ($existingMain && ($existingMain['volume'] ?? null) !== null ? (int)$existingMain['volume'] : null)),
                    'issue' => $targetIssue !== null ? (string)$targetIssue
                        : (($parsed['issue'] ?? '') !== '' ? $parsed['issue']
                        : ($existingMain && ($existingMain['issue'] ?? null) !== null ? (string)$existingMain['issue'] : '')),
                    'pages' => $parsed['pages'] ?? '',
                    'views' => $keep['views'] ?? 0, 'downloads' => $keep['downloads'] ?? 0, 'citations' => $keep['citations'] ?? 0,
                    'featured' => $existingMain['featured'] ?? false, 'imageCorner' => $existingMain['imageCorner'] ?? false,
                    'hasFullText' => (bool)($parsed['fullTextHtml'] ?? ''),
                    'sourceIssueId' => '', 'sourceArticleId' => '', 'sourceAbstractUrl' => '', 'sourceTextUrl' => '',
                    'sourcePdfUrl' => '', 'localPdfUrl' => '', 'pdfUrl' => '',
                    'pmid' => $parsed['pmid'] ?? '', 'elocationId' => $parsed['elocationId'] ?? '',
                    'supplementary' => $parsed['supplementary'] ?? [], 'funding' => $parsed['funding'] ?? [],
                    'permissions' => $parsed['permissions'] ?? null, 'relatedArticles' => $parsed['relatedArticles'] ?? [],
                ];

                // PDF
                $matchedPdf = null;
                foreach ($analysis['pdfFiles'] as $p) if (self::fileBase($p['name']) === $baseName) { $matchedPdf = $p; break; }
                if ($matchedPdf) {
                    file_put_contents("$root/js/data/pdfs/$id.pdf", $zip->getFromName($matchedPdf['entryName']));
                    $article['pdfUrl'] = "js/data/pdfs/$id.pdf";
                    $article['localPdfUrl'] = $article['pdfUrl'];
                } elseif ($aipMatch) {
                    if (!empty($aipMatch['pdfUrl'])) $article['pdfUrl'] = $aipMatch['pdfUrl'];
                    if (!empty($aipMatch['localPdfUrl'])) $article['localPdfUrl'] = $aipMatch['localPdfUrl'];
                }

                // Figures
                $fullTextHtml = $parsed['fullTextHtml'] ?? '';
                if (!empty($parsed['figures'])) {
                    $imgDir = "$root/images/articles/$id";
                    if (!is_dir($imgDir)) mkdir($imgDir, 0775, true);
                    foreach ($parsed['figures'] as $fig) {
                        if (empty($fig['imageFile'])) continue;
                        $figBase = self::fileBase($fig['imageFile']);
                        $match = self::findImageMatch($fig['imageFile'], $analysis['imageFiles'], $imageIndex);
                        if ($match) {
                            $ext = '.' . self::ext($match['name']);
                            $safeBase = preg_replace('/[^a-zA-Z0-9._-]/', '_', $figBase);
                            $destName = $safeBase . $ext;
                            file_put_contents("$imgDir/$destName", $zip->getFromName($match['entryName']));
                            $newUrl = "images/articles/$id/$destName";
                            $escaped = preg_quote($fig['imageFile'], '/');
                            $fullTextHtml = preg_replace('/(src|data-src|xlink:href)=(["\'])' . $escaped . '\2/i', '$1=$2' . $newUrl . '$2', $fullTextHtml);
                        }
                    }
                }

                // Supplementary
                if (!empty($parsed['supplementary'])) {
                    $suppDir = "$root/js/data/supplementary/$id";
                    foreach ($article['supplementary'] as $k => $supp) {
                        if (empty($supp['href'])) continue;
                        $suppBase = basename($supp['href']);
                        $match = null;
                        foreach (array_merge($analysis['otherFiles'], $analysis['pdfFiles'], $analysis['imageFiles']) as $f) {
                            if ($f['name'] === $suppBase || strtolower($f['name']) === strtolower($suppBase)) { $match = $f; break; }
                        }
                        if ($match) {
                            if (!is_dir($suppDir)) mkdir($suppDir, 0775, true);
                            $safeName = preg_replace('/[^a-zA-Z0-9._-]/', '_', $suppBase);
                            file_put_contents("$suppDir/$safeName", $zip->getFromName($match['entryName']));
                            $newUrl = "js/data/supplementary/$id/$safeName";
                            $article['supplementary'][$k]['href'] = $newUrl;
                            $escaped = preg_quote($suppBase, '/');
                            $fullTextHtml = preg_replace('/href="' . $escaped . '"/', 'href="' . $newUrl . '"', $fullTextHtml);
                        }
                    }
                }

                if ($fullTextHtml) {
                    $fullTexts[$id] = $fullTextHtml;
                } elseif ($keep && !empty($keep['hasFullText'])) {
                    $article['hasFullText'] = true;
                }
                if (!empty($parsed['authorMetadata'])) $allMeta[(string)$id] = $parsed['authorMetadata'];

                if ($existingMain) {
                    // Remember the issue an overwrite relocated the article out of.
                    $oldV = (int)($existingMain['volume'] ?? 0);
                    $oldI = (string)($existingMain['issue'] ?? '');
                    $newV = (int)($article['volume'] ?? 0);
                    $newI = (string)($article['issue'] ?? '');
                    if ($oldV && $oldI !== '' && ($oldV !== $newV || $oldI !== $newI)) {
                        $sk = "$oldV|$oldI";
                        if (!isset($staleIssues[$sk])) {
                            $yr = (preg_match('/(?:19|20)\d{2}/', (string)($existingMain['published'] ?? ''), $m) ? $m[0] : (string)date('Y'));
                            $staleIssues[$sk] = ['volume' => $oldV, 'issue' => $oldI, 'year' => (string)$yr];
                        }
                    }
                    $idx = $indexById($articles, $id);
                    if ($idx >= 0) $articles[$idx] = $article; else array_unshift($articles, $article);
                } else {
                    array_unshift($articles, $article);
                }
                if ($doiKey) $doisInRun[$doiKey] = true;
                $cleanedCount = count($cleanup['figures']) + count($cleanup['supplementary']);
                $record = [
                    'id' => $id, 'title' => $parsed['title'], 'doi' => $parsed['doi'],
                    'hasPdf' => !empty($article['pdfUrl']), 'figureCount' => count($parsed['figures'] ?? []),
                    'promotedFromAip' => (bool)$aipMatch, 'overwritten' => (bool)$existingMain,
                    'cleanedStaleFiles' => $cleanedCount > 0 ? ['count' => $cleanedCount, 'figures' => $cleanup['figures'], 'supplementary' => $cleanup['supplementary']] : null,
                ];
                $imported[] = $record;
                if ($aipMatch) $promoted[] = $record;
            } catch (\Throwable $e) {
                $errors[] = ['file' => $xmlInfo['name'], 'error' => $e->getMessage()];
            }
        }
        $zip->close();

        // Persist: articles first, then fulltext, then author-meta, then AIP removal.
        Articles::save($articles);
        foreach ($fullTexts as $fid => $html) {
            \Db::run('INSERT INTO article_fulltext (article_id, html) VALUES (?, ?) ON DUPLICATE KEY UPDATE html=VALUES(html)', [$fid, $html]);
            \Site::writeFullText($fid, $html);
        }
        if ($allMeta) { Store::put('author_metadata', $allMeta); \Site::writeAuthorMetadata($allMeta); }
        if ($promotedAipIds) {
            $remaining = array_values(array_filter($aipList, fn($a) => !isset($promotedAipIds[(int)($a['id'] ?? 0)])));
            ArticlesInPress::save($remaining);
        }

        // Archive entries per imported (volume,issue)
        $importedIssues = [];
        foreach ($imported as $rec) {
            $idx = $indexById($articles, $rec['id']);
            if ($idx < 0) continue;
            $art = $articles[$idx];
            $v = (int)($art['volume'] ?? 0); $i = (string)($art['issue'] ?? '');
            if (!$v || $i === '') continue;
            $key = "$v|$i";
            if (!isset($importedIssues[$key])) {
                $year = preg_match('/(?:19|20)\d{2}/', (string)($art['published'] ?? ''), $m) ? $m[0] : gmdate('Y');
                $importedIssues[$key] = ['volume' => $v, 'issue' => $i, 'year' => (string)$year];
            }
        }
        // Fold in issues an overwrite emptied/relocated out of, so their volume
        // JSON is rebuilt and no longer lists the moved article.
        foreach ($staleIssues as $sk => $info) {
            if (!isset($importedIssues[$sk])) $importedIssues[$sk] = $info;
        }
        if ($importedIssues) {
            $archive = ArchiveIssues::read();
            foreach ($importedIssues as $info) {
                $count = \Site::rebuildVolumeJson($info['volume'], $info['issue'], $articles);
                $loc = ArchiveIssues::findIssue($archive, $info['volume'], $info['issue']);
                if ($loc) {
                    $archive[$loc['yearIndex']]['issues'][$loc['issueIndex']]['articleCount'] = $count;
                    $archive[$loc['yearIndex']]['issues'][$loc['issueIndex']]['hasLocalData'] = true;
                } else {
                    $yi = null;
                    foreach ($archive as $k => $y) if (($y['year'] ?? '') === $info['year']) { $yi = $k; break; }
                    if ($yi === null) {
                        array_unshift($archive, ['year' => $info['year'], 'volume' => $info['volume'], 'issues' => []]);
                        usort($archive, fn($a, $b) => (int)$b['year'] <=> (int)$a['year']);
                        foreach ($archive as $k => $y) if (($y['year'] ?? '') === $info['year']) { $yi = $k; break; }
                    }
                    array_unshift($archive[$yi]['issues'], [
                        'label' => "Volume {$info['volume']}, Issue {$info['issue']}", 'sourceId' => '', 'sourceUrl' => '',
                        'volume' => $info['volume'], 'issue' => $info['issue'], 'articleCount' => $count, 'hasLocalData' => true,
                    ]);
                }
            }
            ArchiveIssues::write($archive);
        }

        $vol = $targetVolume !== null ? (int)$targetVolume : null;
        $iss = $targetIssue !== null ? (string)$targetIssue : null;
        if ((!$vol || !$iss) && $importedIssues) {
            $first = reset($importedIssues);
            if (!$vol) $vol = $first['volume'];
            if (!$iss) $iss = $first['issue'];
        }
        if ($setAsCurrent && $vol && $iss) self::rebuildHomepage($vol, $iss, $articles);

        // move zip to processed
        self::ensureDirs();
        $processed = self::processedDir() . '/' . gmdate('Y-m-d\THis') . '_' . basename($zipPath);
        @copy($zipPath, $processed);
        if (strpos($zipPath, self::importsDir()) === 0 && strpos($zipPath, self::processedDir()) !== 0) @unlink($zipPath);

        return [
            'imported' => $imported, 'promoted' => $promoted, 'errors' => $errors,
            'totalImported' => count($imported), 'totalPromoted' => count($promoted), 'totalErrors' => count($errors),
            'volume' => $vol, 'issue' => $iss,
        ];
    }

    private static function rebuildHomepage($volume, $issue, array $articles): void
    {
        $vol = (int)$volume;
        Articles::enforceSingleFeaturedForIssue($articles, $vol, $issue);
        $issueArticles = array_values(array_filter($articles, fn($a) => (int)($a['volume'] ?? 0) === $vol && (string)($a['issue'] ?? '') === (string)$issue));
        $archive = ArchiveIssues::read();
        $year = '';
        foreach ($archive as $y) foreach (($y['issues'] ?? []) as $i) {
            if ((int)($i['volume'] ?? 0) === $vol && (string)($i['issue'] ?? '') === (string)$issue) { $year = $y['year']; break 2; }
        }
        $map = fn($a) => [
            'id' => $a['id'] ?? null, 'type' => $a['type'] ?? null, 'title' => $a['title'] ?? null,
            'authors' => array_map(fn($au) => ['name' => is_array($au) ? ($au['name'] ?? '') : (string)$au], $a['authors'] ?? []),
            'doi' => $a['doi'] ?? null, 'volume' => $a['volume'] ?? null, 'issue' => $a['issue'] ?? null,
            'pages' => $a['pages'] ?? null, 'published' => $a['published'] ?? null,
            'previewText' => $a['previewText'] ?? '', 'imageUrl' => $a['imageUrl'] ?? '',
        ];
        $featured = array_slice(array_values(array_filter($issueArticles, fn($a) => !empty($a['featured']))), 0, 1);
        $imageCorner = array_values(array_filter($issueArticles, fn($a) => !empty($a['imageCorner'])));
        $mostCited = $issueArticles;
        usort($mostCited, fn($a, $b) => (int)($b['citations'] ?? 0) <=> (int)($a['citations'] ?? 0));
        $mostCited = array_slice($mostCited, 0, 5);
        $home = Homepage::mergeIssueData(Homepage::read(), [
            'generatedAt' => gmdate('Y-m-d'),
            'currentIssue' => ['volume' => $vol, 'issue' => (string)$issue, 'year' => $year],
            'featuredArticles' => array_map($map, $featured),
            'imageCornerArticles' => array_map($map, $imageCorner),
            'mostCitedArticles' => array_map($map, $mostCited),
            'latestArticles' => array_map($map, array_slice($issueArticles, 0, 10)),
        ]);
        Homepage::write($home);
    }
}
