<?php
/* LOFAN – API front controller. Apache rewrites /api/anything to this file (see .htaccess). */
define('LOFAN', 1);
ini_set('display_errors', '0');
error_reporting(E_ALL);
require __DIR__ . '/../private/lib.php';
ini_set('log_errors', '1');
ini_set('error_log', priv_dir() . '/error.log');
require __DIR__ . '/../private/routes.php';

function send_json($code, $obj)
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
}

/* Apple Pay domain-verification file (the text is pasted in Admin > Company & Payments > Apple Pay) */
if (($_GET['__wk'] ?? '') === 'apple') {
    $txt = '';
    try { $txt = (string)get_settings()['applepay']['domainFile']; } catch (Throwable $e) { /* not installed */ }
    http_response_code($txt !== '' ? 200 : 404);
    header('Content-Type: text/plain; charset=utf-8');
    echo $txt !== '' ? $txt : 'Not found';
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'HEAD') $method = 'GET';
if ($method === 'OPTIONS') { http_response_code(204); exit; }

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
$pos = strpos($uri, '/api/');
$route = $pos === false ? '' : trim(substr($uri, $pos + 5), '/');

if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8000000) { send_json(413, ['error' => 'Request too large']); exit; }
$body = file_get_contents('php://input');

$pdo = null;
try {
    $pdo = db();
    if ($method !== 'GET') $pdo->beginTransaction();
    $res = handle_api($method, $route, $body);
    if ($pdo->inTransaction()) $pdo->commit();
    if ($res[0] === 'raw') {
        header('Content-Type: ' . $res[2]);
        header('Content-Disposition: inline; filename="' . $res[3] . '"');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo $res[1];
    } else {
        send_json($res[0], $res[1]);
    }
} catch (ApiError $e) {
    if ($pdo && $pdo->inTransaction()) $pdo->rollBack();
    send_json($e->getCode() ?: 400, $e->field ? ['error' => $e->getMessage(), 'field' => $e->field] : ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    if ($pdo && $pdo->inTransaction()) { try { $pdo->rollBack(); } catch (Throwable $x) { /* ignore */ } }
    error_log('API error on ' . $method . ' /' . $route . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    send_json(500, ['error' => 'Server error']);
}
