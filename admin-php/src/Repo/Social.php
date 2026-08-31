<?php
namespace Repo;

/**
 * Social media links. Catalog (key/label/color/svg/placeholder) lives in
 * admin-php/data/social-platforms.json (generated from social-media-sync.js).
 * Values stored in the `social_media` singleton. Footer sync = templating phase.
 */
class Social
{
    private static function catalog(): array
    {
        $p = dirname(__DIR__, 2) . '/data/social-platforms.json';
        $d = is_file($p) ? json_decode((string)file_get_contents($p), true) : [];
        return is_array($d) ? $d : [];
    }

    private static function defaults(): array
    {
        $d = [];
        foreach (self::catalog() as $p) $d[$p['key']] = '';
        // Seed the common ones (matches the live footer / Node defaults).
        $d['instagram'] = 'https://www.instagram.com/balkanmedj/';
        $d['twitter'] = 'https://x.com/balkanmedj';
        $d['linkedin'] = 'https://www.linkedin.com/company/balkan-med-j/';
        return $d;
    }

    public static function handlePlatforms(): void { \Http::json(self::catalog()); }

    public static function handleGet(): void
    {
        $stored = Store::get('social_media', null);
        $data = is_array($stored) ? array_merge(self::defaults(), $stored) : self::defaults();
        \Http::json($data);
    }

    public static function handlePut(): void
    {
        $b = \Http::body();
        $payload = [];
        foreach (self::catalog() as $p) {
            $k = $p['key'];
            $payload[$k] = isset($b[$k]) && is_string($b[$k]) ? trim($b[$k]) : '';
        }
        Store::put('social_media', $payload);
        \Http::json(['saved' => true]);
    }

    /** Inject the social links block into every page footer. */
    public static function handleSync(): void
    {
        $stored = Store::get('social_media', null);
        if (!is_array($stored)) \Http::error('Önce sosyal medya bağlantılarını kaydedin.', 400);
        \Backup::snapshot();
        \Http::json(\SocialSync::syncSocialMedia(array_merge(self::defaults(), $stored)));
    }
}
