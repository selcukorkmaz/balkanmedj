<?php
/**
 * Front controller for /api/*. Apache (.htaccess) rewrites every /api request
 * here. Replaces the Express app in admin/server.js while preserving the same
 * JSON contracts so the existing admin UI works unchanged.
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

Auth::startSession();

// --- Resolve the route path (everything after "/api") ----------------------
$uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$pos  = strpos($uri, '/api');
$path = $pos === false ? '/' : substr($uri, $pos + 4);
if ($path === '' || $path === false) $path = '/';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    // Mirror Express requireAuth: only /auth/* is open; everything else needs a session.
    if (strncmp($path, '/auth/', 6) !== 0) {
        Auth::requireUser();
    }

    /** @var Router $router */
    $router = require dirname(__DIR__) . '/src/routes.php';

    if (!$router->dispatch($method, $path)) {
        Http::error("Bu işlem rotası bulunamadı ($path)", 404);
    }
} catch (HttpError $e) {
    Http::error($e->getMessage(), $e->status);
} catch (Throwable $e) {
    if (Config::isProd()) {
        error_log('[api] ' . $e->getMessage());
        Http::error('Sunucu hatası', 500);
    }
    Http::error($e->getMessage(), 400);
}
