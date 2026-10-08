<?php
/* LOFAN – extra backend features: admin levels, access log, order alerts (SMS / Telegram / webhook),
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

/* ------------------------------------------------------------------ alerts: SMS / Telegram / webhook */
function normalize_e164($s)
{
    $s = preg_replace('/[^\d+]/', '', str_val($s));
    if (strpos($s, '00') === 0) $s = '+' . substr($s, 2);
    if ($s !== '' && $s[0] !== '+') $s = strlen($s) === 8 ? '+974' . $s : '+' . $s;
    return preg_match('/^\+\d{8,15}$/D', $s) ? $s : null;
}
function parse_recipients($v)
{
    $list = is_array($v) ? $v : preg_split('/[\r\n,;]+/', str_val($v), -1, PREG_SPLIT_NO_EMPTY);   // one per line; spaces inside a number are fine
    $list = array_values(array_filter(array_map('trim', $list), function ($x) { return $x !== ''; }));
    $out = [];
    foreach ($list as $x) {
        $n = normalize_e164($x);
        if ($n === null) throw new ApiError(400, 'Phone number "' . clean($x, 30) . '" is not valid. Use the international format, e.g. +97466809657.');
        if (!in_array($n, $out, true)) $out[] = $n;
    }
    if (count($out) > 5) throw new ApiError(400, 'You can add up to 5 phone numbers.');
    return $out;
}
function queue_alert($event, $orderId) { $GLOBALS['ALERT_QUEUE'][] = [$event, $orderId]; }

function build_alert_text($event, $o)
{
    $d = json_decode($o['delivery'], true) ?: [];
    $items = array_map(function ($i) { return (int)$i['qty'] . 'x ' . $i['name']; }, json_decode($o['items'], true) ?: []);
    $heads = ['placed' => 'NEW ORDER (awaiting payment)', 'submitted' => 'PAYMENT SUBMITTED - please verify', 'confirmed' => 'ORDER CONFIRMED (paid)', 'test' => 'TEST ALERT'];
    $loc = isset($d['lat'], $d['lng']) ? 'https://maps.google.com/?q=' . $d['lat'] . ',' . $d['lng'] : str_val($d['address'] ?? '');
    $t = 'LOFAN ' . ($heads[$event] ?? 'ORDER') . "\n#" . $o['id'] . "\nCustomer: " . str_val($d['name'] ?? '') . ' +' . str_val($d['phone'] ?? '')
        . "\nItems: " . implode(', ', $items) . "\nTotal: " . (int)$o['total'] . ' QAR' . (!empty($o['method']) ? ' (' . $o['method'] . ')' : '')
        . "\nOrdered: " . date('d M Y H:i', (int)$o['created']) . "\nLocation: " . $loc;
    return slice($t, 600);
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
function alert_detail($res, $code, $err)
{
    $j = is_string($res) ? json_decode($res, true) : null;
    $msg = is_array($j) ? ($j['message'] ?? $j['description'] ?? $j['error'] ?? '') : '';
    return trim(($err ?: '') . ' ' . (is_string($msg) ? $msg : '') . ($code ? " (HTTP $code)" : ''));
}
/* Each sender returns [ok(bool), detail(string)] */
function send_sms($cfgSms, $to, $text)
{
    if (($cfgSms['provider'] ?? 'twilio') === 'webhook') {
        list($res, $code, $err) = http_post($cfgSms['webhookUrl'], json_encode(['to' => $to, 'message' => $text], JSON_UNESCAPED_UNICODE), ['Content-Type: application/json']);
        return [$code >= 200 && $code < 300, alert_detail($res, $code, $err)];
    }
    $from = $cfgSms['from'];
    $f = ['To' => $to, 'Body' => $text];
    if (strpos($from, 'MG') === 0) $f['MessagingServiceSid'] = $from; else $f['From'] = $from;
    list($res, $code, $err) = http_post('https://api.twilio.com/2010-04-01/Accounts/' . rawurlencode($cfgSms['twilioSid']) . '/Messages.json', http_build_query($f), [],
        [CURLOPT_USERPWD => $cfgSms['twilioSid'] . ':' . $cfgSms['twilioToken']]);
    return [$code === 200 || $code === 201, alert_detail($res, $code, $err)];
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
    if (($only === null || $only === 'sms') && !empty($a['sms']['enabled'])) {
        foreach ($a['sms']['recipients'] as $to) {
            list($ok, $d) = send_sms($a['sms'], $to, $text);
            $out[] = ['sms', $to, $ok, $d];
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
