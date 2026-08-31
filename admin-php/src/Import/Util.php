<?php
namespace Import;

/** Shared importer helpers ported from admin/lib/zip-importer.js. */
class Util
{
    public static function normalizeDoi($value): string
    {
        if ($value === null) return '';
        return strtolower(rtrim(trim((string)$value), '/'));
    }

    /**
     * Normalize a figure reference/filename to a comparison key, so "fig1",
     * "figure 1", "fig_01", "Figure-1.png" all collapse to the same token.
     * Port of zip-importer.js normalizeFigureKey.
     */
    public static function normalizeFigureKey($name): string
    {
        if (!$name) return '';
        $s = strtolower((string)$name);
        $s = preg_replace('/\.[a-z0-9]+$/', '', $s);     // drop extension
        $s = preg_replace('/[\s_.\-]+/', '', $s);         // strip separators
        $s = preg_replace('/^figure(?=\d)/', 'fig', $s);
        $s = preg_replace('/^fig(?=\d)/', 'fig', $s);
        $s = preg_replace('/^f(?=\d)/', 'fig', $s);
        $s = preg_replace('/^(fig|table|scheme|equation|chart|plate)0+(\d+)/', '$1$2', $s);
        if (preg_match('/^\d+$/', $s)) $s = 'fig' . preg_replace('/^0+/', '', $s);
        return $s;
    }
}
