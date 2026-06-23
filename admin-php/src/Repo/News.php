<?php
namespace Repo;

/** News & announcements (rows), exported to js/data/news.js. */
class News
{
    public static function all(): array
    {
        $rows = \Db::all('SELECT data FROM news ORDER BY (date IS NULL), date DESC, id DESC');
        return array_map(fn($r) => json_decode($r['data'], true), $rows);
    }

    public static function nextId(): int
    {
        $max = 0;
        foreach (self::all() as $n) $max = max($max, (int)($n['id'] ?? 0));
        return $max + 1;
    }

    private static function save(array $news): void
    {
        $news = array_values($news);
        $pdo = \Db::pdo();
        $pdo->beginTransaction();
        $pdo->exec('DELETE FROM news');
        $stmt = $pdo->prepare('INSERT INTO news (id, date, data) VALUES (?,?,?)');
        foreach ($news as $n) {
            $date = (preg_match('/^\d{4}-\d{2}-\d{2}/', (string)($n['date'] ?? ''), $m)) ? $m[0] : null;
            $stmt->execute([(int)$n['id'], $date, json_encode($n, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
        }
        $pdo->commit();
        \Site::writeNews($news);
    }

    // --- handlers -------------------------------------------------------------
    public static function handleList(): void { \Http::json(self::all()); }

    public static function handleGet(array $p): void
    {
        $raw = \Db::scalar('SELECT data FROM news WHERE id = ?', [(int)$p['id']]);
        if ($raw === null) \Http::error('Not found', 404);
        \Http::json(json_decode($raw, true));
    }

    public static function handleCreate(): void
    {
        \Backup::snapshot();
        $news = self::all();
        $item = array_merge(['id' => self::nextId(), 'featured' => false], \Http::body());
        array_unshift($news, $item);
        self::save($news);
        \Http::json($item, 201);
    }

    public static function handleUpdate(array $p): void
    {
        \Backup::snapshot();
        $news = self::all();
        foreach ($news as $i => $n) {
            if ((int)$n['id'] === (int)$p['id']) {
                $news[$i] = array_merge($n, \Http::body(), ['id' => $n['id']]);
                self::save($news);
                \Http::json($news[$i]);
            }
        }
        \Http::error('Not found', 404);
    }

    public static function handleDelete(array $p): void
    {
        \Backup::snapshot();
        $news = self::all();
        foreach ($news as $i => $n) {
            if ((int)$n['id'] === (int)$p['id']) {
                array_splice($news, $i, 1);
                self::save($news);
                \Http::json(['deleted' => true]);
            }
        }
        \Http::error('Not found', 404);
    }
}
