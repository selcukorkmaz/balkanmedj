<?php
/**
 * Loads admin-php/config.php once and exposes typed getters.
 */
class Config
{
    private static ?array $cfg = null;

    public static function load(): void
    {
        if (self::$cfg !== null) return;
        $path = dirname(__DIR__) . '/config.php';
        if (!is_file($path)) {
            throw new RuntimeException('config.php not found — copy config.sample.php to config.php');
        }
        self::$cfg = require $path;
    }

    public static function get(string $key, $default = null)
    {
        self::load();
        return self::$cfg[$key] ?? $default;
    }

    public static function projectRoot(): string
    {
        return rtrim(self::get('project_root'), '/\\');
    }

    public static function basePath(): string
    {
        return rtrim((string)self::get('base_path', ''), '/');
    }

    public static function isProd(): bool
    {
        return (bool)self::get('is_prod', false);
    }
}
