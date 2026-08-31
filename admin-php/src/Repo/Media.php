<?php
namespace Repo;

/**
 * Media: file uploads (PDF/image/video/figures/supplementary), figure caption
 * metadata, and asset listing. Files live on disk under the public paths; only
 * URLs/metadata reach the article records. Port of admin/server.js media routes.
 * (figure-status + figures/apply auto-placement are ported in Phase 5 with the
 * importer's normalizeFigureKey.)
 */
class Media
{
    private const META = '_figure-meta.json';
    private const SIZES = ['auto', 'small', 'medium', 'large', 'full'];

    private static function root(): string { return \Config::projectRoot(); }
    private static function pdfsDir(): string { return self::root() . '/js/data/pdfs'; }
    private static function imagesDir(): string { return self::root() . '/images'; }
    private static function articleImagesDir(): string { return self::root() . '/images/articles'; }
    private static function suppDir(): string { return self::root() . '/js/data/supplementary'; }
    private static function sid($v): string { return preg_replace('/[^a-zA-Z0-9._-]/', '_', (string)$v); }

    // --- Single uploads -------------------------------------------------------
    public static function uploadPdf(): void
    {
        $f = \Upload::single('pdf', 'pdf');
        // Multipart form fields arrive in $_POST (not the JSON body).
        $rawId = trim((string)($_POST['articleId'] ?? '')) ?: pathinfo($f['name'], PATHINFO_FILENAME);
        $id = self::sid($rawId);
        $dest = self::pdfsDir() . "/{$id}.pdf";
        \Upload::moveTo($f['tmp'], $dest);
        \Http::json(['pdfUrl' => "js/data/pdfs/{$id}.pdf", 'path' => $dest]);
    }

    public static function uploadImage(): void
    {
        $f = \Upload::single('image', 'image');
        $name = \Upload::sanitize($f['name']);
        \Upload::moveTo($f['tmp'], self::imagesDir() . "/{$name}");
        \Http::json(['url' => "images/{$name}"]);
    }

    public static function uploadVideo(): void
    {
        $f = \Upload::single('video', 'video');
        $name = \Upload::sanitize($f['name']);
        \Upload::moveTo($f['tmp'], self::imagesDir() . "/videos/{$name}");
        \Http::json(['url' => "images/videos/{$name}"]);
    }

    public static function uploadDocument(): void
    {
        $f = \Upload::single('document', 'document');
        $name = \Upload::sanitize($f['name']);
        \Upload::moveTo($f['tmp'], self::imagesDir() . "/documents/{$name}");
        \Http::json(['url' => "images/documents/{$name}", 'name' => $f['name']]);
    }

    public static function uploadEditorialPhoto(): void
    {
        $f = \Upload::single('image', 'image');
        $name = \Upload::sanitize($f['name']);
        \Upload::moveTo($f['tmp'], self::imagesDir() . "/editorial-board/{$name}");
        \Http::json(['url' => "images/editorial-board/{$name}"]);
    }

    public static function uploadEditorialCv(): void
    {
        $f = \Upload::single('file', 'figure');
        $name = \Upload::sanitize($f['name']);
        \Upload::moveTo($f['tmp'], self::imagesDir() . "/editorial-board/cv/{$name}");
        \Http::json(['url' => "images/editorial-board/cv/{$name}"]);
    }

    // --- Batch PDF (match by filename to article/AIP id) ----------------------
    public static function uploadPdfBatch(): void
    {
        $files = \Upload::many('pdf', 'pdf');
        if (!$files) \Http::error('No files', 400);
        $articles = Articles::all();
        $aip = ArticlesInPress::all();
        $matched = []; $unmatched = [];
        $aDirty = false; $pDirty = false;
        foreach ($files as $f) {
            $base = self::sid(pathinfo($f['name'], PATHINFO_FILENAME));
            $id = (int)$base;
            \Upload::moveTo($f['tmp'], self::pdfsDir() . "/{$base}.pdf");
            $url = "js/data/pdfs/{$base}.pdf";
            $ai = $id ? self::indexById($articles, $id) : -1;
            $pi = ($ai === -1 && $id) ? self::indexById($aip, $id) : -1;
            if ($ai !== -1) {
                $articles[$ai]['pdfUrl'] = $url; $articles[$ai]['localPdfUrl'] = $url; $aDirty = true;
                $matched[] = ['id' => $articles[$ai]['id'], 'title' => $articles[$ai]['title'] ?? '', 'pdfUrl' => $url, 'list' => 'articles'];
            } elseif ($pi !== -1) {
                $aip[$pi]['pdfUrl'] = $url; $aip[$pi]['localPdfUrl'] = $url; $pDirty = true;
                $matched[] = ['id' => $aip[$pi]['id'], 'title' => $aip[$pi]['title'] ?? '', 'pdfUrl' => $url, 'list' => 'aip'];
            } else {
                $unmatched[] = ['filename' => $f['name'], 'pdfUrl' => $url];
            }
        }
        if ($aDirty) Articles::save($articles);
        if ($pDirty) ArticlesInPress::save($aip);
        \Http::json(['matched' => $matched, 'unmatched' => $unmatched, 'totalMatched' => count($matched), 'totalUnmatched' => count($unmatched)]);
    }

    // --- Figure metadata + ordering -------------------------------------------
    private static function readMeta(string $dir): array
    {
        $p = "$dir/" . self::META;
        if (!is_file($p)) return [];
        $m = json_decode((string)file_get_contents($p), true);
        return is_array($m) ? $m : [];
    }
    private static function writeMeta(string $dir, array $meta): void
    {
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        file_put_contents("$dir/" . self::META, json_encode($meta, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    private static function sortFigureNames(array $names, array $meta): array
    {
        usort($names, function ($a, $b) use ($meta) {
            $oa = isset($meta[$a]['order']) && is_numeric($meta[$a]['order']) ? $meta[$a]['order'] : INF;
            $ob = isset($meta[$b]['order']) && is_numeric($meta[$b]['order']) ? $meta[$b]['order'] : INF;
            if ($oa !== $ob) return $oa <=> $ob;
            return strnatcasecmp($a, $b);
        });
        return $names;
    }
    private static function assignOrder(array &$meta, array $existing, array $newNames): void
    {
        $max = -1;
        foreach ($meta as $v) if (isset($v['order']) && is_numeric($v['order']) && $v['order'] > $max) $max = $v['order'];
        $lacking = array_filter($existing, fn($f) => !(isset($meta[$f]['order']) && is_numeric($meta[$f]['order'])) && !in_array($f, $newNames, true));
        usort($lacking, 'strnatcasecmp');
        foreach ($lacking as $f) {
            $max++;
            if (!isset($meta[$f])) $meta[$f] = ['caption' => '', 'source' => '', 'size' => 'auto'];
            $meta[$f]['order'] = $max;
        }
        foreach ($newNames as $f) {
            if (!isset($meta[$f])) $meta[$f] = ['caption' => '', 'source' => '', 'size' => 'auto'];
            if (!(isset($meta[$f]['order']) && is_numeric($meta[$f]['order']))) { $max++; $meta[$f]['order'] = $max; }
        }
    }

    public static function getFigureMeta(array $p): void
    {
        $dir = self::articleImagesDir() . '/' . self::sid($p['articleId']);
        \Http::json(self::readMeta($dir) ?: new \stdClass());
    }

    public static function putFigureMeta(array $p): void
    {
        $id = self::sid($p['articleId']);
        $b = \Http::body();
        $filename = $b['filename'] ?? '';
        if (!$filename) \Http::error('filename required', 400);
        $dir = self::articleImagesDir() . "/$id";
        $meta = self::readMeta($dir);
        $prevOrder = $meta[$filename]['order'] ?? null;
        $meta[$filename] = [
            'caption' => $b['caption'] ?? '',
            'source' => $b['source'] ?? '',
            'size' => in_array($b['size'] ?? '', self::SIZES, true) ? $b['size'] : 'auto',
            'label' => is_string($b['label'] ?? null) ? $b['label'] : '',
            'updatedAt' => gmdate('c'),
        ];
        if ($prevOrder !== null) $meta[$filename]['order'] = $prevOrder;
        self::writeMeta($dir, $meta);
        \Http::json(['ok' => true]);
    }

    public static function deleteFigure(array $p): void
    {
        $id = self::sid($p['articleId']);
        $filename = self::sid(basename($p['filename']));
        if (!$filename || $filename === self::META) \Http::error('Invalid filename', 400);
        $dir = self::articleImagesDir() . "/$id";
        $file = "$dir/$filename";
        if (is_file($file)) @unlink($file);
        $meta = self::readMeta($dir);
        if (array_key_exists($filename, $meta)) {
            unset($meta[$filename]);
            if (!$meta) @unlink("$dir/" . self::META);
            else self::writeMeta($dir, $meta);
        }
        $fullTextRemoved = 0;
        $html = \Site::readFullText($id);
        if ($html) {
            [$newHtml, $removed] = self::stripMediaFromFullText($html, $filename);
            if ($removed > 0) { \Site::writeFullText($id, $newHtml); $fullTextRemoved = $removed; }
        }
        \Http::json(['ok' => true, 'deleted' => $filename, 'fullTextRemoved' => $fullTextRemoved]);
    }

    public static function getAssets(array $p): void
    {
        $id = self::sid($p['articleId']);
        $dir = self::articleImagesDir() . "/$id";
        $sDir = self::suppDir() . "/$id";
        $meta = self::readMeta($dir);
        $figNames = is_dir($dir) ? array_values(array_filter(scandir($dir), fn($f) => $f[0] !== '.' && $f !== self::META && is_file("$dir/$f"))) : [];
        $figNames = self::sortFigureNames($figNames, $meta);
        $figures = array_map(fn($f) => [
            'filename' => $f, 'url' => "images/articles/$id/$f",
            'caption' => $meta[$f]['caption'] ?? '', 'source' => $meta[$f]['source'] ?? '',
            'size' => $meta[$f]['size'] ?? 'auto', 'label' => $meta[$f]['label'] ?? '',
            'order' => (isset($meta[$f]['order']) && is_numeric($meta[$f]['order'])) ? $meta[$f]['order'] : null,
        ], $figNames);
        $supp = is_dir($sDir) ? array_map(fn($f) => ['filename' => $f, 'url' => "js/data/supplementary/$id/$f"],
            array_values(array_filter(scandir($sDir), fn($f) => $f[0] !== '.' && is_file("$sDir/$f")))) : [];
        \Http::json(['articleId' => $id, 'figures' => $figures, 'supplementary' => $supp]);
    }

    public static function uploadFigures(array $p): void
    {
        $files = \Upload::many('figures', 'figure');
        if (!$files) \Http::error('No files', 400);
        $id = self::sid($p['articleId']);
        $dir = self::articleImagesDir() . "/$id";
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $preExisting = array_values(array_filter(scandir($dir), fn($f) => $f[0] !== '.' && $f !== self::META && is_file("$dir/$f")));
        $uploaded = []; $newNames = [];
        foreach ($files as $f) {
            $name = \Upload::sanitize($f['name']);
            \Upload::moveTo($f['tmp'], "$dir/$name");
            $newNames[] = $name;
            $uploaded[] = ['filename' => $name, 'url' => "images/articles/$id/$name"];
        }
        $meta = self::readMeta($dir);
        self::assignOrder($meta, $preExisting, $newNames);
        self::writeMeta($dir, $meta);
        $known = self::indexById(Articles::all(), (int)$id) !== -1 || self::indexById(ArticlesInPress::all(), (int)$id) !== -1;
        \Http::json(['articleId' => $id, 'uploaded' => $uploaded, 'articleKnown' => $known]);
    }

    public static function uploadSupplementary(array $p): void
    {
        $files = \Upload::many('files', 'supplementary');
        if (!$files) \Http::error('No files', 400);
        $id = self::sid($p['articleId']);
        $dir = self::suppDir() . "/$id";
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $uploaded = [];
        foreach ($files as $f) {
            $name = \Upload::sanitize($f['name']);
            \Upload::moveTo($f['tmp'], "$dir/$name");
            $uploaded[] = ['filename' => $name, 'url' => "js/data/supplementary/$id/$name"];
        }
        // Auto-link into the owning article's supplementary[].
        $articles = Articles::all();
        $aip = ArticlesInPress::all();
        $ti = self::indexById($articles, (int)$id); $inAip = false;
        if ($ti === -1) { $ti = self::indexById($aip, (int)$id); $inAip = $ti !== -1; }
        $known = $ti !== -1; $added = []; $supplementary = [];
        if ($ti !== -1) {
            $target = $inAip ? $aip[$ti] : $articles[$ti];
            if (!isset($target['supplementary']) || !is_array($target['supplementary'])) $target['supplementary'] = [];
            $seen = array_flip(array_map(fn($s) => $s['href'] ?? '', $target['supplementary']));
            foreach ($uploaded as $u) {
                if (isset($seen[$u['url']])) continue;
                $entry = ['id' => 'supp' . (count($target['supplementary']) + 1), 'label' => $u['filename'], 'href' => $u['url'], 'caption' => '', 'mimeType' => ''];
                $target['supplementary'][] = $entry;
                $seen[$u['url']] = true;
                $added[] = $entry;
            }
            if ($added) {
                if ($inAip) { $aip[$ti] = $target; ArticlesInPress::save($aip); }
                else { $articles[$ti] = $target; Articles::save($articles); }
            }
            $supplementary = $target['supplementary'];
        }
        \Http::json(['articleId' => $id, 'uploaded' => $uploaded, 'articleKnown' => $known, 'added' => $added, 'supplementary' => $supplementary]);
    }

    // --- Figure placeholder status (full-text refs vs uploaded files) --------
    public static function figureStatus(array $p): void
    {
        $id = self::sid($p['articleId']);
        $html = \Site::readFullText($id) ?: '';
        $dir = self::articleImagesDir() . "/$id";
        $uploaded = [];
        if (is_dir($dir)) {
            foreach (scandir($dir) as $f) {
                if ($f[0] === '.' || $f === self::META || !is_file("$dir/$f")) continue;
                $uploaded[] = ['filename' => $f, 'url' => "images/articles/$id/$f", 'key' => \Import\Util::normalizeFigureKey($f)];
            }
        }
        $byKey = []; $byName = [];
        foreach ($uploaded as $u) {
            if ($u['key'] && !isset($byKey[$u['key']])) $byKey[$u['key']] = $u;
            $byName[strtolower($u['filename'])] = $u;
            $base = strtolower(preg_replace('/\.[^.]+$/', '', $u['filename']));
            if (!isset($byName[$base])) $byName[$base] = $u;
        }
        $placeholders = []; $seen = [];
        if (preg_match_all('/src="([^"]+)"/', $html, $mm)) {
            foreach ($mm[1] as $ref) {
                if (isset($seen["src:$ref"])) continue;
                $seen["src:$ref"] = true;
                $isResolved = (bool)preg_match('#^(images/|/|https?://|data:)#', $ref);
                $key = \Import\Util::normalizeFigureKey($ref);
                $match = null;
                if (!$isResolved) $match = $byKey[$key] ?? ($byName[strtolower($ref)] ?? null);
                else { $bn = strtolower(basename($ref)); $match = $byName[$bn] ?? null; }
                $placeholders[] = [
                    'ref' => $ref, 'format' => 'modern', 'key' => $key,
                    'status' => $isResolved ? 'resolved' : ($match ? 'fuzzy-match' : 'missing'),
                    'resolvedUrl' => $isResolved ? $ref : ($match['url'] ?? null),
                    'suggestedFile' => $match['filename'] ?? null,
                ];
            }
        }
        if (preg_match_all('/openWin\(\s*[\'"]([^\'"]+)[\'"]/', $html, $mm)) {
            foreach ($mm[1] as $ref) {
                if (isset($seen["legacy:$ref"])) continue;
                $seen["legacy:$ref"] = true;
                $bn = basename($ref);
                $bnNoExt = strtolower(preg_replace('/\.[^.]+$/', '', $bn));
                $key = \Import\Util::normalizeFigureKey($bn);
                $match = $byName[strtolower($bn)] ?? ($byName[$bnNoExt] ?? ($key ? ($byKey[$key] ?? null) : null));
                $placeholders[] = [
                    'ref' => $ref, 'format' => 'legacy', 'key' => $key, 'suggestedName' => $bn,
                    'status' => $match ? 'fuzzy-match' : 'missing',
                    'resolvedUrl' => $match['url'] ?? null, 'suggestedFile' => $match['filename'] ?? null,
                ];
            }
        }
        $matchedNames = [];
        foreach ($placeholders as $pl) if ($pl['suggestedFile']) $matchedNames[$pl['suggestedFile']] = true;
        $figures = array_map(fn($u) => [
            'filename' => $u['filename'], 'url' => $u['url'], 'key' => $u['key'],
            'matchedTo' => isset($matchedNames[$u['filename']]) ? ($u['key'] ?: $u['filename']) : null,
        ], $uploaded);
        $cnt = fn($s) => count(array_filter($placeholders, fn($x) => $x['status'] === $s));
        \Http::json([
            'articleId' => $id, 'hasFullText' => (bool)$html, 'placeholders' => $placeholders, 'figures' => $figures,
            'stats' => [
                'totalPlaceholders' => count($placeholders), 'resolved' => $cnt('resolved'),
                'fuzzyMatch' => $cnt('fuzzy-match'), 'missing' => $cnt('missing'),
                'legacyCount' => count(array_filter($placeholders, fn($x) => $x['format'] === 'legacy')),
            ],
        ]);
    }

    // --- Apply uploaded figure paths into full-text HTML ----------------------
    public static function figuresApply(array $p): void
    {
        $id = self::sid($p['articleId']);
        $html = \Site::readFullText($id);
        if (!$html) \Http::error('Full text not found', 404);
        $replaced = 0; $replacements = [];
        $body = \Http::body();

        if (!empty($body['mappings']) && is_array($body['mappings'])) {
            foreach ($body['mappings'] as $m) {
                if (empty($m['originalHref'])) continue;
                if (strpos($html, 'src="' . $m['originalHref'] . '"') !== false) {
                    $html = str_replace('src="' . $m['originalHref'] . '"', 'src="' . $m['newUrl'] . '"', $html);
                    $replaced++; $replacements[] = ['from' => $m['originalHref'], 'to' => $m['newUrl']];
                }
            }
        }

        $dir = self::articleImagesDir() . "/$id";
        if (is_dir($dir)) {
            $byKey = []; $byName = [];
            foreach (scandir($dir) as $f) {
                if ($f[0] === '.' || $f === self::META || !is_file("$dir/$f")) continue;
                $u = ['filename' => $f, 'url' => "images/articles/$id/$f", 'key' => \Import\Util::normalizeFigureKey($f)];
                if ($u['key'] && !isset($byKey[$u['key']])) $byKey[$u['key']] = $u;
                $byName[strtolower($f)] = $u;
                $base = strtolower(preg_replace('/\.[^.]+$/', '', $f));
                if (!isset($byName[$base])) $byName[$base] = $u;
            }
            // 1) modern src refs
            $modern = [];
            if (preg_match_all('/src="([^"]+)"/', $html, $mm)) {
                foreach ($mm[1] as $ref) if (!preg_match('#^(images/|/|https?://|data:)#', $ref)) $modern[$ref] = true;
            }
            foreach (array_keys($modern) as $ref) {
                $match = $byKey[\Import\Util::normalizeFigureKey($ref)] ?? ($byName[strtolower($ref)] ?? null);
                if ($match) {
                    $html = preg_replace('/src="' . preg_quote($ref, '/') . '"/', 'src="' . $match['url'] . '"', $html);
                    $replaced++; $replacements[] = ['from' => $ref, 'to' => $match['url'], 'format' => 'modern'];
                }
            }
            // 2) legacy openWin anchors → <figure>
            $html = preg_replace_callback('/<a[^>]*href="javascript:openWin\(\s*[\'"]([^\'"]+)[\'"][^)]*\)"[^>]*>(.*?)<\/a>/is', function ($m) use ($byKey, $byName, &$replaced, &$replacements) {
                $refPath = $m[1];
                $bn = basename($refPath);
                $bnNoExt = strtolower(preg_replace('/\.[^.]+$/', '', $bn));
                $match = $byName[strtolower($bn)] ?? ($byName[$bnNoExt] ?? ($byKey[\Import\Util::normalizeFigureKey($bn)] ?? null));
                if (!$match) return $m[0];
                $label = trim(preg_replace('/<[^>]+>/', '', $m[2])) ?: $bn;
                $replaced++; $replacements[] = ['from' => $refPath, 'to' => $match['url'], 'format' => 'legacy'];
                return '<figure class="article-figure"><img src="' . $match['url'] . '" alt="' . str_replace('"', '&quot;', $label) . '"><figcaption>' . $label . '</figcaption></figure>';
            }, $html);
        }
        \Db::run('INSERT INTO article_fulltext (article_id, html) VALUES (?, ?) ON DUPLICATE KEY UPDATE html=VALUES(html)', [(int)$id, $html]);
        \Site::writeFullText($id, $html);
        \Http::json(['replaced' => $replaced, 'replacements' => $replacements, 'articleId' => $id]);
    }

    // --- Stats ----------------------------------------------------------------
    public static function stats(): void
    {
        $pdfCount = is_dir(self::pdfsDir()) ? count(array_filter(scandir(self::pdfsDir()), fn($f) => str_ends_with($f, '.pdf'))) : 0;
        $articles = Articles::all();
        $withPdf = count(array_filter($articles, fn($a) => !empty($a['pdfUrl'])));
        $figureCount = self::countDirFiles(self::articleImagesDir());
        $suppCount = self::countDirFiles(self::suppDir());
        \Http::json([
            'pdfCount' => $pdfCount, 'withPdf' => $withPdf, 'withoutPdf' => count($articles) - $withPdf,
            'figureCount' => $figureCount, 'suppCount' => $suppCount, 'totalArticles' => count($articles),
        ]);
    }

    public static function missingPdfs(): void
    {
        $missing = [];
        foreach (Articles::all() as $a) {
            if (empty($a['pdfUrl'])) {
                $missing[] = ['id' => $a['id'] ?? null, 'title' => $a['title'] ?? '', 'volume' => $a['volume'] ?? null, 'issue' => $a['issue'] ?? null, 'doi' => $a['doi'] ?? ''];
            }
        }
        \Http::json($missing);
    }

    // --- helpers --------------------------------------------------------------
    private static function indexById(array $list, int $id): int
    {
        foreach ($list as $i => $a) if ((int)($a['id'] ?? 0) === $id) return $i;
        return -1;
    }
    private static function countDirFiles(string $base): int
    {
        if (!is_dir($base)) return 0;
        $count = 0;
        foreach (scandir($base) as $d) {
            if ($d[0] === '.') continue;
            $p = "$base/$d";
            if (is_dir($p)) $count += count(array_filter(scandir($p), fn($f) => $f[0] !== '.'));
        }
        return $count;
    }

    /** Remove figure/table/img blocks referencing $filename from full-text HTML. */
    public static function stripMediaFromFullText(string $html, string $filename): array
    {
        if (!$html || !$filename) return [$html, 0];
        $base = basename($filename);
        $escd = preg_quote($base, '/');
        $refRe = '/(?:src|href)\s*=\s*["\'][^"\']*' . $escd . '["\']/i';
        $removed = 0;
        $html = preg_replace_callback('/<figure\b[^>]*>[\s\S]*?<\/figure>/i', function ($m) use ($refRe, &$removed) {
            if (preg_match($refRe, $m[0])) { $removed++; return ''; }
            return $m[0];
        }, $html);
        $html = preg_replace_callback('/<div\b[^>]*class\s*=\s*["\'][^"\']*article-table-wrap[^"\']*["\'][^>]*>[\s\S]*?<\/div>/i', function ($m) use ($refRe, &$removed) {
            $inner = preg_replace('/^<div\b[^>]*>/i', '', $m[0]);
            if (preg_match($refRe, $m[0]) && !preg_match('/<div\b/i', $inner)) { $removed++; return ''; }
            return $m[0];
        }, $html);
        $html = preg_replace_callback('/<img\b[^>]*>/i', function ($m) use ($refRe, &$removed) {
            if (preg_match($refRe, $m[0])) { $removed++; return ''; }
            return $m[0];
        }, $html);
        return [$html, $removed];
    }
}
