<?php
/**
 * One-time data migration: parse the public site's flat data files into MySQL.
 * Idempotent — uses INSERT ... ON DUPLICATE KEY UPDATE, safe to re-run.
 * Usage: php admin-php/cli/migrate.php
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

$ROOT = Config::projectRoot();
$DATA = $ROOT . '/js/data';
$pdo  = Db::pdo();

/** Lenient date -> 'Y-m-d' or null (authoritative value stays in JSON data). */
function toDate($v): ?string
{
    $s = trim((string)$v);
    if ($s === '') return null;
    if (preg_match('/^\d{4}-\d{2}-\d{2}/', $s, $m)) return substr($s, 0, 10);
    $ts = strtotime($s);
    return $ts ? date('Y-m-d', $ts) : null;
}

function asInt($v): ?int { return is_numeric($v) ? (int)$v : null; }
function jenc($v): string { return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }

function readFullText(string $dataDir, $id): ?string
{
    $html = $dataDir . '/articles/' . $id . '.html';
    if (is_file($html)) return (string)file_get_contents($html);
    return null;
}

// --- Articles ---------------------------------------------------------------
$articles = JsFile::read("$DATA/articles.js", 'ARTICLES');
$n = 0;
$stmt = $pdo->prepare(
    'INSERT INTO articles (id, seq, type, volume, issue, featured, image_corner, citations, downloads, published, data)
     VALUES (:id,:seq,:type,:volume,:issue,:featured,:image_corner,:citations,:downloads,:published,:data)
     ON DUPLICATE KEY UPDATE seq=VALUES(seq), type=VALUES(type), volume=VALUES(volume), issue=VALUES(issue),
       featured=VALUES(featured), image_corner=VALUES(image_corner), citations=VALUES(citations),
       downloads=VALUES(downloads), published=VALUES(published), data=VALUES(data)'
);
$ftStmt = $pdo->prepare(
    'INSERT INTO article_fulltext (article_id, html) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE html=VALUES(html)'
);
foreach ($articles as $seq => $a) {
    if (!isset($a['id'])) continue;
    $stmt->execute([
        'id'           => (int)$a['id'],
        'seq'          => $seq,
        'type'         => $a['type'] ?? null,
        'volume'       => asInt($a['volume'] ?? null),
        'issue'        => isset($a['issue']) ? (string)$a['issue'] : null,
        'featured'     => !empty($a['featured']) ? 1 : 0,
        'image_corner' => !empty($a['imageCorner']) ? 1 : 0,
        'citations'    => (int)($a['citations'] ?? 0),
        'downloads'    => (int)($a['downloads'] ?? 0),
        'published'    => toDate($a['published'] ?? ($a['publishedOnline'] ?? '')),
        'data'         => jenc($a),
    ]);
    $ft = readFullText($DATA, $a['id']);
    if ($ft !== null) $ftStmt->execute([(int)$a['id'], $ft]);
    $n++;
}
echo "articles: $n\n";

// --- Articles in press ------------------------------------------------------
$aip = JsFile::read("$DATA/articles-in-press.js", 'ARTICLES_IN_PRESS');
$n = 0;
$stmt = $pdo->prepare(
    'INSERT INTO articles_in_press (id, sort_order, data) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE sort_order=VALUES(sort_order), data=VALUES(data)'
);
foreach ($aip as $i => $a) {
    if (!isset($a['id'])) continue;
    $stmt->execute([(int)$a['id'], $i, jenc($a)]);
    $ft = readFullText($DATA, $a['id']);
    if ($ft !== null) $ftStmt->execute([(int)$a['id'], $ft]);
    $n++;
}
echo "articles_in_press: $n\n";

// --- News -------------------------------------------------------------------
$news = JsFile::read("$DATA/news.js", 'NEWS');
$n = 0;
$stmt = $pdo->prepare(
    'INSERT INTO news (id, date, data) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE date=VALUES(date), data=VALUES(data)'
);
foreach ($news as $item) {
    if (!isset($item['id'])) continue;
    $stmt->execute([(int)$item['id'], toDate($item['date'] ?? ''), jenc($item)]);
    $n++;
}
echo "news: $n\n";

// --- Singletons (single-blob datasets) --------------------------------------
function putSingleton(PDO $pdo, string $name, $data): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO singletons (name, data) VALUES (?,?)
         ON DUPLICATE KEY UPDATE data=VALUES(data)'
    );
    $stmt->execute([$name, jenc($data)]);
}

$singletons = [
    'editorial_board'    => ["$DATA/editorial-board.js",    'EDITORIAL_BOARD'],
    'editorial_extended' => ["$DATA/editorial-extended.js", 'EDITORIAL_EXTENDED'],
    'author_metadata'    => ["$DATA/author-metadata.js",    'AUTHOR_METADATA'],
    'archive_issues'     => ["$DATA/archive-issues.js",     'ARCHIVE_ISSUES'],
    'homepage'           => ["$DATA/homepage-articles.js",  'HOMEPAGE_DATA'],
];
foreach ($singletons as $name => [$path, $var]) {
    if (!is_file($path)) { echo "  (skip $name — no file)\n"; continue; }
    putSingleton($pdo, $name, JsFile::read($path, $var));
    echo "singleton: $name\n";
}

// Admin-managed JSON datasets (from the Node admin/data dir).
$adminData = $ROOT . '/admin/data';
$jsonSingletons = [
    'article_types' => "$adminData/article-types.json",
    'nav_footer'    => "$adminData/nav-footer.json",
    'social_media'  => "$adminData/social-media.json",
];
foreach ($jsonSingletons as $name => $path) {
    $data = JsFile::readJson($path);
    if ($data === null) { echo "  (skip $name — no file)\n"; continue; }
    putSingleton($pdo, $name, $data);
    echo "singleton: $name\n";
}

// --- Custom pages -----------------------------------------------------------
$customPages = JsFile::readJson("$adminData/custom-pages.json") ?: [];
$shortCodes  = JsFile::readJson("$adminData/page-short-codes.json") ?: [];
$pageStmt = $pdo->prepare(
    'INSERT INTO pages (slug, title, description, short_code, html, data) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description),
       short_code=VALUES(short_code), html=VALUES(html), data=VALUES(data)'
);
$pc = 0;
foreach ($customPages as $p) {
    $slug = $p['slug'] ?? null;
    if (!$slug) continue;
    $htmlPath = $ROOT . '/' . $slug . '.html';
    $html = is_file($htmlPath) ? (string)file_get_contents($htmlPath) : null;
    $pageStmt->execute([
        $slug, $p['title'] ?? null, $p['description'] ?? null,
        $shortCodes[$slug] ?? null, $html, jenc($p),
    ]);
    $pc++;
}
echo "custom pages: $pc\n";

echo "migration done\n";
