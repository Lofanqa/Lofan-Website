<?php
/* Local preview only (php -S ... router.php). On cPanel the .htaccess does this job. */
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (strpos($p, '/api/') === 0) { $_SERVER['SCRIPT_NAME'] = '/api/index.php'; require __DIR__ . '/api/index.php'; return true; }
if ($p === '/.well-known/apple-developer-merchantid-domain-association.txt') { $_GET['__wk'] = 'apple'; require __DIR__ . '/api/index.php'; return true; }
if (strpos($p, '/private') === 0 || preg_match('#\.(py|db|sqlite|log|bat|lock|flag)$#', $p)) { http_response_code(403); echo 'Forbidden'; return true; }
return false;
