<?php
/* LOFAN – extra backend features: admin levels, access log, order alerts (WhatsApp / Telegram),
   unpaid-order release, and the data reset. Loaded after lib.php. */
defined('LOFAN') or exit;

/* ------------------------------------------------------------------ admin levels */
function admin_level($u) { return (($u['admin_level'] ?? '') ?: 'owner'); }
function need_owner()
{
    $u = need_admin();
    if (admin_level($u) !== 'owner') throw new ApiError(403, 'Only an owner account can do this.');
    return $u;
}
function is_owner($u) { return admin_level($u) === 'owner'; }

/* Password rule for every NEW password (sign-up, change, admin accounts): 8+ characters with letters AND numbers.
   Signing in is never blocked by this rule, so older accounts keep working until their owner changes the password. */
const PASSWORD_RULE = 'Password must be at least 8 characters and include both letters and numbers.';
function password_ok($pw)
{
    $pw = (string)$pw;
    return strlen($pw) >= 8 && preg_match('/\p{L}/u', $pw) === 1 && preg_match('/[0-9]/', $pw) === 1;
}

/* ------------------------------------------------------------------ access / activity log */
function user_agent_short() { return slice(str_val($_SERVER['HTTP_USER_AGENT'] ?? ''), 250); }
/* $always = true: also keep the entry when the request is rolled back (e.g. a failed sign-in). */
function log_admin($action, $detail = '', $actor = null, $always = false)
{
    if ($actor === null) $actor = current_user();
    $row = [$actor ? (int)$actor['id'] : 0, $actor ? (string)$actor['name'] : 'System', $action, slice($detail, 600), client_ip(), user_agent_short(), now()];
    if ($always) { $GLOBALS['LOG_ALWAYS'][] = $row; return; }
    q_exec('INSERT INTO admin_log(user_id,admin_name,action,detail,ip,ua,created) VALUES(?,?,?,?,?,?,?)', $row);
}
function flush_always_logs()
{
    $rows = $GLOBALS['LOG_ALWAYS'] ?? [];
    $GLOBALS['LOG_ALWAYS'] = [];
    foreach ($rows as $row) q_exec('INSERT INTO admin_log(user_id,admin_name,action,detail,ip,ua,created) VALUES(?,?,?,?,?,?,?)', $row);
}

/* ------------------------------------------------------------------ releasing unpaid orders */
function expire_unpaid()
{
    $hrs = (int)(get_settings()['orders']['unpaidHours'] ?? 0);
    if ($hrs <= 0) return;
    $dir = priv_dir() . '/throttle';
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    $flag = $dir . '/expire.flag';
    if (is_file($flag) && time() - @filemtime($flag) < 300) return;      // check at most every 5 minutes
    @touch($flag);
    $old = q_all("SELECT * FROM orders WHERE status='Awaiting payment' AND created<?", [now() - $hrs * 3600]);
    if (!$old) return;
    $pdo = db();
    $pdo->beginTransaction();
    try {
        foreach ($old as $o) {
            restore_stock($o);
            q_exec("UPDATE orders SET status='Cancelled' WHERE id=? AND status='Awaiting payment'", [$o['id']]);
            add_event($o['id'], 'Cancelled', "Not paid within $hrs hours - released automatically");
            notify('order', 'Order ' . $o['id'] . ' released', "Not paid within $hrs hours, stock returned to the shop.", $o['id']);
        }
        sweep_soldout();
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('expire_unpaid failed: ' . $e->getMessage());
    }
}

/* ------------------------------------------------------------------ alerts: WhatsApp / Telegram */
function normalize_e164($s)
{
    $s = preg_replace('/[^\d+]/', '', str_val($s));
    if (strpos($s, '00') === 0) $s = '+' . substr($s, 2);
    if ($s !== '' && $s[0] !== '+') $s = strlen($s) === 8 ? '+974' . $s : '+' . $s;
    return preg_match('/^\+\d{8,15}$/D', $s) ? $s : null;
}
/* The WhatsApp number that receives the alerts: the one typed in Alerts, otherwise the company WhatsApp number. */
function whatsapp_target($settings = null)
{
    $s = $settings ?: get_settings();
    $n = normalize_e164($s['alerts']['whatsapp']['number'] ?? '');
    if ($n === null) $n = normalize_e164($s['company']['whatsapp'] ?? '');
    return $n ?: '';
}
function queue_alert($event, $orderId) { $GLOBALS['ALERT_QUEUE'][] = [$event, $orderId]; }

function build_alert_text($event, $o)
{
    $d = json_decode($o['delivery'], true) ?: [];
    $heads = [
        'placed' => "🛒 *NEW ORDER* - waiting for payment", 'submitted' => "💳 *PAYMENT SUBMITTED* - please verify",
        'confirmed' => "✅ *ORDER CONFIRMED* (paid)", 'test' => '🔔 *TEST ALERT*',
    ];
    $items = array_map(function ($i) {
        $qty = max(1, (int)$i['qty']); $price = (int)($i['price'] ?? 0);
        return '• ' . $qty . ' x ' . str_val($i['name']) . ' - ' . ($qty * $price) . ' QAR' . ($qty > 1 ? ' (' . $price . ' each)' : '');
    }, json_decode($o['items'], true) ?: []);
    $phone = preg_replace('/\D/', '', str_val($d['phone'] ?? ''));
    $t = ($heads[$event] ?? '*ORDER*') . "\nOrder: " . $o['id'] . "\nTime: " . date('d M Y, H:i', (int)$o['created'])
        . "\n\n*Items*\n" . implode("\n", $items)
        . ((int)$o['shipping'] > 0 ? "\nDelivery: " . (int)$o['shipping'] . ' QAR' : '')
        . "\n*Total: " . (int)$o['total'] . ' QAR*' . (!empty($o['method']) ? ' - ' . $o['method'] : '')
        . "\n\n*Customer*\n" . str_val($d['name'] ?? '') . ($phone !== '' ? "\n+" . $phone : '')
        . "\nAddress: " . str_val($d['address'] ?? '')
        . (isset($d['lat'], $d['lng']) ? "\nMap: https://maps.google.com/?q=" . $d['lat'] . ',' . $d['lng'] : '');
    return slice($t, 1200);
}

/* One HTTP POST. When config has 'alerts_capture' (local testing only) the request is written to that file instead of being sent. */
function http_post($url, $body, $headers = [], $opts = [], $timeout = 12)
{
    $cap = cfg()['alerts_capture'] ?? null;
    if ($cap) {
        @file_put_contents($cap, json_encode(['url' => $url, 'body' => $body, 'headers' => $headers, 'userpwd' => $opts[CURLOPT_USERPWD] ?? null], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);
        return ['{"ok":true,"message":"captured"}', 200, ''];
    }
    if (!function_exists('curl_init')) return [false, 0, 'cURL is not available on this server'];
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_FOLLOWLOCATION => false] + $opts);
    $res = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return [$res, $code, $err];
}
function http_get($url, $timeout = 15)
{
    $cap = cfg()['alerts_capture'] ?? null;
    if ($cap) {
        @file_put_contents($cap, json_encode(['method' => 'GET', 'url' => $url], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);
        return ['Message queued (captured)', 200, ''];
    }
    if (!function_exists('curl_init')) return [false, 0, 'cURL is not available on this server'];
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_FOLLOWLOCATION => false]);
    $res = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return [$res, $code, $err];
}
function alert_detail($res, $code, $err)
{
    $j = is_string($res) ? json_decode($res, true) : null;
    $msg = is_array($j) ? ($j['message'] ?? $j['description'] ?? $j['error'] ?? '') : (is_string($res) ? trim(preg_replace('/\s+/', ' ', strip_tags($res))) : '');
    return trim(($err ?: '') . ' ' . slice(is_string($msg) ? $msg : '', 160) . ($code ? " (HTTP $code)" : ''));
}
/* Each sender returns [ok(bool), detail(string)] */
function send_whatsapp($cfgWa, $to, $text)
{
    if (($cfgWa['provider'] ?? 'callmebot') === 'webhook') {      // any other WhatsApp service that accepts a JSON web request
        list($res, $code, $err) = http_post($cfgWa['webhookUrl'], json_encode(['to' => $to, 'message' => $text, 'channel' => 'whatsapp'], JSON_UNESCAPED_UNICODE), ['Content-Type: application/json']);
        return [$code >= 200 && $code < 300, alert_detail($res, $code, $err)];
    }
    // CallMeBot: free WhatsApp messages to your OWN number (you activate it once from your WhatsApp)
    $url = 'https://api.callmebot.com/whatsapp.php?phone=' . rawurlencode($to) . '&text=' . rawurlencode($text) . '&apikey=' . rawurlencode($cfgWa['apiKey']);
    list($res, $code, $err) = http_get($url);
    $bad = is_string($res) && preg_match('/error|invalid|not valid|wrong|incorrect|blocked/i', $res);
    return [$code === 200 && !$bad && $err === '', alert_detail($res, $code, $err)];
}
function send_telegram($cfgTg, $text)
{
    list($res, $code, $err) = http_post('https://api.telegram.org/bot' . $cfgTg['botToken'] . '/sendMessage',
        http_build_query(['chat_id' => $cfgTg['chatId'], 'text' => $text, 'disable_web_page_preview' => 'true']));
    $j = is_string($res) ? json_decode($res, true) : null;
    return [$code === 200 && !empty($j['ok']), alert_detail($res, $code, $err)];
}
/* Sends $text on every enabled channel. Returns a list of [channel, target, ok, detail]. */
function deliver_alert($text, $only = null)
{
    $a = get_settings()['alerts'];
    $out = [];
    if (($only === null || $only === 'whatsapp') && !empty($a['whatsapp']['enabled'])) {
        $to = whatsapp_target();
        if ($to === '') $out[] = ['whatsapp', '(no number)', false, 'No WhatsApp number is set. Add it in Admin > Company & Payments.'];
        else {
            list($ok, $d) = send_whatsapp($a['whatsapp'], $to, $text);
            $out[] = ['whatsapp', $to, $ok, $d];
        }
    }
    if (($only === null || $only === 'telegram') && !empty($a['telegram']['enabled'])) {
        list($ok, $d) = send_telegram($a['telegram'], $text);
        $out[] = ['telegram', 'chat ' . $a['telegram']['chatId'], $ok, $d];
    }
    return $out;
}
function send_queued_alerts()
{
    $queue = $GLOBALS['ALERT_QUEUE'] ?? [];
    $GLOBALS['ALERT_QUEUE'] = [];
    if (!$queue) return;
    try {
        $a = get_settings()['alerts'];
        foreach ($queue as $item) {
            list($event, $oid) = $item;
            if (empty($a['events'][$event])) continue;
            $o = order_by_id($oid);
            if (!$o) continue;
            foreach (deliver_alert(build_alert_text($event, $o)) as $r) {
                log_admin('alert.' . $r[0], $r[1] . ' - order ' . $oid . ' (' . $event . ') - ' . ($r[2] ? 'sent' : 'FAILED ' . $r[3]), ['id' => 0, 'name' => 'System']);
            }
        }
    } catch (Throwable $e) {
        error_log('alerts failed: ' . $e->getMessage());
    }
}

/* ------------------------------------------------------------------ reset test data (owner only) */
function reset_data($o)
{
    $n = ['orders' => 0, 'customers' => 0, 'enquiries' => 0, 'notifications' => 0, 'chats' => 0, 'log' => 0];
    if (!empty($o['orders'])) {
        foreach (q_all('SELECT * FROM orders') as $ord) {
            if (!empty($o['restoreStock']) && $ord['status'] !== 'Cancelled') restore_stock($ord);
            if (!empty($ord['receipt'])) @unlink(receipts_dir() . '/' . basename($ord['receipt']));
            $n['orders']++;
        }
        q_exec('DELETE FROM order_events');
        q_exec('DELETE FROM orders');
    }
    if (!empty($o['customers'])) {
        $ids = array_map(function ($r) { return (int)$r['id']; }, q_all("SELECT id FROM users WHERE role='customer'"));
        foreach ($ids as $id) {
            q_exec('DELETE FROM messages WHERE user_id=?', [$id]);
            q_exec('DELETE FROM sessions WHERE user_id=?', [$id]);
            q_exec('UPDATE orders SET user_id=0 WHERE user_id=?', [$id]);
        }
        q_exec("DELETE FROM users WHERE role='customer'");
        $n['customers'] = count($ids);
    }
    if (!empty($o['chats'])) { $n['chats'] = (int)q_val('SELECT COUNT(*) FROM messages'); q_exec('DELETE FROM messages'); }
    if (!empty($o['enquiries'])) { $n['enquiries'] = q_exec('DELETE FROM enquiries'); }
    if (!empty($o['notifications'])) { $n['notifications'] = q_exec('DELETE FROM notifications'); }
    if (!empty($o['log'])) { $n['log'] = q_exec('DELETE FROM admin_log'); }
    sweep_soldout();
    return $n;
}
