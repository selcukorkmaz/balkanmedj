<?php
/**
 * Timestamped snapshots of the exported data files. PHP port of
 * admin/lib/backup.js. Backups live under admin-php/backups (gitignored).
 */
class Backup
{
    private const MAX = 10;

    private static function dir(): string { return dirname(__DIR__) . '/backups'; }

    private static function dataFiles(): array
    {
        $d = \Config::projectRoot() . '/js/data';
        return [
            "$d/articles.js", "$d/articles-in-press.js", "$d/archive-issues.js",
            "$d/editorial-board.js", "$d/editorial-extended.js", "$d/news.js",
            "$d/homepage-articles.js", "$d/author-metadata.js",
        ];
    }

    /** Pre-mutation snapshot hook (called before writes). */
    public static function snapshot(): void { self::create(); }

    public static function create(): array
    {
        $stamp = gmdate('Y-m-d\THis');
        $dir = self::dir() . "/$stamp";
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $count = 0;
        foreach (self::dataFiles() as $src) {
            if (is_file($src)) { copy($src, "$dir/" . basename($src)); $count++; }
        }
        self::prune();
        return ['dir' => $dir, 'fileCount' => $count, 'timestamp' => $stamp];
    }

    private static function prune(): void
    {
        if (!is_dir(self::dir())) return;
        $dirs = array_values(array_filter(scandir(self::dir()), fn($d) => $d[0] !== '.' && is_dir(self::dir() . "/$d")));
        rsort($dirs);
        for ($i = self::MAX; $i < count($dirs); $i++) {
            self::rmrf(self::dir() . '/' . $dirs[$i]);
        }
    }

    private static function rmrf(string $path): void
    {
        if (!is_dir($path)) { @unlink($path); return; }
        foreach (array_diff(scandir($path), ['.', '..']) as $f) self::rmrf("$path/$f");
        @rmdir($path);
    }

    public static function listAll(): array
    {
        if (!is_dir(self::dir())) return [];
        $dirs = array_values(array_filter(scandir(self::dir()), fn($d) => $d[0] !== '.' && is_dir(self::dir() . "/$d")));
        rsort($dirs);
        return array_map(function ($d) {
            $files = array_values(array_filter(scandir(self::dir() . "/$d"), fn($f) => $f[0] !== '.'));
            return ['name' => $d, 'fileCount' => count($files), 'files' => $files];
        }, $dirs);
    }

    /** Build a ZIP of a stored backup; returns [path, filename]. Caller streams it. */
    public static function zip(string $name): array
    {
        $safe = basename($name);
        $dir = self::dir() . "/$safe";
        if (!$safe || !is_dir($dir)) throw new HttpError('Yedek bulunamadı', 404);
        $files = array_values(array_filter(scandir($dir), fn($f) => is_file("$dir/$f")));
        $tmp = tempnam(sys_get_temp_dir(), 'bmjbak');
        $zip = new ZipArchive();
        $zip->open($tmp, ZipArchive::OVERWRITE);
        foreach ($files as $f) $zip->addFile("$dir/$f", $f);
        $zip->addFromString('README.txt', "BALKAN MEDICAL JOURNAL — VERİ YEDEĞİ\nYedek: $safe\nDosya sayısı: " . count($files) . "\n");
        $zip->close();
        return [$tmp, "bmj-backup-{$safe}.zip"];
    }

    // --- handlers -------------------------------------------------------------
    public static function handleCreate(): void { \Http::json(self::create()); }
    public static function handleList(): void { \Http::json(self::listAll()); }

    public static function handleDownload(array $p): void
    {
        [$tmp, $filename] = self::zip($p['name']);
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($tmp));
        readfile($tmp);
        @unlink($tmp);
        exit;
    }
}
