<?php
namespace Repo;

/**
 * Article types: counts computed live from articles + in-press, merged with a
 * manually-curated list stored in the `article_types` singleton.
 */
class ArticleTypes
{
    private static function manual(): array
    {
        $m = Store::get('article_types', []);
        return is_array($m) ? array_values(array_filter($m)) : [];
    }

    public static function handleList(): void
    {
        $counts = [];
        foreach (Articles::all() as $a) {
            $t = $a['type'] ?? 'Unknown';
            if ($t === '' || $t === null) $t = 'Unknown';
            $counts[$t] = ($counts[$t] ?? 0) + 1;
        }
        foreach (ArticlesInPress::all() as $a) {
            if (!empty($a['type'])) $counts[$a['type']] = ($counts[$a['type']] ?? 0) + 1;
        }
        $manual = self::manual();
        foreach ($manual as $name) {
            if (!array_key_exists($name, $counts)) $counts[$name] = 0;
        }
        $manualSet = array_flip($manual);
        $types = [];
        foreach ($counts as $name => $count) {
            $types[] = ['name' => $name, 'count' => $count, 'manual' => isset($manualSet[$name])];
        }
        usort($types, fn($a, $b) => ($b['count'] <=> $a['count']) ?: strcmp($a['name'], $b['name']));
        \Http::json($types);
    }

    public static function handleAdd(): void
    {
        $name = trim((string)(\Http::body()['name'] ?? ''));
        if ($name === '') \Http::error('Tür adı gerekli', 400);
        if (mb_strlen($name) > 80) \Http::error('Tür adı çok uzun (maks 80)', 400);
        $manual = self::manual();
        if (!in_array($name, $manual, true)) {
            $manual[] = $name;
            Store::put('article_types', array_values($manual));
        }
        \Http::json(['name' => $name, 'ok' => true]);
    }

    public static function handleDelete(array $p): void
    {
        $name = trim((string)$p['name']);
        if ($name === '') \Http::error('Tür adı gerekli', 400);
        $inUse = false;
        foreach (Articles::all() as $a) if (($a['type'] ?? '') === $name) { $inUse = true; break; }
        if (!$inUse) foreach (ArticlesInPress::all() as $a) if (($a['type'] ?? '') === $name) { $inUse = true; break; }
        if ($inUse) \Http::error('Bu tür şu anda en az bir makalede kullanılıyor — önce makaleleri başka bir türe taşıyın veya yeniden adlandırın.', 409);
        $manual = self::manual();
        $next = array_values(array_filter($manual, fn($t) => $t !== $name));
        if (count($next) !== count($manual)) Store::put('article_types', $next);
        \Http::json(['removed' => true]);
    }

    public static function handleRename(): void
    {
        \Backup::snapshot();
        $b = \Http::body();
        $oldName = $b['oldName'] ?? null;
        $newName = $b['newName'] ?? null;
        if (!$oldName || !$newName) \Http::error('oldName and newName required', 400);
        $trimmed = trim((string)$newName);
        if ($trimmed === '') \Http::error('Yeni ad boş olamaz', 400);

        $articles = Articles::all();
        $count = 0;
        foreach ($articles as $i => $a) if (($a['type'] ?? '') === $oldName) { $articles[$i]['type'] = $trimmed; $count++; }
        Articles::save($articles);

        $aip = ArticlesInPress::all();
        $aipCount = 0;
        foreach ($aip as $i => $a) if (($a['type'] ?? '') === $oldName) { $aip[$i]['type'] = $trimmed; $aipCount++; }
        if ($aipCount) ArticlesInPress::save($aip);

        $manual = self::manual();
        if (in_array($oldName, $manual, true)) {
            $next = array_values(array_filter($manual, fn($t) => $t !== $oldName));
            if (!in_array($trimmed, $next, true)) $next[] = $trimmed;
            Store::put('article_types', $next);
        }
        \Http::json(['renamed' => $count + $aipCount]);
    }
}
