<?php
/**
 * Inject social-media links into every page footer. PHP port of
 * admin/lib/social-media-sync.js. Platform catalog = admin-php/data/
 * social-platforms.json.
 */
class SocialSync
{
    public static function platforms(): array
    {
        $p = dirname(__DIR__) . '/data/social-platforms.json';
        $d = is_file($p) ? json_decode((string)file_get_contents($p), true) : [];
        return is_array($d) ? $d : [];
    }

    private static function escAttr($v): string
    {
        return str_replace(['&', '"', '<', '>'], ['&amp;', '&quot;', '&lt;', '&gt;'], (string)($v ?? ''));
    }

    private static function buildLink(array $platform, string $url): string
    {
        return '<a href="' . self::escAttr($url) . '" target="_blank" rel="noopener" aria-label="' . $platform['label']
            . '" class="text-teal-300 hover:text-white transition-colors"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="'
            . $platform['svgPath'] . '"/></svg></a>';
    }

    private static function buildBlock(array $socialUrls): string
    {
        $links = [];
        foreach (self::platforms() as $p) {
            $k = $p['key'];
            if (isset($socialUrls[$k]) && is_string($socialUrls[$k]) && trim($socialUrls[$k]) !== '') {
                $links[] = self::buildLink($p, trim($socialUrls[$k]));
            }
        }
        return implode("\n              ", $links);
    }

    private static function blockRegex(): string
    {
        $labels = implode('|', array_map(fn($p) => preg_quote($p['label'], '/'), self::platforms()));
        return '/<a[^>]*aria-label="(?:' . $labels . ')"[^>]*>.*?<\/a>(?:\s*<a[^>]*aria-label="(?:' . $labels . ')"[^>]*>.*?<\/a>)*/s';
    }

    public static function syncSocialMedia(array $socialUrls): array
    {
        $block = self::buildBlock($socialUrls);
        $re = self::blockRegex();
        $root = \Config::projectRoot();
        $results = [];
        foreach (HtmlSync::allHtmlFiles() as $file) {
            $path = "$root/$file";
            if (!is_file($path)) { $results[] = ['file' => $file, 'status' => 'skipped', 'reason' => 'file not found']; continue; }
            $html = (string)file_get_contents($path);
            if (!preg_match($re, $html)) { $results[] = ['file' => $file, 'status' => 'no-block']; continue; }
            $updated = preg_replace($re, str_replace(['\\', '$'], ['\\\\', '\\$'], $block), $html);
            if ($updated === $html) { $results[] = ['file' => $file, 'status' => 'unchanged']; continue; }
            \JsFile::atomicPut($path, $updated);
            $results[] = ['file' => $file, 'status' => 'updated'];
        }
        return ['syncedAt' => gmdate('c'), 'results' => $results];
    }
}
