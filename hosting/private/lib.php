<?php
/* =====================================================================
   LOFAN – backend library (PHP 7.4+).  Runs on normal cPanel hosting with MySQL/MariaDB.
   (SQLite is supported only so the code can be tested on a PC without MySQL.)
   This is a port of the local Python server, so the website pages work unchanged.
   ===================================================================== */
defined('LOFAN') or exit;

const CURRENCY = 'QAR';
const STATUSES = ['Awaiting payment', 'Payment submitted', 'Payment confirmed', 'Preparing', 'Out for delivery', 'Delivered', 'Cancelled'];
date_default_timezone_set('Asia/Qatar');

class ApiError extends Exception
{
    public $field;
    public function __construct($code, $msg, $field = null)
    {
        parent::__construct($msg, $code);
        $this->field = $field;
    }
}

function priv_dir() { return __DIR__; }
function root_dir()
{
    static $r = null;
    if ($r === null) {
        $r = dirname(__DIR__);
        $f = __DIR__ . '/config.php';
        if (is_file($f)) { $c = require $f; if (is_array($c) && !empty($c['root'])) $r = $c['root']; }   // local test server serves the project folder itself
    }
    return $r;
}
function receipts_dir() { return __DIR__ . '/receipts'; }
function identity_pem() { return __DIR__ . '/applepay/identity.pem'; }
function product_img_dir() { return root_dir() . '/images/products'; }
function now() { return time(); }

/* ------------------------------------------------------------------ database */
function cfg()
{
    static $c = null;
    if ($c === null) {
        $f = __DIR__ . '/config.php';
        if (!is_file($f)) throw new ApiError(503, 'The website is not installed yet. Please open /install.php first.');
        $c = require $f;
    }
    return $c;
}

function db()
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = cfg();
    if (($c['driver'] ?? 'mysql') === 'sqlite') {
        $pdo = new PDO('sqlite:' . $c['path']);
        $pdo->exec('PRAGMA busy_timeout=8000');
    } else {
        $pdo = new PDO('mysql:host=' . $c['host'] . ';dbname=' . $c['name'] . ';charset=utf8mb4', $c['user'], $c['pass'],
            [PDO::ATTR_EMULATE_PREPARES => false]);
        $pdo->exec("SET NAMES utf8mb4");
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    return $pdo;
}

function q($sql, $params = [])
{
    $st = db()->prepare($sql);
    $i = 1;
    foreach ($params as $v) {
        if ($v === null) $st->bindValue($i, null, PDO::PARAM_NULL);
        elseif (is_bool($v)) $st->bindValue($i, $v ? 1 : 0, PDO::PARAM_INT);
        elseif (is_int($v)) $st->bindValue($i, $v, PDO::PARAM_INT);
        else $st->bindValue($i, (string)$v, PDO::PARAM_STR);
        $i++;
    }
    $st->execute();
    return $st;
}
function q_all($sql, $p = []) { return q($sql, $p)->fetchAll(); }
function q_one($sql, $p = []) { $r = q($sql, $p)->fetch(); return $r === false ? null : $r; }
function q_val($sql, $p = []) { $r = q($sql, $p)->fetch(PDO::FETCH_NUM); return $r ? $r[0] : null; }
function q_exec($sql, $p = []) { return q($sql, $p)->rowCount(); }
function q_insert($sql, $p = []) { q($sql, $p); return (int)db()->lastInsertId(); }

function schema_statements($driver)
{
    $my = $driver !== 'sqlite';
    $pk = $my ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $tail = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
    $k = function ($s) use ($my) { return $my ? ", KEY $s" : ''; };
    return [
        "CREATE TABLE IF NOT EXISTS users(id $pk, name VARCHAR(120), email VARCHAR(190) UNIQUE, phone VARCHAR(40) UNIQUE,
            address VARCHAR(400) DEFAULT '', salt VARCHAR(64), `hash` VARCHAR(255), role VARCHAR(20) DEFAULT 'customer', created BIGINT,
            google_sub VARCHAR(100), lat DOUBLE, lng DOUBLE, loc_at BIGINT, admin_level VARCHAR(10), disabled INT DEFAULT 0, last_login BIGINT)$tail",
        "CREATE TABLE IF NOT EXISTS sessions(token VARCHAR(100) PRIMARY KEY, user_id INT, expires BIGINT, ip VARCHAR(64), ua VARCHAR(255),
            created BIGINT, last_seen BIGINT" . $k('s_user (user_id)') . ")$tail",
        "CREATE TABLE IF NOT EXISTS admin_log(id $pk, user_id INT, admin_name VARCHAR(120), action VARCHAR(60), detail VARCHAR(600), ip VARCHAR(64),
            ua VARCHAR(255), created BIGINT" . $k('l_created (created)') . ")$tail",
        "CREATE TABLE IF NOT EXISTS categories(`key` VARCHAR(100) PRIMARY KEY, label VARCHAR(200), sort INT DEFAULT 0)$tail",
        "CREATE TABLE IF NOT EXISTS products(id $pk, name VARCHAR(200), cat VARCHAR(100), price INT, stock INT, img VARCHAR(300),
            `desc` VARCHAR(600) DEFAULT '', active INT DEFAULT 1)$tail",
        "CREATE TABLE IF NOT EXISTS orders(id VARCHAR(20) PRIMARY KEY, user_id INT, created BIGINT, items TEXT, subtotal INT, shipping INT, total INT,
            delivery TEXT, method VARCHAR(100), txn VARCHAR(100), receipt VARCHAR(200), status VARCHAR(40)" . $k('o_user (user_id)') . $k('o_status (status)') . ")$tail",
        "CREATE TABLE IF NOT EXISTS order_events(id $pk, order_id VARCHAR(20), status VARCHAR(40), note VARCHAR(400), created BIGINT" . $k('e_order (order_id)') . ")$tail",
        "CREATE TABLE IF NOT EXISTS notifications(id $pk, kind VARCHAR(20), title VARCHAR(300), body TEXT, ref VARCHAR(100), created BIGINT, `read` INT DEFAULT 0)$tail",
        "CREATE TABLE IF NOT EXISTS enquiries(id $pk, name VARCHAR(120), company VARCHAR(160), email VARCHAR(190), phone VARCHAR(50), type VARCHAR(100),
            qty VARCHAR(100), message TEXT, created BIGINT, status VARCHAR(20) DEFAULT 'New')$tail",
        "CREATE TABLE IF NOT EXISTS messages(id $pk, user_id INT, sender VARCHAR(20), body TEXT, created BIGINT, seen INT DEFAULT 0" . $k('m_user (user_id)') . ")$tail",
        "CREATE TABLE IF NOT EXISTS settings(`key` VARCHAR(100) PRIMARY KEY, value MEDIUMTEXT)$tail",
    ];
}

const SCHEMA_VERSION = 2;

function exec_schema()
{
    $driver = cfg()['driver'] ?? 'mysql';
    foreach (schema_statements($driver) as $sql) {
        if ($driver === 'sqlite') $sql = str_replace('MEDIUMTEXT', 'TEXT', $sql);
        db()->exec($sql);
    }
}
function set_schema_version($v)
{
    if (q_val("SELECT 1 FROM settings WHERE `key`='schema_version'")) q_exec("UPDATE settings SET value=? WHERE `key`='schema_version'", [(string)$v]);
    else q_exec("INSERT INTO settings(`key`, value) VALUES('schema_version', ?)", [(string)$v]);
}
function install_schema() { exec_schema(); set_schema_version(SCHEMA_VERSION); }

function column_exists($table, $col)
{
    if ((cfg()['driver'] ?? 'mysql') === 'sqlite') {
        foreach (q_all("PRAGMA table_info($table)") as $r) if ($r['name'] === $col) return true;
        return false;
    }
    return (int)q_val('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [$table, $col]) > 0;
}
/* Upgrades an existing database after you upload a newer version of the website. Runs once, automatically; your data is kept. */
function migrate()
{
    $row = q_one("SELECT value FROM settings WHERE `key`='schema_version'");
    if ($row && (int)$row['value'] >= SCHEMA_VERSION) return;
    exec_schema();                                                     // creates any new tables
    $add = [['users', 'admin_level', 'VARCHAR(10)'], ['users', 'disabled', 'INT DEFAULT 0'], ['users', 'last_login', 'BIGINT'],
        ['sessions', 'ip', 'VARCHAR(64)'], ['sessions', 'ua', 'VARCHAR(255)'], ['sessions', 'created', 'BIGINT'], ['sessions', 'last_seen', 'BIGINT']];
    foreach ($add as $a) {
        if (!column_exists($a[0], $a[1])) {
            try { db()->exec("ALTER TABLE {$a[0]} ADD COLUMN {$a[1]} {$a[2]}"); } catch (Throwable $e) { /* another request did it first */ }
        }
    }
    q_exec("UPDATE users SET admin_level='owner' WHERE role='admin' AND (admin_level IS NULL OR admin_level='')");   // existing admin becomes the owner
    set_schema_version(SCHEMA_VERSION);
}

/* ------------------------------------------------------------------ default settings & seed data */
function default_settings()
{
    return [
        'company' => ['name' => 'Lofan Development & Trading', 'crNumber' => '', 'address' => 'Doha, State of Qatar',
            'phone' => '+974 6640 4222', 'email' => 'info@lofan.qa', 'whatsapp' => '97466404222'],
        'shipping' => ['fee' => 25, 'freeFrom' => 300],
        'google' => ['clientId' => ''],
        'shop' => ['autoDeleteSoldOut' => false],
        // an order is only CONFIRMED after the payment is verified; unpaid orders are released after unpaidHours (0 = never)
        'orders' => ['requireReceipt' => true, 'unpaidHours' => 24],
        'alerts' => [
            'events' => ['placed' => false, 'submitted' => true, 'confirmed' => true],
            'sms' => ['enabled' => false, 'provider' => 'twilio', 'recipients' => ['+97466809657'], 'twilioSid' => '', 'twilioToken' => '', 'from' => '', 'webhookUrl' => ''],
            'telegram' => ['enabled' => false, 'botToken' => '', 'chatId' => ''],
        ],
        'applepay' => ['enabled' => false, 'merchantId' => '', 'displayName' => 'Lofan', 'domain' => '', 'sandbox' => true,
            'publicKey' => '', 'secretKey' => '', 'domainFile' => ''],
        'payments' => [
            'iban' => ['enabled' => true, 'bankName' => '', 'accountName' => 'Lofan Development & Trading', 'accountNumber' => '',
                'iban' => '', 'swift' => '', 'branch' => 'Doha, Qatar'],
            'fawran' => ['enabled' => true, 'alias' => '66404222', 'accountName' => 'Lofan Development & Trading', 'bankName' => ''],
            'ooredoo' => ['enabled' => true, 'number' => '66404222', 'accountName' => 'Lofan Development & Trading'],
        ],
    ];
}

function get_settings()
{
    $row = q_one("SELECT value FROM settings WHERE `key`='settings'");
    $stored = $row ? (json_decode($row['value'], true) ?: []) : [];
    $out = default_settings();
    foreach ($stored as $sec => $val) {
        if (is_array($val) && isset($out[$sec])) {
            foreach ($val as $k => $v) {
                if (is_array($v) && isset($out[$sec][$k]) && is_array($out[$sec][$k])) $out[$sec][$k] = array_merge($out[$sec][$k], $v);
                else $out[$sec][$k] = $v;
            }
        }
    }
    return $out;
}

function save_settings($s)
{
    $json = json_encode($s, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (q_val("SELECT 1 FROM settings WHERE `key`='settings'")) q_exec("UPDATE settings SET value=? WHERE `key`='settings'", [$json]);
    else q_exec("INSERT INTO settings(`key`, value) VALUES('settings', ?)", [$json]);
}

/* Fill an empty database from private/seed.json (made by build_hosting_package.py from the local shop). */
function seed_db($seed)
{
    $cols = [
        'categories' => ['key', 'label', 'sort'],
        'products' => ['id', 'name', 'cat', 'price', 'stock', 'img', 'desc', 'active'],
        'users' => ['id', 'name', 'email', 'phone', 'address', 'salt', 'hash', 'role', 'created', 'google_sub', 'lat', 'lng', 'loc_at'],
        'orders' => ['id', 'user_id', 'created', 'items', 'subtotal', 'shipping', 'total', 'delivery', 'method', 'txn', 'receipt', 'status'],
        'order_events' => ['id', 'order_id', 'status', 'note', 'created'],
        'messages' => ['id', 'user_id', 'sender', 'body', 'created', 'seen'],
        'notifications' => ['id', 'kind', 'title', 'body', 'ref', 'created', 'read'],
        'enquiries' => ['id', 'name', 'company', 'email', 'phone', 'type', 'qty', 'message', 'created', 'status'],
    ];
    foreach ($cols as $table => $names) {
        if (empty($seed[$table]) || !is_array($seed[$table])) continue;
        if (q_val("SELECT 1 FROM $table LIMIT 1")) continue;            // never overwrite existing data
        foreach ($seed[$table] as $row) {
            $use = [];
            foreach ($names as $n) if (array_key_exists($n, $row)) $use[] = $n;
            if (!$use) continue;
            $sql = "INSERT INTO $table(" . implode(',', array_map(function ($n) { return "`$n`"; }, $use)) . ') VALUES(' . implode(',', array_fill(0, count($use), '?')) . ')';
            q_exec($sql, array_map(function ($n) use ($row) { return $row[$n]; }, $use));
        }
    }
    if (!empty($seed['settings']) && is_array($seed['settings']) && !q_val("SELECT 1 FROM settings WHERE `key`='settings'")) {
        save_settings($seed['settings']);
    }
    if (!q_val("SELECT 1 FROM settings WHERE `key`='settings'")) save_settings(default_settings());
}

/* ------------------------------------------------------------------ helpers */
function str_val($v)
{
    if ($v === null || $v === false || is_array($v) || is_object($v)) return '';
    return (string)$v;
}
function slice($s, $n) { return function_exists('mb_substr') ? mb_substr($s, 0, $n, 'UTF-8') : substr($s, 0, $n); }
function slen($s) { return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s); }
function clean($s, $n = 200) { return slice(trim(str_val($s)), $n); }
function lower($s) { return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s); }
function norm_phone($p)
{
    $d = preg_replace('/\D/', '', str_val($p));
    $d = preg_replace('/^00/', '', $d);
    return strlen($d) === 8 ? '974' . $d : $d;
}
function valid_phone($p) { return (bool)preg_match('/^\d{10,15}$/D', norm_phone($p)); }
function valid_email($e) { return (bool)preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/D', str_val($e)); }
function iban_ok($s)
{
    $s = strtoupper(preg_replace('/\s/', '', str_val($s)));
    if (!preg_match('/^QA\d{2}[A-Z]{4}[A-Z0-9]{21}$/D', $s)) return false;
    $r = substr($s, 4) . substr($s, 0, 4);
    $rem = 0;
    for ($i = 0, $n = strlen($r); $i < $n; $i++) {
        $v = base_convert($r[$i], 36, 10);               // digits stay, letters become 10..35
        $rem = ((int)$v >= 10 ? $rem * 100 + (int)$v : $rem * 10 + (int)$v) % 97;
    }
    return $rem === 1;
}
function qa_mobile($s)
{
    $d = preg_replace('/\D/', '', str_val($s));
    if (strpos($d, '974') === 0 && strlen($d) === 11) $d = substr($d, 3);
    return preg_match('/^\d{8}$/D', $d) ? $d : null;
}
function group4($s) { return trim(chunk_split(preg_replace('/\s/', '', $s), 4, ' ')); }
function valid_loc($lat, $lng)
{
    if (!is_numeric($lat) || !is_numeric($lng)) return null;
    $lat = (float)$lat; $lng = (float)$lng;
    if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180 || ($lat == 0 && $lng == 0)) return null;
    return [round($lat, 6), round($lng, 6)];
}
function num6($x) { return number_format((float)$x, 6, '.', ''); }
function random_token() { return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='); }

function client_ip() { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }
function is_https()
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') || (($_SERVER['SERVER_PORT'] ?? '') == '443');
}

/* Rate limiting is stored in small files (not the database) so a rolled-back request still counts. */
function throttle($key, $limit = 10, $window = 600)
{
    $dir = priv_dir() . '/throttle';
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    $f = $dir . '/' . hash('sha256', $key) . '.json';
    $fh = @fopen($f, 'c+');
    if (!$fh) return;
    flock($fh, LOCK_EX);
    $t = time();
    $hits = json_decode(stream_get_contents($fh) ?: '[]', true) ?: [];
    $hits = array_values(array_filter($hits, function ($x) use ($t, $window) { return $t - $x < $window; }));
    if (count($hits) >= $limit) { flock($fh, LOCK_UN); fclose($fh); throw new ApiError(429, 'Too many attempts. Please wait a few minutes.'); }
    $hits[] = $t;
    ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($hits));
    flock($fh, LOCK_UN); fclose($fh);
    if (mt_rand(1, 200) === 1) {                                  // tidy old files now and then
        foreach (glob($dir . '/*.json') ?: [] as $old) if ($t - @filemtime($old) > 7200) @unlink($old);
    }
}

/* ------------------------------------------------------------------ passwords */
function hash_new_pw($pw) { return password_hash($pw, PASSWORD_DEFAULT); }
function check_pw($pw, $u)
{
    if (empty($u['hash'])) return false;
    if (strpos($u['hash'], '$') === 0) return password_verify($pw, $u['hash']);
    // accounts imported from the local Python version (PBKDF2-SHA256, 200,000 rounds)
    if (!empty($u['salt']) && preg_match('/^[0-9a-f]{64}$/', $u['hash']) && preg_match('/^[0-9a-f]+$/', $u['salt'])) {
        $calc = hash_pbkdf2('sha256', $pw, hex2bin($u['salt']), 200000, 64, false);
        if (hash_equals($u['hash'], $calc)) {
            q_exec("UPDATE users SET salt='', `hash`=? WHERE id=?", [hash_new_pw($pw), (int)$u['id']]);   // upgrade silently
            return true;
        }
    }
    return false;
}

/* ------------------------------------------------------------------ sessions / current user */
function current_user()
{
    static $loaded = false, $user = null;
    if ($loaded) return $user;
    $loaded = true;
    $tok = session_token();
    if ($tok !== '') {
        $user = q_one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND (u.disabled IS NULL OR u.disabled=0)', [$tok, now()]);
        if ($user) q_exec('UPDATE sessions SET last_seen=? WHERE token=? AND (last_seen IS NULL OR last_seen<?)', [now(), $tok, now() - 60]);
    }
    return $user;
}
function session_token()
{
    $t = $_COOKIE['lofan_session'] ?? '';
    return (is_string($t) && preg_match('/^[A-Za-z0-9_-]+$/D', $t)) ? $t : '';
}
function session_sid($token) { return substr(hash('sha256', $token), 0, 16); }   // public id of a session (the real token stays secret)
function need_user() { $u = current_user(); if (!$u) throw new ApiError(401, 'Please sign in first'); return $u; }
function need_admin() { $u = need_user(); if ($u['role'] !== 'admin') throw new ApiError(403, 'Admin access only'); return $u; }
function set_session_cookie($value, $expires)
{
    setcookie('lofan_session', $value, ['expires' => $expires, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => is_https()]);
}
function start_session($userId, $admin = false)
{
    $tok = random_token();
    $ttl = $admin ? 7 * 86400 : 30 * 86400;                           // staff sign-ins expire sooner than customers'
    q_exec('DELETE FROM sessions WHERE expires<?', [now()]);
    q_exec('INSERT INTO sessions(token,user_id,expires,ip,ua,created,last_seen) VALUES(?,?,?,?,?,?,?)',
        [$tok, (int)$userId, now() + $ttl, client_ip(), slice(str_val($_SERVER['HTTP_USER_AGENT'] ?? ''), 250), now(), now()]);
    q_exec('UPDATE users SET last_login=? WHERE id=?', [now(), (int)$userId]);
    set_session_cookie($tok, now() + $ttl);
}

/* ------------------------------------------------------------------ output shaping */
function public_user($u)
{
    $loc = ($u['lat'] !== null && $u['lng'] !== null) ? ['lat' => (float)$u['lat'], 'lng' => (float)$u['lng'], 'at' => (int)$u['loc_at']] : null;
    return ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'phone' => $u['phone'] ?: '', 'address' => $u['address'] ?: '',
        'role' => $u['role'], 'google' => !empty($u['google_sub']), 'hasPassword' => !empty($u['hash']), 'location' => $loc,
        'adminLevel' => $u['role'] === 'admin' ? ((($u['admin_level'] ?? '') ?: 'owner')) : null];
}
function user_by_id($id) { return q_one('SELECT * FROM users WHERE id=?', [(int)$id]); }
function save_user_loc($uid, $loc) { q_exec('UPDATE users SET lat=?,lng=?,loc_at=? WHERE id=?', [$loc[0], $loc[1], now(), (int)$uid]); }

function order_out($row, $admin = false)
{
    $o = $row;
    $o['items'] = json_decode($o['items'], true) ?: [];
    $o['delivery'] = json_decode($o['delivery'], true) ?: [];
    $o['hasReceipt'] = !empty($o['receipt']);
    unset($o['receipt']);
    foreach (['created', 'subtotal', 'shipping', 'total'] as $k) $o[$k] = (int)$o[$k];
    $o['events'] = array_map(function ($e) { $e['created'] = (int)$e['created']; return $e; },
        q_all('SELECT status,note,created FROM order_events WHERE order_id=? ORDER BY id', [$o['id']]));
    if ($admin) $o['user_id'] = (int)$o['user_id']; else unset($o['user_id']);
    return $o;
}
function order_by_id($id) { return q_one('SELECT * FROM orders WHERE id=?', [$id]); }

function new_order_id()
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
        $id = 'LF-';
        for ($i = 0; $i < 6; $i++) $id .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    } while (q_val('SELECT 1 FROM orders WHERE id=?', [$id]));
    return $id;
}
function notify($kind, $title, $body, $ref = '')
{
    q_exec('INSERT INTO notifications(kind,title,body,ref,created) VALUES(?,?,?,?,?)', [$kind, $title, $body, $ref, now()]);
}
function add_event($oid, $status, $note = '')
{
    q_exec('INSERT INTO order_events(order_id,status,note,created) VALUES(?,?,?,?)', [$oid, $status, $note, now()]);
}
function restore_stock($order)
{
    foreach (json_decode($order['items'], true) ?: [] as $it) q_exec('UPDATE products SET stock=stock+? WHERE id=?', [(int)$it['qty'], (int)$it['id']]);
}
function sweep_soldout()
{
    if (empty(get_settings()['shop']['autoDeleteSoldOut'])) return 0;
    $reserved = [];
    foreach (q_all("SELECT items FROM orders WHERE status IN ('Awaiting payment','Payment submitted')") as $r)
        foreach (json_decode($r['items'], true) ?: [] as $i) $reserved[(int)$i['id']] = true;
    $gone = 0;
    foreach (q_all('SELECT id FROM products WHERE stock<=0') as $r) {
        if (isset($reserved[(int)$r['id']])) continue;
        q_exec('DELETE FROM products WHERE id=?', [(int)$r['id']]);
        $gone++;
    }
    return $gone;
}

function save_data_url($dataUrl, $folder, $basename, $allowed, $maxBytes)
{
    if (!preg_match('/^data:([\w\/+.-]+);base64,([A-Za-z0-9+\/=\s]+)$/D', str_val($dataUrl), $m) || !isset($allowed[$m[1]])) throw new ApiError(400, 'Unsupported file type');
    $raw = base64_decode(preg_replace('/\s+/', '', $m[2]), true);
    if ($raw === false) throw new ApiError(400, 'Unsupported file type');
    if (strlen($raw) > $maxBytes) throw new ApiError(400, 'File is too large');
    if ($m[1] === 'application/pdf') { if (strpos($raw, '%PDF') !== 0) throw new ApiError(400, 'Unsupported file type'); }
    elseif (!@getimagesizefromstring($raw)) throw new ApiError(400, 'Unsupported file type');       // really an image?
    if (!is_dir($folder)) @mkdir($folder, 0755, true);
    $name = $basename . '.' . $allowed[$m[1]];
    if (file_put_contents($folder . '/' . $name, $raw) === false) throw new ApiError(500, 'Could not save the file (folder not writable).');
    return $name;
}

function qs($key, $default = '')
{
    $v = $_GET[$key] ?? $default;
    return is_array($v) ? (string)reset($v) : (string)$v;
}

/* ------------------------------------------------------------------ payments */
function applepay_missing($ap, $hasIdentity = null)
{
    if ($hasIdentity === null) $hasIdentity = is_file(identity_pem());
    $need = [];
    if (empty($ap['merchantId'])) $need[] = 'Apple Merchant ID';
    if (!$hasIdentity) $need[] = 'Merchant identity certificate (PEM)';
    if (empty($ap['publicKey']) || empty($ap['secretKey'])) $need[] = 'Payment provider public + secret key';
    if (empty($ap['domainFile'])) $need[] = 'Domain verification file';
    return $need;
}
function settings_for_admin($owner = true)
{
    $raw = get_settings();
    if (!$owner) return ['company' => $raw['company'], 'shop' => $raw['shop'], 'shipping' => $raw['shipping']];   // staff never see payment / secret settings
    $out = $raw;
    $out['alerts']['sms']['hasToken'] = !empty($raw['alerts']['sms']['twilioToken']);
    $out['alerts']['sms']['twilioToken'] = '';
    $out['alerts']['telegram']['hasToken'] = !empty($raw['alerts']['telegram']['botToken']);
    $out['alerts']['telegram']['botToken'] = '';
    $out['applepay']['hasSecret'] = !empty($raw['applepay']['secretKey']);
    $out['applepay']['secretKey'] = '';                             // never send secrets back to the browser
    $out['applepay']['hasIdentity'] = is_file(identity_pem());
    $out['applepay']['missing'] = applepay_missing($raw['applepay']);
    return $out;
}
function payment_info()
{
    $s = get_settings();
    $p = $s['payments'];
    $methods = [];
    $rows = function ($pairs) { $o = []; foreach ($pairs as $kv) if ((string)$kv[1] !== '') $o[] = [$kv[0], $kv[1]]; return $o; };
    if (!empty($p['iban']['enabled']) && iban_ok($p['iban']['iban'])) {
        $d = $p['iban'];
        $methods[] = ['id' => 'iban', 'label' => 'Bank Transfer (IBAN)',
            'hint' => 'Transfer the exact total in QAR from your Qatari bank app or branch to the account below. Write the payment reference in the transfer remarks / beneficiary note.',
            'details' => $rows([['Bank', $d['bankName']], ['Account name', $d['accountName']], ['Account number', $d['accountNumber']],
                ['IBAN', group4($d['iban'])], ['SWIFT / BIC', $d['swift']], ['Branch', $d['branch']], ['Currency', 'QAR – Qatari Riyal']])];
    }
    if (!empty($p['fawran']['enabled']) && $p['fawran']['alias']) {
        $d = $p['fawran'];
        $methods[] = ['id' => 'fawran', 'label' => 'Fawran (Instant)',
            'hint' => 'Open your bank app, choose Fawran / instant payment, send to the alias below and add the payment reference as the note. Funds arrive within seconds.',
            'details' => $rows([['Fawran alias (mobile / IBAN)', $d['alias']], ['Account name', $d['accountName']], ['Bank', $d['bankName']]])];
    }
    if (!empty($p['ooredoo']['enabled']) && $p['ooredoo']['number']) {
        $d = $p['ooredoo'];
        $methods[] = ['id' => 'ooredoo', 'label' => 'Ooredoo Money',
            'hint' => 'Open the Ooredoo Money app, choose Send Money, enter the number below and add the payment reference as the note.',
            'details' => $rows([['Ooredoo Money number', $d['number']], ['Account name', $d['accountName']]])];
    }
    $ap = $s['applepay'];
    if (!empty($ap['enabled']) && !applepay_missing($ap)) {
        $methods[] = ['id' => 'applepay', 'label' => 'Apple Pay', 'wallet' => true,
            'hint' => 'Pay securely with Face ID / Touch ID using a card in your Apple Wallet. Your order is confirmed instantly.',
            'details' => [], 'applepay' => ['displayName' => $ap['displayName'] ?: 'Lofan', 'countryCode' => 'QA', 'currencyCode' => CURRENCY]];
    }
    return ['company' => $s['company'], 'currency' => CURRENCY, 'methods' => $methods, 'requireReceipt' => !empty($s['orders']['requireReceipt'])];
}

function http_json($url, $payload = null, $headers = [], $opts = [], $timeout = 20)
{
    if (!function_exists('curl_init')) throw new ApiError(502, 'The server cannot reach other services (cURL is missing). Please contact your host.');
    $ch = curl_init($url);
    $h = array_merge(['Accept: application/json'], $headers);
    if ($payload !== null) { $h[] = 'Content-Type: application/json'; curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload)); }
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false] + $opts);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return [$body, $code, $err];
}

function google_client_id()
{
    $env = getenv('GOOGLE_CLIENT_ID');
    return $env ?: get_settings()['google']['clientId'];
}
function verify_google($credential, $clientId)
{
    list($body, $code) = http_json('https://oauth2.googleapis.com/tokeninfo?id_token=' . rawurlencode(str_val($credential)), null, [], [], 10);
    $info = ($code === 200 && $body) ? json_decode($body, true) : null;
    if (!is_array($info)) throw new ApiError(401, 'Google could not verify your sign-in. Please try again.');
    $ok = (($info['aud'] ?? '') === $clientId) && in_array($info['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true)
        && strtolower(str_val($info['email_verified'] ?? '')) === 'true' && (int)($info['exp'] ?? 0) > now() && !empty($info['email']) && !empty($info['sub']);
    if (!$ok) throw new ApiError(401, 'Google sign-in could not be verified.');
    return $info;
}

function apple_validate($ap, $validationUrl, $host)
{
    $u = parse_url(str_val($validationUrl));
    $h = strtolower($u['host'] ?? '');
    if (($u['scheme'] ?? '') !== 'https' || substr($h, -10) !== '.apple.com' || isset($u['user']) || (isset($u['port']) && (int)$u['port'] !== 443))
        throw new ApiError(400, 'Invalid Apple Pay validation address.');
    if (!is_file(identity_pem())) throw new ApiError(502, 'Apple Pay could not be started. Please choose another payment method.');
    $payload = ['merchantIdentifier' => $ap['merchantId'], 'displayName' => $ap['displayName'] ?: 'Lofan', 'initiative' => 'web',
        'initiativeContext' => $ap['domain'] ?: explode(':', $host)[0]];
    list($body, $code, $err) = http_json($validationUrl, $payload, [], [CURLOPT_SSLCERT => identity_pem(), CURLOPT_SSLKEY => identity_pem(), CURLOPT_SSLCERTTYPE => 'PEM'], 15);
    $res = ($code >= 200 && $code < 300 && $body) ? json_decode($body, true) : null;
    if (!is_array($res)) {
        error_log('Apple Pay merchant validation failed: HTTP ' . $code . ' ' . $err);
        throw new ApiError(502, 'Apple Pay could not be started. Please choose another payment method.');
    }
    return $res;
}

/* Charges an Apple Pay token through Checkout.com. Returns [approved, payment_id]. Replace this function to use another provider. */
function psp_charge($ap, $tokenData, $order, $email, $name)
{
    $base = !empty($ap['sandbox']) ? 'https://api.sandbox.checkout.com' : 'https://api.checkout.com';
    $post = function ($path, $key, $payload, $extra = []) use ($base) {
        $hdr = ['Authorization: ' . $key];
        foreach ($extra as $k => $v) $hdr[] = "$k: $v";
        list($body, $code, $err) = http_json($base . $path, $payload, $hdr, [], 25);
        if ($body === false || $body === null || $code === 0) throw new ApiError(502, 'The payment provider could not be reached. Please try again.');
        $j = json_decode($body, true);
        return is_array($j) ? $j : ['_error' => []];
    };
    $tok = $post('/tokens', $ap['publicKey'], ['type' => 'applepay', 'token_data' => $tokenData]);
    if (empty($tok['token'])) throw new ApiError(402, 'Apple Pay could not read your card. Please try again or choose another method.');
    $pay = $post('/payments', 'Bearer ' . $ap['secretKey'],
        ['source' => ['type' => 'token', 'token' => $tok['token']], 'amount' => (int)$order['total'] * 100, 'currency' => CURRENCY,
            'reference' => $order['id'], 'capture' => true, 'customer' => ['email' => $email, 'name' => $name]],
        ['Cko-Idempotency-Key' => $order['id']]);
    $approved = !empty($pay['approved']) || in_array(strtolower(str_val($pay['status'] ?? '')), ['authorized', 'captured', 'paid'], true);
    return [$approved, str_val($pay['id'] ?? '')];
}
