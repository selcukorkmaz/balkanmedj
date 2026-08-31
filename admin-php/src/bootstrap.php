<?php
/**
 * Shared bootstrap: PSR-style autoloader for admin-php/src + config load.
 * Required by the web front controller and by CLI scripts.
 */
declare(strict_types=1);

$SRC = __DIR__;

spl_autoload_register(function (string $class) use ($SRC): void {
    // Class "Repo\Articles" -> src/Repo/Articles.php ; "Db" -> src/Db.php
    $rel = str_replace('\\', '/', $class) . '.php';
    $path = $SRC . '/' . $rel;
    if (is_file($path)) {
        require $path;
    }
});

require $SRC . '/Config.php';
require $SRC . '/Http.php';
Config::load();

mb_internal_encoding('UTF-8');
date_default_timezone_set('UTC');
