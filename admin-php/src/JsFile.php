<?php
/**
 * Read/write the public site's `window.VAR = <json>;` data files and plain JSON
 * files. PHP port of admin/lib/data-io.js (readJsData / writeJsData / *Json).
 */
class JsFile
{
    /** Parse `window.VAR = ...;` into a PHP array. Returns [] if absent. */
    public static function read(string $path, string $varName)
    {
        if (!is_file($path)) return [];
        $text = (string)file_get_contents($path);
        $body = preg_replace('#/\*[\s\S]*?\*/#', '', $text);
        $body = preg_replace('/window\.' . preg_quote($varName, '/') . '\s*=\s*/', '', $body, 1);
        $body = trim((string)$body);
        $body = preg_replace('/;\s*$/', '', $body);

        $data = json_decode((string)$body, true);
        if (json_last_error() === JSON_ERROR_NONE) return $data;

        // Fallback: quote unquoted object keys (JS object-literal style).
        $fixed = preg_replace('/(?<=[\{\[,\n])\s*([a-zA-Z_]\w*)\s*:/', ' "$1":', (string)$body);
        $data = json_decode((string)$fixed, true);
        return json_last_error() === JSON_ERROR_NONE ? $data : [];
    }

    /** Write a `window.VAR = <pretty json>;` file atomically. */
    public static function write(string $path, string $varName, $data, string $description): void
    {
        $now = date('Y-m-d');
        $header = "/**\n * Balkan Medical Journal — {$description}\n * Last updated: {$now}\n */\n";
        $body = self::encode($data);
        self::atomicPut($path, $header . "window.{$varName} = {$body};\n");
    }

    public static function readJson(string $path)
    {
        if (!is_file($path)) return null;
        return json_decode((string)file_get_contents($path), true);
    }

    public static function writeJson(string $path, $data): void
    {
        self::atomicPut($path, self::encode($data));
    }

    /** JSON encode matching the JS writers (UTF-8, unescaped slashes, indented). */
    public static function encode($data): string
    {
        return json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    public static function atomicPut(string $path, string $contents): void
    {
        $dir = dirname($path);
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $tmp = $path . '.tmp';
        file_put_contents($tmp, $contents);
        rename($tmp, $path);
    }
}
