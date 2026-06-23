<?php
namespace Repo;

/**
 * Standalone supplementary-material library at /img/files/<name> (permanent
 * URLs). Port of admin/server.js supp-library routes.
 */
class SuppLibrary
{
    private static function dir(): string { return \Config::projectRoot() . '/img/files'; }

    private static function ensureDir(): void
    {
        if (!is_dir(self::dir())) mkdir(self::dir(), 0775, true);
    }

    public static function safeName($raw): string
    {
        $base = trim(basename((string)$raw));
        if ($base === '') return '';
        $cleaned = preg_replace('/-+/', '-', preg_replace('/[^A-Za-z0-9._-]/', '-', preg_replace('/\s+/', '-', $base)));
        if ($cleaned === '' || $cleaned[0] === '.' || $cleaned === '-' || strlen($cleaned) > 200) return '';
        return $cleaned;
    }

    private static function stat(string $name): ?array
    {
        $safe = self::safeName($name);
        if (!$safe) return null;
        $p = self::dir() . "/$safe";
        if (!is_file($p)) return null;
        return ['name' => $safe, 'size' => filesize($p), 'mtime' => gmdate('c', filemtime($p)), 'url' => "/img/files/$safe"];
    }

    /** Map<filename, [{articleId,title,isAip}]> from supplementary hrefs at /img/files/. */
    private static function refMap(): array
    {
        $map = [];
        $scan = function (array $list, bool $isAip) use (&$map) {
            foreach ($list as $a) {
                foreach (($a['supplementary'] ?? []) as $s) {
                    if (empty($s['href'])) continue;
                    if (preg_match('#(?:^|/)img/files/([^/?#]+)$#', (string)$s['href'], $m)) {
                        $name = urldecode($m[1]);
                        $map[$name][] = ['articleId' => (string)($a['id'] ?? ''), 'title' => $a['title'] ?? '', 'isAip' => $isAip];
                    }
                }
            }
        };
        $scan(Articles::all(), false);
        $scan(ArticlesInPress::all(), true);
        return $map;
    }

    public static function handleList(): void
    {
        self::ensureDir();
        $scope = (string)($_GET['scope'] ?? 'all');
        $refMap = self::refMap();
        $files = [];
        foreach (scandir(self::dir()) as $n) {
            if ($n[0] === '.') continue;
            $stat = self::stat($n);
            if (!$stat) continue;
            $stat['references'] = $refMap[$n] ?? [];
            $files[] = $stat;
        }
        if ($scope === 'standalone') $files = array_filter($files, fn($f) => !$f['references']);
        elseif ($scope === 'linked') $files = array_filter($files, fn($f) => $f['references']);
        $files = array_values($files);
        usort($files, fn($a, $b) => strcmp($b['mtime'], $a['mtime']));
        \Http::json(['files' => $files, 'scope' => $scope, 'baseUrl' => '/img/files']);
    }

    public static function handleUpload(): void
    {
        $files = \Upload::many('files', 'supplementary');
        if (!$files) \Http::error('No files', 400);
        self::ensureDir();
        // Multipart form fields arrive in $_POST (not the JSON body).
        $overwrite = (($_GET['overwrite'] ?? $_POST['overwrite'] ?? '') === 'true');
        $renameSingle = count($files) === 1 ? self::safeName($_POST['rename'] ?? '') : '';
        $uploaded = []; $conflicts = [];
        foreach ($files as $f) {
            $safe = $renameSingle ?: self::safeName($f['name']);
            if (!$safe) { @unlink($f['tmp']); continue; }
            $dest = self::dir() . "/$safe";
            if (is_file($dest) && !$overwrite) { $conflicts[] = ['name' => $safe, 'reason' => 'exists']; @unlink($f['tmp']); continue; }
            \Upload::moveTo($f['tmp'], $dest);
            $uploaded[] = self::stat($safe);
        }

        $articleLinked = null;
        $articleId = trim((string)($_POST['articleId'] ?? ''));
        if ($articleId && $uploaded) {
            $articles = Articles::all(); $aip = ArticlesInPress::all();
            $ti = self::idx($articles, $articleId); $inAip = false;
            if ($ti === -1) { $ti = self::idx($aip, $articleId); $inAip = $ti !== -1; }
            if ($ti === -1) {
                $articleLinked = ['articleId' => $articleId, 'error' => 'Article not found'];
            } else {
                $t = $inAip ? $aip[$ti] : $articles[$ti];
                if (!isset($t['supplementary']) || !is_array($t['supplementary'])) $t['supplementary'] = [];
                $seen = array_flip(array_filter(array_map(fn($s) => $s['href'] ?? '', $t['supplementary'])));
                $added = [];
                foreach ($uploaded as $u) {
                    $href = "img/files/{$u['name']}";
                    if (isset($seen[$href]) || isset($seen["/$href"])) continue;
                    $entry = ['id' => 'supp' . (count($t['supplementary']) + 1), 'label' => $u['name'], 'href' => $href, 'caption' => '', 'mimeType' => ''];
                    $t['supplementary'][] = $entry; $seen[$href] = true; $added[] = $entry;
                }
                if ($added) {
                    if ($inAip) { $aip[$ti] = $t; ArticlesInPress::save($aip); }
                    else { $articles[$ti] = $t; Articles::save($articles); }
                }
                $articleLinked = ['articleId' => $articleId, 'title' => $t['title'] ?? '', 'isAip' => $inAip, 'added' => $added];
            }
        }
        \Http::json(['uploaded' => $uploaded, 'conflicts' => $conflicts, 'articleLinked' => $articleLinked]);
    }

    public static function handleReplace(array $p): void
    {
        $safe = self::safeName($p['name']);
        if (!$safe) \Http::error('Bad filename', 400);
        $dest = self::dir() . "/$safe";
        if (!is_file($dest)) \Http::error('Not found', 404);
        $f = \Upload::single('file', 'supplementary');
        \Upload::moveTo($f['tmp'], $dest);
        \Http::json(['file' => self::stat($safe)]);
    }

    public static function handleRename(array $p): void
    {
        $from = self::safeName($p['name']);
        $to = self::safeName(\Http::body()['to'] ?? '');
        if (!$from || !$to) \Http::error('Bad filename', 400);
        if ($from === $to) \Http::json(['file' => self::stat($from)]);
        $src = self::dir() . "/$from"; $dst = self::dir() . "/$to";
        if (!is_file($src)) \Http::error('Not found', 404);
        if (is_file($dst)) \Http::error('Target name already exists', 409);
        rename($src, $dst);
        \Http::json(['file' => self::stat($to), 'oldName' => $from]);
    }

    public static function handleDelete(array $p): void
    {
        $safe = self::safeName($p['name']);
        if (!$safe) \Http::error('Bad filename', 400);
        $path = self::dir() . "/$safe";
        if (!is_file($path)) \Http::error('Not found', 404);
        @unlink($path);
        \Http::json(['deleted' => $safe]);
    }

    private static function idx(array $list, $id): int
    {
        foreach ($list as $i => $a) if ((string)($a['id'] ?? '') === (string)$id) return $i;
        return -1;
    }
}
