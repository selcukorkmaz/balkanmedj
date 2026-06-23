<?php
/**
 * Apply schema.sql and seed the admin user from admin/auth-config.json.
 * Idempotent: safe to re-run. Usage: php admin-php/cli/init-db.php
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

// --- Apply schema -----------------------------------------------------------
$schema = file_get_contents(dirname(__DIR__) . '/schema.sql');
if ($schema === false) {
    fwrite(STDERR, "schema.sql not found\n");
    exit(1);
}

$pdo = Db::pdo();
foreach (array_filter(array_map('trim', explode(';', $schema))) as $stmt) {
    // Skip pure comment fragments
    $lines = array_filter(array_map('trim', explode("\n", $stmt)), fn($l) => $l !== '' && strncmp($l, '--', 2) !== 0);
    if (!$lines) continue;
    $pdo->exec($stmt);
}
echo "schema applied\n";

// --- Seed admin user --------------------------------------------------------
$authPath = Config::projectRoot() . '/admin/auth-config.json';
if (is_file($authPath)) {
    $cfg = json_decode((string)file_get_contents($authPath), true);
    if (!empty($cfg['username']) && !empty($cfg['passwordHash'])) {
        Db::run(
            'INSERT INTO admin_users (username, password_hash) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
            [$cfg['username'], $cfg['passwordHash']]
        );
        echo "seeded admin user: {$cfg['username']}\n";
    } else {
        fwrite(STDERR, "auth-config.json missing username/passwordHash — admin user not seeded\n");
    }
} else {
    fwrite(STDERR, "admin/auth-config.json not found — admin user not seeded\n");
}

echo "done\n";
