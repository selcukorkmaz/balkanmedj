<?php
namespace Repo;

/** Generic accessor for the single-blob `singletons` table. */
class Store
{
    public static function get(string $name, $default = [])
    {
        $raw = \Db::scalar('SELECT data FROM singletons WHERE name = ?', [$name]);
        if ($raw === null) return $default;
        $d = json_decode($raw, true);
        return $d === null ? $default : $d;
    }

    public static function put(string $name, $data): void
    {
        \Db::run(
            'INSERT INTO singletons (name, data) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE data = VALUES(data)',
            [$name, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]
        );
    }
}
