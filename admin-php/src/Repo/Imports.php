<?php
namespace Repo;

use Import\ZipImporter;

/** ZIP import endpoints. Port of admin/server.js /api/imports/*. */
class Imports
{
    public static function handleScan(): void { \Http::json(ZipImporter::scanImportsDir()); }

    public static function handleUpload(): void
    {
        $f = \Upload::single('zip', 'zip');
        $safe = \Upload::sanitize($f['name']);
        $dest = ZipImporter::importsDir() . "/$safe";
        \Upload::moveTo($f['tmp'], $dest);
        \Http::json(['filename' => $safe, 'path' => $dest]);
    }

    public static function handlePreview(array $p): void
    {
        $safe = basename($p['filename']);
        $zipPath = ZipImporter::importsDir() . "/$safe";
        if (!is_file($zipPath)) \Http::error('ZIP dosyası bulunamadı', 404);
        \Http::json(ZipImporter::preview($zipPath));
    }

    public static function handleProcess(array $p): void
    {
        $lock = self::lock('zip:' . $p['filename']);
        try {
            \Backup::snapshot();
            $safe = basename($p['filename']);
            $zipPath = ZipImporter::importsDir() . "/$safe";
            if (!is_file($zipPath)) \Http::error('ZIP dosyası bulunamadı', 404);

            $b = \Http::body();
            $targetVolume = $b['targetVolume'] ?? null;
            $targetIssue = $b['targetIssue'] ?? null;

            // Optionally create the target issue up front.
            if (!empty($b['createIssue']) && $targetVolume && $targetIssue) {
                $archive = ArchiveIssues::read();
                if (!ArchiveIssues::findIssue($archive, $targetVolume, $targetIssue)) {
                    $year = (string)($b['year'] ?? gmdate('Y'));
                    $yi = null;
                    foreach ($archive as $k => $y) if (($y['year'] ?? '') === $year) { $yi = $k; break; }
                    if ($yi === null) {
                        array_unshift($archive, ['year' => $year, 'volume' => (int)$targetVolume, 'issues' => []]);
                        usort($archive, fn($a, $c) => (int)$c['year'] <=> (int)$a['year']);
                        foreach ($archive as $k => $y) if (($y['year'] ?? '') === $year) { $yi = $k; break; }
                    }
                    array_unshift($archive[$yi]['issues'], [
                        'label' => "Volume {$targetVolume}, Issue {$targetIssue}", 'sourceId' => '', 'sourceUrl' => '',
                        'volume' => (int)$targetVolume, 'issue' => (string)$targetIssue, 'articleCount' => 0, 'hasLocalData' => true,
                    ]);
                    ArchiveIssues::write($archive);
                    \Site::rebuildVolumeJson((int)$targetVolume, (string)$targetIssue, []);
                }
            }

            $result = ZipImporter::import($zipPath, [
                'targetVolume' => $targetVolume !== null ? (int)$targetVolume : null,
                'targetIssue' => $targetIssue !== null ? (string)$targetIssue : null,
                'setAsCurrent' => !empty($b['setAsCurrent']),
                'overwrite' => !empty($b['overwrite']),
            ]);
            \Http::json($result, 201);
        } finally {
            self::unlock($lock);
        }
    }

    public static function handleDelete(array $p): void
    {
        $safe = basename($p['filename']);
        $zipPath = ZipImporter::importsDir() . "/$safe";
        if (is_file($zipPath)) @unlink($zipPath);
        \Http::json(['deleted' => true]);
    }

    private static function lock(string $label)
    {
        $fp = fopen(sys_get_temp_dir() . '/bmj-import.lock', 'c');
        if (!$fp || !flock($fp, LOCK_EX | LOCK_NB)) {
            if ($fp) fclose($fp);
            \Http::error("Başka bir içe aktarma işlemi devam ediyor: $label", 409);
        }
        return $fp;
    }
    private static function unlock($fp): void { if ($fp) { flock($fp, LOCK_UN); fclose($fp); } }
}
