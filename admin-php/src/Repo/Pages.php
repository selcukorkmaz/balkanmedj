<?php
namespace Repo;

/**
 * Editable pages: built-in site pages (content between <main id="main-content">)
 * plus custom pages stored in the `pages` table. Port of admin/server.js pages
 * routes + listAllPages/findPage.
 */
class Pages
{
    private const BUILTIN = [
        ['slug' => 'index', 'file' => 'index.html', 'title' => 'Ana Sayfa'],
        ['slug' => 'about', 'file' => 'about.html', 'title' => 'About the Journal'],
        ['slug' => 'for-authors', 'file' => 'for-authors.html', 'title' => 'For Authors'],
        ['slug' => 'for-reviewers', 'file' => 'for-reviewers.html', 'title' => 'For Reviewers'],
        ['slug' => 'policies', 'file' => 'policies.html', 'title' => 'Policies'],
        ['slug' => 'contact', 'file' => 'contact.html', 'title' => 'Contact'],
        ['slug' => 'forms', 'file' => 'forms.html', 'title' => 'Forms'],
        ['slug' => 'journal-metrics', 'file' => 'journal-metrics.html', 'title' => 'Journal Metrics'],
    ];

    private static function customPages(): array
    {
        $out = [];
        foreach (\Db::all('SELECT slug, title, description, data FROM pages') as $r) {
            $d = $r['data'] ? json_decode($r['data'], true) : [];
            $out[] = [
                'slug' => $r['slug'], 'file' => $d['file'] ?? ($r['slug'] . '.html'),
                'title' => $r['title'], 'description' => $r['description'],
                'createdAt' => $d['createdAt'] ?? null, 'custom' => true,
            ];
        }
        return $out;
    }

    private static function listAll(): array
    {
        $builtins = array_map(fn($p) => $p + ['custom' => false], self::BUILTIN);
        $all = array_merge($builtins, self::customPages());
        return array_map(function ($p) {
            $entry = \ShortLinks::getBySlug($p['slug']);
            $p['shortCode'] = $entry ? $entry['code'] : null;
            return $p;
        }, $all);
    }

    private static function find(string $slug): ?array
    {
        foreach (self::listAll() as $p) if ($p['slug'] === $slug) return $p;
        return null;
    }

    public static function handleList(): void { \Http::json(self::listAll()); }
    public static function handleShortLinks(): void { \Http::json(\ShortLinks::listAll()); }

    public static function handleGet(array $p): void
    {
        $page = self::find($p['slug']);
        if (!$page) \Http::error('Page not found', 404);
        $filePath = \Config::projectRoot() . '/' . $page['file'];
        if (!is_file($filePath)) \Http::error('Page not found', 404);
        $html = (string)file_get_contents($filePath);

        $content = preg_match('/<main\s+id="main-content"[^>]*>(.*?)<\/main>/s', $html, $m) ? trim($m[1]) : '';
        $sections = [];
        if (preg_match_all('/<section[^>]*>(.*?)<\/section>/s', $content, $secs)) {
            foreach ($secs[1] as $block) {
                $heading = preg_match('/<h2[^>]*>(.*?)<\/h2>/s', $block, $hm) ? trim(preg_replace('/<[^>]+>/', '', $hm[1])) : '';
                if (preg_match('/<div[^>]*class="[^"]*prose[^"]*"[^>]*>(.*)<\/div>\s*$/s', $block, $pm)) $body = trim($pm[1]);
                elseif ($heading !== '' && ($pos = strpos($block, '</h2>')) !== false) $body = trim(substr($block, $pos + 5));
                else $body = trim($block);
                $sections[] = ['heading' => $heading, 'body' => $body];
            }
        }
        \Http::json($page + ['content' => $content, 'sections' => $sections]);
    }

    public static function handlePut(array $p): void
    {
        \Backup::snapshot();
        $page = self::find($p['slug']);
        if (!$page) \Http::error('Page not found', 404);
        $filePath = \Config::projectRoot() . '/' . $page['file'];
        if (!is_file($filePath)) \Http::error('Page not found', 404);
        $html = (string)file_get_contents($filePath);
        $newContent = (string)(\Http::body()['content'] ?? '');
        $repl = '${1}' . "\n" . str_replace(['\\', '$'], ['\\\\', '\\$'], $newContent) . "\n" . '${3}';
        $html = preg_replace('/(<main\s+id="main-content"[^>]*>)(.*?)(<\/main>)/s', $repl, $html, 1);
        \JsFile::atomicPut($filePath, $html);
        \Http::json(['saved' => true, 'slug' => $page['slug']]);
    }

    public static function handleCreate(): void
    {
        $b = \Http::body();
        $title = trim((string)($b['title'] ?? ''));
        $description = trim((string)($b['description'] ?? ''));
        $rawSlug = !empty($b['slug']) ? (string)$b['slug'] : $title;
        $slug = \PageTemplate::normalizeSlug($rawSlug);
        if (!$title) \Http::error('Başlık gerekli', 400);
        $slugErr = \PageTemplate::validateSlug($slug);
        if ($slugErr) \Http::error($slugErr, 400);
        if (self::find($slug)) \Http::error('Bu slug zaten kullanılıyor', 409);
        $file = "$slug.html";
        $filePath = \Config::projectRoot() . "/$file";
        if (is_file($filePath)) \Http::error('Aynı isimde bir HTML dosyası zaten var', 409);

        \Backup::snapshot();
        \JsFile::atomicPut($filePath, \PageTemplate::createPageHtml($slug, $title, $description));
        $data = ['slug' => $slug, 'file' => $file, 'title' => $title, 'description' => $description, 'createdAt' => gmdate('c')];
        \Db::run('INSERT INTO pages (slug, title, description, html, data) VALUES (?,?,?,?,?)
                  ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description), data=VALUES(data)',
            [$slug, $title, $description, null, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
        \Http::json(['created' => true, 'slug' => $slug, 'file' => $file, 'title' => $title]);
    }

    public static function handleDelete(array $p): void
    {
        $slug = $p['slug'];
        $row = \Db::row('SELECT slug, data FROM pages WHERE slug = ?', [$slug]);
        if (!$row) \Http::error('Özel sayfa bulunamadı (sistem sayfaları silinemez)', 404);
        \Backup::snapshot();
        $d = $row['data'] ? json_decode($row['data'], true) : [];
        $file = $d['file'] ?? ($slug . '.html');
        @unlink(\Config::projectRoot() . "/$file");
        \Db::run('DELETE FROM pages WHERE slug = ?', [$slug]);
        try { \ShortLinks::removeBySlug($slug); } catch (\Throwable $e) { /* non-fatal */ }
        \Http::json(['deleted' => true, 'slug' => $slug]);
    }

    public static function handleSetShortCode(array $p): void
    {
        $page = self::find($p['slug']);
        if (!$page) \Http::error('Sayfa bulunamadı', 404);
        $code = trim((string)(\Http::body()['code'] ?? ''));
        $entry = \ShortLinks::setCode($page['slug'], $code, $page['file'], $page['title']);
        \Http::json(['shortCode' => $entry['code'], 'targetFile' => $entry['targetFile']]);
    }

    public static function handleRemoveShortCode(array $p): void
    {
        $ok = \ShortLinks::removeBySlug($p['slug']);
        \Http::json(['removed' => $ok]);
    }
}
