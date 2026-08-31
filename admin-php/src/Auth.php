<?php
/**
 * Session auth + bcrypt + login rate limiting.
 * Mirrors the contracts of admin/server.js /api/auth/* routes.
 */
class Auth
{
    private const WINDOW = 900;  // 15 minutes
    private const MAX    = 10;   // attempts per window per IP

    /** Start the PHP session with cookie settings matching the Node panel. */
    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) return;
        session_name('bmj_session');
        session_set_cookie_params([
            'lifetime' => 24 * 60 * 60,
            'path'     => Config::basePath() ?: '/',
            'httponly' => true,
            'samesite' => 'Strict',
            'secure'   => Config::isProd(),
        ]);
        session_start();
    }

    public static function currentUser(): ?string
    {
        return $_SESSION['user'] ?? null;
    }

    /** Throw 401 unless authenticated (used for every non-auth /api route). */
    public static function requireUser(): string
    {
        $u = self::currentUser();
        if (!$u) throw new HttpError('Oturum süresi doldu. Lütfen tekrar giriş yapın.', 401);
        return $u;
    }

    // --- Routes ---------------------------------------------------------------

    public static function login(): void
    {
        if (self::isRateLimited()) {
            Http::error('Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.', 429);
        }
        self::recordAttempt();

        $b = Http::body();
        $username = trim((string)($b['username'] ?? ''));
        $password = (string)($b['password'] ?? '');
        if ($username === '' || $password === '') {
            Http::error('Kullanıcı adı ve şifre gerekli', 400);
        }

        $hash = Db::scalar('SELECT password_hash FROM admin_users WHERE username = ?', [$username]);
        if (!$hash || !password_verify($password, $hash)) {
            Http::error('Kullanıcı adı veya şifre hatalı', 401);
        }

        session_regenerate_id(true);
        $_SESSION['user'] = $username;
        Http::json(['ok' => true, 'user' => $username]);
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', $p['secure'], $p['httponly']);
        }
        session_destroy();
        Http::json(['ok' => true]);
    }

    public static function me(): void
    {
        $u = self::currentUser();
        if ($u) Http::json(['user' => $u]);
        Http::error('Not authenticated', 401);
    }

    public static function changePassword(): void
    {
        $u = self::currentUser();
        if (!$u) Http::error('Not authenticated', 401);

        $b = Http::body();
        $current = (string)($b['currentPassword'] ?? '');
        $new     = (string)($b['newPassword'] ?? '');
        if ($current === '' || $new === '') Http::error('Mevcut ve yeni şifre gerekli', 400);
        if (strlen($new) < 6) Http::error('Yeni şifre en az 6 karakter olmalı', 400);

        $hash = Db::scalar('SELECT password_hash FROM admin_users WHERE username = ?', [$u]);
        if (!$hash || !password_verify($current, $hash)) {
            Http::error('Mevcut şifre hatalı', 401);
        }

        $newHash = password_hash($new, PASSWORD_BCRYPT);
        Db::run('UPDATE admin_users SET password_hash = ? WHERE username = ?', [$newHash, $u]);
        Http::json(['ok' => true]);
    }

    // --- Rate limiting (DB-backed, per IP) -----------------------------------

    private static function isRateLimited(): bool
    {
        $since = time() - self::WINDOW;
        $n = (int)Db::scalar(
            'SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND attempted_at >= ?',
            [Http::ip(), $since]
        );
        return $n >= self::MAX;
    }

    private static function recordAttempt(): void
    {
        Db::run('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)', [Http::ip(), time()]);
        // Opportunistic cleanup of old rows.
        Db::run('DELETE FROM login_attempts WHERE attempted_at < ?', [time() - self::WINDOW]);
    }
}
