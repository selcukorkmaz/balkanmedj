<?php
/**
 * Short-link manager — code -> page map (DB `short_links` table) + static
 * /s/<code>.html redirect files. PHP port of admin/lib/short-links.js.
 */
class ShortLinks
{
    private const RESERVED = ['admin', 'api', 'login', 'logout', 's', 'js', 'css', 'images', 'index', 'site', 'imports', 'data', 'files'];

    private static function dir(): string { return \Config::projectRoot() . '/s'; }

    private static function readStore(): array
    {
        $map = [];
        foreach (\Db::all('SELECT code, data FROM short_links') as $r) {
            $map[$r['code']] = json_decode($r['data'], true);
        }
        return $map;
    }
    private static function put(string $code, array $data): void
    {
        \Db::run('INSERT INTO short_links (code, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data=VALUES(data)',
            [$code, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    }
    private static function del(string $code): void { \Db::run('DELETE FROM short_links WHERE code = ?', [$code]); }

    public static function validateCode($code): ?string
    {
        if (!$code) return 'Kısa link kodu boş olamaz';
        $c = mb_strtolower(trim((string)$code), 'UTF-8');
        if (strlen($c) < 2) return 'En az 2 karakter olmalı';
        if (strlen($c) > 30) return 'En fazla 30 karakter olabilir';
        if (!preg_match('/^[a-z0-9][a-z0-9-]*[a-z0-9]$/', $c) && !preg_match('/^[a-z0-9]$/', $c)) {
            return 'Yalnızca küçük harf, rakam ve tire — başta/sonda tire olamaz';
        }
        if (in_array($c, self::RESERVED, true)) return "\"$c\" rezerve bir kod, başka bir şey seçin";
        return null;
    }
    public static function normalizeCode($code): string
    {
        $c = mb_strtolower(trim((string)$code), 'UTF-8');
        $c = preg_replace('/[^a-z0-9-]/', '', $c);
        $c = preg_replace('/-+/', '-', $c);
        return preg_replace('/^-|-$/', '', $c);
    }

    private static function ensureDir(): void { if (!is_dir(self::dir())) mkdir(self::dir(), 0775, true); }

    private static function buildRedirectHtml(string $targetFile, ?string $title): string
    {
        $target = '../' . $targetFile;
        $t = $title ?: $targetFile;
        $jsTarget = json_encode($target, JSON_UNESCAPED_SLASHES);
        return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            . "<title>Redirecting… — Balkan Medical Journal</title>\n"
            . "<meta http-equiv=\"refresh\" content=\"0; url=$target\">\n"
            . "<link rel=\"canonical\" href=\"/$targetFile\">\n"
            . "<meta name=\"robots\" content=\"noindex,follow\">\n"
            . "<style>body{font-family:Inter,system-ui,sans-serif;background:#f9fafb;color:#374151;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem;text-align:center}main{max-width:480px}a{color:#0f766e;text-decoration:underline}</style>\n"
            . "</head>\n<body>\n<main>\n<p>Yönlendiriliyor: <strong>$t</strong>…</p>\n"
            . "<p>Otomatik açılmazsa <a href=\"$target\">buraya tıklayın</a>.</p>\n</main>\n"
            . "<script>location.replace($jsTarget);</script>\n</body>\n</html>\n";
    }
    private static function writeRedirectFile(string $code, string $targetFile, ?string $title): void
    {
        self::ensureDir();
        file_put_contents(self::dir() . "/$code.html", self::buildRedirectHtml($targetFile, $title));
    }
    private static function deleteRedirectFile(string $code): void
    {
        $f = self::dir() . "/$code.html";
        if (is_file($f)) @unlink($f);
    }
    private static function rebuildIndex(array $map): void
    {
        self::ensureDir();
        ksort($map);
        $rows = '';
        foreach ($map as $code => $info) {
            $label = $info['title'] ?? $info['targetFile'];
            $rows .= "      <tr><td><a href=\"$code.html\"><code>/s/$code</code></a></td><td>$label</td><td><a href=\"../{$info['targetFile']}\">{$info['targetFile']}</a></td></tr>\n";
        }
        $n = count($map);
        $body = $rows ?: '<tr><td colspan="3" style="text-align:center;color:#9ca3af">Henüz tanımlı kısa link yok.</td></tr>';
        $html = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Short Links — Balkan Medical Journal</title>\n"
            . "<meta name=\"robots\" content=\"noindex,nofollow\">\n"
            . "<style>body{font-family:Inter,system-ui,sans-serif;color:#111827;max-width:760px;margin:2rem auto;padding:0 1rem}h1{font-size:1.25rem}table{width:100%;border-collapse:collapse;margin-top:1rem;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb}th{color:#6b7280;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.04em}code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}a{color:#0f766e}</style>\n"
            . "</head>\n<body>\n<h1>Short Links</h1>\n<p style=\"color:#6b7280;font-size:13px\">$n active redirect" . ($n === 1 ? '' : 's') . ". Yönetim için admin panelini kullanın.</p>\n"
            . "<table>\n<thead><tr><th>Short URL</th><th>Sayfa</th><th>Hedef Dosya</th></tr></thead>\n<tbody>\n$body\n</tbody>\n</table>\n</body>\n</html>\n";
        file_put_contents(self::dir() . '/index.html', $html);
    }

    public static function setCode(string $slug, $code, string $targetFile, ?string $title): array
    {
        $err = self::validateCode($code);
        if ($err) throw new \HttpError($err, 400);
        $c = self::normalizeCode($code);
        $map = self::readStore();
        if (isset($map[$c]) && ($map[$c]['slug'] ?? null) !== $slug) {
            throw new \HttpError("Bu kısa link kodu \"$c\" zaten \"{$map[$c]['slug']}\" sayfası için kullanılıyor", 400);
        }
        foreach ($map as $oldCode => $v) {
            if (($v['slug'] ?? null) === $slug && $oldCode !== $c) { self::del($oldCode); self::deleteRedirectFile($oldCode); unset($map[$oldCode]); }
        }
        $data = ['slug' => $slug, 'targetFile' => $targetFile, 'title' => $title, 'createdAt' => $map[$c]['createdAt'] ?? gmdate('c')];
        self::put($c, $data);
        $map[$c] = $data;
        self::writeRedirectFile($c, $targetFile, $title);
        self::rebuildIndex($map);
        return ['code' => $c] + $data;
    }
    public static function removeCode($code): bool
    {
        $c = self::normalizeCode($code);
        $map = self::readStore();
        if (!isset($map[$c])) return false;
        self::del($c);
        unset($map[$c]);
        self::deleteRedirectFile($c);
        self::rebuildIndex($map);
        return true;
    }
    public static function removeBySlug(string $slug): bool
    {
        foreach (self::readStore() as $code => $v) if (($v['slug'] ?? null) === $slug) return self::removeCode($code);
        return false;
    }
    public static function getBySlug(string $slug): ?array
    {
        foreach (self::readStore() as $code => $v) if (($v['slug'] ?? null) === $slug) return ['code' => $code] + $v;
        return null;
    }
    public static function listAll(): array
    {
        $out = [];
        foreach (self::readStore() as $code => $v) $out[] = ['code' => $code] + $v;
        return $out;
    }
}
