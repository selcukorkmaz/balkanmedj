<?php
/**
 * Balkan Medical Journal — Admin (PHP) configuration.
 * Copy to config.php and fill in real values. config.php is gitignored.
 */
return [
    'db' => [
        'host'    => '127.0.0.1',
        'port'    => 3306,
        'name'    => 'balkanmedj',
        'user'    => 'balkanmedj',
        'pass'    => 'CHANGE_ME',
        'charset' => 'utf8mb4',
    ],

    // Absolute path to the public-site project root (where js/data, images, css
    // live). admin-php sits inside the repo, so the parent dir is the root.
    'project_root' => dirname(__DIR__),

    // URL base the admin panel is served under. '/yonetim' if hosted in a
    // subdirectory; '' if the admin has its own domain/subdomain at the root.
    'base_path' => '/yonetim',

    // Public site base URL used by the SEO generator (sitemap.xml / rss.xml).
    'site_base_url' => 'https://www.balkanmedicaljournal.org',

    // true on the production host (enables Secure cookies, hides error detail).
    'is_prod' => false,
];
