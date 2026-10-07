<?php
/* Local preview only: creates the SQLite tables and loads private/seed.json.  Usage: php init_sqlite.php <site-folder> */
define('LOFAN', 1);
$site = rtrim($argv[1] ?? '.', '/\\');
require $site . '/private/lib.php';
install_schema();
$seedFile = $site . '/private/seed.json';
seed_db(is_file($seedFile) ? (json_decode(file_get_contents($seedFile), true) ?: []) : []);
echo "preview database ready\n";
