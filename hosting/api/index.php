<?php
/* LOFAN – API front controller. Apache rewrites /api/anything to this file (see .htaccess). */
define('LOFAN', 1);
ini_set('display_errors', '0');
error_reporting(E_ALL);
require __DIR__ . '/../private/lib.php';
ini_set('log_errors', '1');
ini_set('error_log', priv_dir() . '/error.log');
require __DIR__ . '/../private/extras.php';
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
$GLOBALS['ALERT_QUEUE'] = [];
$GLOBALS['LOG_ALWAYS'] = [];
try {
    $pdo = db();
    migrate();            // upgrades the database automatically after you upload a newer version (your data is kept)
    expire_unpaid();      // releases orders that were never paid
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
    $GLOBALS['ALERT_QUEUE'] = [];           // nothing was saved, so nothing to announce
    send_json($e->getCode() ?: 400, $e->field ? ['error' => $e->getMessage(), 'field' => $e->field] : ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    if ($pdo && $pdo->inTransaction()) { try { $pdo->rollBack(); } catch (Throwable $x) { /* ignore */ } }
    $GLOBALS['ALERT_QUEUE'] = [];
    error_log('API error on ' . $method . ' /' . $route . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    send_json(500, ['error' => 'Server error']);
}

/* After the answer is on its way to the visitor: send SMS / Telegram alerts and keep failed-sign-in log entries.
   (The customer never waits for the SMS provider.) */
if (!empty($GLOBALS['ALERT_QUEUE']) || !empty($GLOBALS['LOG_ALWAYS'])) {
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    elseif (function_exists('litespeed_finish_request')) litespeed_finish_request();
    else { while (ob_get_level() > 0) @ob_end_flush(); @flush(); }
    try {
        flush_always_logs();
        send_queued_alerts();
    } catch (Throwable $e) {
        error_log('post-response tasks failed: ' . $e->getMessage());
    }
}
