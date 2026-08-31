<?php
/**
 * Date parsing — PHP port of admin/lib/docx-parser.js parseDate/isoDate/foldDateText.
 * Accepts many human formats (incl. Turkish month names) and returns 'YYYY-MM-DD'
 * or '' if unparseable. Used for article date normalization and the DOCX importer.
 */
class Dates
{
    public static function iso($year, $month, $day): string
    {
        $y = (int)$year; $m = (int)$month; $d = (int)$day;
        if ($y < 1900 || $y > 2200 || $m < 1 || $m > 12 || $d < 1 || $d > 31) return '';
        if (!checkdate($m, $d, $y)) return '';
        return sprintf('%04d-%02d-%02d', $y, $m, $d);
    }

    public static function fold($value): string
    {
        $s = (string)$value;
        $s = preg_replace('/[\x{200e}\x{200f}\x{202a}-\x{202e}]/u', '', $s);
        $map = ['ç'=>'c','Ç'=>'c','ğ'=>'g','Ğ'=>'g','ı'=>'i','İ'=>'i','ö'=>'o','Ö'=>'o','ş'=>'s','Ş'=>'s','ü'=>'u','Ü'=>'u'];
        $s = strtr($s, $map);
        return mb_strtolower($s, 'UTF-8');
    }

    public static function parse($input): string
    {
        $raw = preg_replace('/[\x{200e}\x{200f}\x{202a}-\x{202e}]/u', ' ', (string)$input);
        $raw = trim($raw);
        if ($raw === '') return '';
        $raw = preg_replace('/(\d)(st|nd|rd|th)\b/i', '$1', $raw);
        $raw = preg_replace('/\s+/', ' ', $raw);

        // YYYY-MM-DD style
        if (preg_match('#\b((?:19|20|21)\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\b#', $raw, $m)) {
            return self::iso($m[1], $m[2], $m[3]);
        }
        // DD-MM-YYYY style
        if (preg_match('#\b(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*((?:19|20|21)?\d{2})\b#', $raw, $m)) {
            $year = strlen($m[3]) === 2 ? 2000 + (int)$m[3] : (int)$m[3];
            return self::iso($year, $m[2], $m[1]);
        }

        $months = [
            'jan'=>1,'january'=>1,'oca'=>1,'ocak'=>1,
            'feb'=>2,'february'=>2,'sub'=>2,'subat'=>2,
            'mar'=>3,'march'=>3,'mart'=>3,
            'apr'=>4,'april'=>4,'nis'=>4,'nisan'=>4,
            'may'=>5,'mayis'=>5,
            'jun'=>6,'june'=>6,'haz'=>6,'haziran'=>6,
            'jul'=>7,'july'=>7,'tem'=>7,'temmuz'=>7,
            'aug'=>8,'august'=>8,'agu'=>8,'agustos'=>8,
            'sep'=>9,'sept'=>9,'september'=>9,'eyl'=>9,'eylul'=>9,
            'oct'=>10,'october'=>10,'eki'=>10,'ekim'=>10,
            'nov'=>11,'november'=>11,'kas'=>11,'kasim'=>11,
            'dec'=>12,'december'=>12,'ara'=>12,'aralik'=>12,
        ];
        $folded = self::fold($raw);
        if (preg_match('/\b(\d{1,2})\s+([a-z]+)\.?\s*,?\s*((?:19|20|21)\d{2})\b/', $folded, $m) && isset($months[$m[2]])) {
            return self::iso($m[3], $months[$m[2]], $m[1]);
        }
        if (preg_match('/\b([a-z]+)\.?\s+(\d{1,2})\s*,?\s*((?:19|20|21)\d{2})\b/', $folded, $m) && isset($months[$m[1]])) {
            return self::iso($m[3], $months[$m[1]], $m[2]);
        }
        // YYYYMMDD
        if (preg_match('/\b((?:19|20|21)\d{2})(\d{2})(\d{2})\b/', $raw, $m)) {
            return self::iso($m[1], $m[2], $m[3]);
        }
        return '';
    }
}
