<?php
/* Local test server only (php -S ... router.php).  On cPanel the .htaccess does this job.
   Two modes: the project folder itself (daily editing), or a built package folder (build_hosting_package.py --preview). */
$p = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$root = is_file(__DIR__ . '/api/index.php') ? __DIR__ : dirname(__DIR__, 2);                  // built package vs project folder
$api = is_file($root . '/api/index.php') ? $root . '/api/index.php' : $root . '/hosting/api/index.php';

if (strpos($p, '/api/') === 0) { $_SERVER['SCRIPT_NAME'] = '/api/index.php'; require $api; return true; }
if ($p === '/.well-known/apple-developer-merchantid-domain-association.txt') { $_GET['__wk'] = 'apple'; require $api; return true; }
// never expose server code, databases or secrets – same rules as the live .htaccess
if (preg_match('#^/(private|hosting|data|legacy|dist|\.git|\.vscode)(/|$)#', $p) || preg_match('#\.(py|bat|ps1|db|sqlite|sql|log|lock|flag|ini|md|yml)$#i', $p) || preg_match('#^/install\.php$#', $p) && !is_file($root . '/install.php')) {
    http_response_code(403); echo 'Forbidden'; return true;
}
return false;   // everything else (html, css, js, images, video) is served as a normal file
