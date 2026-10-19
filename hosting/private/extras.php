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

/* ------------------------------------------------------------------ deleting one order (owner, or staff with the owner's approval) */
const DELETE_APPROVAL_HOURS = 24;       // an approval is valid for this long, and for ONE deletion
function purge_order($r)
{
    if (in_array($r['status'], ['Awaiting payment', 'Payment submitted'], true)) restore_stock($r);   // reserved items go back to the shop
    if (!empty($r['receipt'])) @unlink(receipts_dir() . '/' . basename($r['receipt']));
    q_exec('DELETE FROM order_events WHERE order_id=?', [$r['id']]);
    q_exec("DELETE FROM notifications WHERE ref=? AND kind IN ('order','payment')", [$r['id']]);
    q_exec('DELETE FROM orders WHERE id=?', [$r['id']]);
}

/* ------------------------------------------------------------------ products: photos, details, owner-approved changes */
const PRODUCT_MAX_PHOTOS = 8;
function save_product_photos($list, $nameForSlug)
{
    $paths = [];
    foreach ((array)$list as $img) {
        $data = is_array($img) ? ($img['data'] ?? '') : $img;
        if (!is_string($data) || $data === '') continue;
        $slug = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($nameForSlug)), '-') ?: 'item';
        $fn = save_data_url($data, product_img_dir(), $slug . '-' . bin2hex(random_bytes(3)),
            ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'], 4000000);
        $paths[] = 'images/products/' . $fn;
    }
    return $paths;
}
/* Validates an item edit and returns ONLY the fields that were sent. */
function product_changes($in, $row)
{
    $c = [];
    if (array_key_exists('name', $in)) {
        $v = clean($in['name'], 100);
        if (slen($v) < 2) throw new ApiError(400, 'Enter the item name.');
        $c['name'] = $v;
    }
    if (array_key_exists('cat', $in)) {
        if (!q_val('SELECT 1 FROM categories WHERE `key`=?', [str_val($in['cat'])])) throw new ApiError(400, 'Unknown category');
        $c['cat'] = str_val($in['cat']);
    }
    foreach (['price', 'stock'] as $f) {
        if (array_key_exists($f, $in)) {
            if (!is_numeric($in[$f])) throw new ApiError(400, "Invalid $f");
            $c[$f] = max(0, (int)$in[$f]);
        }
    }
    if (array_key_exists('desc', $in)) $c['desc'] = clean($in['desc'], 600);
    if (array_key_exists('size', $in)) $c['size'] = clean($in['size'], 80);
    if (array_key_exists('includes', $in)) $c['includes'] = clean($in['includes'], 200);
    if (array_key_exists('active', $in)) $c['active'] = $in['active'] ? 1 : 0;
    // photos: `images` = the wanted list IN ORDER (first = main photo). Each entry is an existing photo path or {data: "data:image/..."} (a new upload).
    if (array_key_exists('images', $in) && is_array($in['images']) || !empty($in['image'])) {
        $cur = product_images($row ?: []);
        $list = is_array($in['images'] ?? null) ? $in['images'] : $cur;
        if (!empty($in['image'])) array_unshift($list, $in['image']);       // older single-photo form: the new photo becomes the main one
        $slug = $c['name'] ?? ($row['name'] ?? 'item'); $all = [];
        foreach ($list as $it) {
            if (is_string($it) && strpos($it, 'data:') !== 0) { if (in_array($it, $cur, true) && !in_array($it, $all, true)) $all[] = $it; }
            else $all = array_merge($all, save_product_photos([$it], $slug));
            if (count($all) > PRODUCT_MAX_PHOTOS) throw new ApiError(400, 'An item can have up to ' . PRODUCT_MAX_PHOTOS . ' photos.');
        }
        if (!$all) throw new ApiError(400, 'An item needs at least one photo.');
        $c['images'] = $all;
    }
    return $c;
}
function apply_product_changes($id, $c)
{
    $set = []; $vals = [];
    foreach (['name', 'cat', 'price', 'stock', 'desc', 'size', 'includes', 'active'] as $f) {
        if (array_key_exists($f, $c)) { $set[] = "`$f`=?"; $vals[] = $c[$f]; }
    }
    if (!empty($c['images'])) {
        $set[] = '`images`=?'; $vals[] = json_encode(array_values($c['images']), JSON_UNESCAPED_SLASHES);
        $set[] = '`img`=?'; $vals[] = $c['images'][0];
    }
    if (!$set) return;
    $vals[] = (int)$id;
    q_exec('UPDATE products SET ' . implode(',', $set) . ' WHERE id=?', $vals);
}
function describe_product_changes($row, $c)
{
    $out = [];
    foreach ($c as $k => $v) {
        if ($k === 'images') $out[] = 'photos ' . count(product_images($row)) . ' -> ' . count($v);
        elseif ($k === 'desc') $out[] = 'description changed';
        elseif ($k === 'active') $out[] = $v ? 'show in shop' : 'hide from shop';
        elseif (isset($row[$k]) && (string)$row[$k] !== (string)$v) $out[] = "$k: " . slice((string)$row[$k], 40) . ' -> ' . slice((string)$v, 40);
        elseif (!isset($row[$k]) || (string)$row[$k] !== (string)$v) $out[] = "$k: " . slice((string)$v, 40);
    }
    return $out;
}

/* ------------------------------------------------------------------ e-mail (password codes) */
/* Sends a plain-text e-mail with PHP's mail() (your cPanel mail service). Set mail_capture in the test config to log instead. */
function send_mail($to, $subject, $text)
{
    if (!valid_email($to)) return false;
    $cap = cfg()['mail_capture'] ?? null;
    if ($cap) { @file_put_contents($cap, json_encode(['to' => $to, 'subject' => $subject, 'body' => $text], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND); return true; }
    $co = get_settings()['company'];
    $host = explode(':', (string)($_SERVER['HTTP_HOST'] ?? 'lofan.qa'))[0];
    $from = (!empty($co['email']) && valid_email($co['email'])) ? $co['email'] : 'no-reply@' . $host;
    $headers = "From: Lofan <$from>\r\nReply-To: $from\r\nContent-Type: text/plain; charset=UTF-8\r\nX-Mailer: Lofan";
    $ok = @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $text, $headers);
    if (!$ok) error_log('Lofan: the e-mail to ' . $to . ' could not be handed to the mail service.');
    return (bool)$ok;
}

/* ------------------------------------------------------------------ password reset by e-mail code (admins and staff) */
const OTP_MINUTES = 10;
/* Creates a 6-digit code, stores only its hash, and e-mails it to the admin's login address. Returns true when sent. */
function otp_issue($u)
{
    if ((int)q_val('SELECT COUNT(*) FROM password_otps WHERE user_id=? AND created>?', [(int)$u['id'], now() - 900]) >= 3) return false;   // at most 3 codes per 15 minutes
    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    q_exec('UPDATE password_otps SET used=1 WHERE user_id=? AND used=0', [(int)$u['id']]);
    q_exec('INSERT INTO password_otps(user_id,code_hash,expires,attempts,used,created) VALUES(?,?,?,?,?,?)',
        [(int)$u['id'], password_hash($code, PASSWORD_DEFAULT), now() + OTP_MINUTES * 60, 0, 0, now()]);
    return send_mail($u['email'], 'Lofan – your password reset code',
        "Hello " . $u['name'] . ",\n\nYour code to reset your Lofan admin password is:\n\n    " . $code . "\n\nIt is valid for " . OTP_MINUTES . " minutes and can be used once.\nIf you did not ask for this, ignore this e-mail – your password stays the same.\n\nLofan Development & Trading");
}
/* Checks a code. Returns true only for the newest unused, unexpired code. A used code cannot be used again. */
function otp_accept($u, $code)
{
    $row = q_one('SELECT * FROM password_otps WHERE user_id=? AND used=0 ORDER BY id DESC LIMIT 1', [(int)$u['id']]);
    if (!$row || (int)$row['expires'] < now()) return false;
    if (!password_verify(str_val($code), $row['code_hash'])) return false;
    q_exec('UPDATE password_otps SET used=1 WHERE user_id=?', [(int)$u['id']]);
    return true;
}

/* ------------------------------------------------------------------ approvals (what staff asked, what the owner decided) */
function approval_add($kind, $ref, $title, $detail, $me)
{
    return q_insert('INSERT INTO approvals(kind,ref,title,detail,status,req_user,req_name,created) VALUES(?,?,?,?,?,?,?,?)',
        [$kind, (string)$ref, slice((string)$title, 290), slice((string)$detail, 1000), 'pending', (int)$me['id'], (string)$me['name'], now()]);
}
function approval_decide($ref, $kinds, $status, $decidedBy)
{
    $in = implode(',', array_fill(0, count($kinds), '?'));
    q_exec("UPDATE approvals SET status=?,decided_by=?,decided_at=? WHERE ref=? AND status='pending' AND kind IN ($in)",
        array_merge([$status, (string)$decidedBy, now(), (string)$ref], $kinds));
}
/* Owners see every request. Staff see their own open requests, and every decided one (with the name of who asked). */
function approval_list($me)
{
    $sql = 'SELECT * FROM approvals WHERE 1=1'; $p = [];
    if (!is_owner($me)) { $sql .= " AND (status<>'pending' OR req_user=?)"; $p[] = (int)$me['id']; }
    return q_all($sql . ' ORDER BY id DESC LIMIT 200', $p);
}

/* ------------------------------------------------------------------ enquiries: reference photos and reply thread */
const ENQ_MAX_IMAGES = 5;
function enquiry_image_dir() { return priv_dir() . '/enquiry-images'; }
function save_enquiry_images($list, $eid)
{
    $names = [];
    foreach (array_slice((array)$list, 0, ENQ_MAX_IMAGES) as $i => $img) {
        $data = is_array($img) ? ($img['data'] ?? '') : $img;
        if (!is_string($data) || $data === '') continue;
        $names[] = save_data_url($data, enquiry_image_dir(), 'e' . (int)$eid . '-' . ($i + 1) . '-' . bin2hex(random_bytes(3)),
            ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'], 4000000);
    }
    return $names;
}
function delete_enquiry_files($eid)
{
    $row = q_one('SELECT images FROM enquiries WHERE id=?', [(int)$eid]);
    foreach ((array)json_decode((string)($row['images'] ?? ''), true) as $f) if (is_string($f)) @unlink(enquiry_image_dir() . '/' . basename($f));
    q_exec('DELETE FROM enquiry_msgs WHERE enquiry_id=?', [(int)$eid]);
}
/* The reply text: the owner's template with the customer's first name and topic filled in. */
function enquiry_reply_text($enq)
{
    $t = (string)(get_settings()['enquiry']['template'] ?? '');
    $first = trim(explode(' ', trim((string)$enq['name']))[0] ?? '');
    $topic = trim((string)($enq['type'] ?? '')) !== '' ? 'about ' . strtolower(trim($enq['type'])) : '';
    $txt = strtr($t, ['{name}' => $first !== '' ? $first : 'there', '{topic}' => $topic]);
    $txt = preg_replace('/[ \t]{2,}/', ' ', $txt);                 // an empty {topic} must not leave a double space
    $txt = preg_replace('/ +([,.!?])/', '$1', $txt);
    return slice(trim($txt), 900);
}

/* ------------------------------------------------------------------ card payments: MyFatoorah hosted payment page */
/* Base web address of the live server, used for the "come back after paying" links. */
function site_base_url()
{
    return (is_https() ? 'https' : 'http') . '://' . (string)($_SERVER['HTTP_HOST'] ?? 'lofan.qa');
}
function mf_base($test)
{
    $c = cfg();
    if (!empty($c['myfatoorah_base'])) return rtrim((string)$c['myfatoorah_base'], '/');     // test server only
    return $test ? 'https://apitest.myfatoorah.com' : 'https://api.myfatoorah.com';
}
/* One call to the provider. Returns the Data object, or throws a friendly error (details go to the server log). */
function mf_call($path, $token, $payload)
{
    $cfg = get_settings()['payments']['card'];
    list($body, $code, $err) = http_json(mf_base(!empty($cfg['test'])) . $path, $payload, ['Authorization: Bearer ' . $token], [], 25);
    if (is_string($body)) $body = preg_replace('/^\xEF\xBB\xBF/', '', $body);   // some servers start the answer with an invisible byte-order mark
    $j = is_string($body) ? json_decode($body, true) : null;
    if (!is_array($j) || empty($j['IsSuccess'])) {
        error_log('MyFatoorah ' . $path . ' failed (HTTP ' . $code . ' ' . $err . '): ' . slice((string)$body, 400));
        throw new ApiError(502, 'The card payment page could not be opened. Please choose another payment method or try again.');
    }
    return is_array($j['Data'] ?? null) ? $j['Data'] : [];
}

/* ------------------------------------------------------------------ automatic chat replies */
function customer_order_text($o)
{
    $label = ['Awaiting payment' => 'Not confirmed yet - waiting for your payment', 'Payment submitted' => 'We are verifying your payment',
        'Payment confirmed' => 'Order confirmed', 'Preparing' => 'Being prepared', 'Out for delivery' => 'Out for delivery',
        'Delivered' => 'Delivered', 'Cancelled' => 'Cancelled'];
    return 'Order ' . $o['id'] . ': ' . ($label[$o['status']] ?? $o['status']) . '. Total ' . (int)$o['total'] . ' QAR.';
}
/* Texts of the automatic replies to a customer message (the message is already saved). Returns a list of strings. */
function chat_auto_texts($u, $text, $prevAdminAt)
{
    $c = get_settings()['chat'];
    if (empty($c['autoReply'])) return [];
    $help = clean($c['orderHelp'], 400);
    $lastHelpAt = $help === '' ? 0 : (int)q_val('SELECT MAX(created) FROM messages WHERE user_id=? AND auto=1 AND body=?', [(int)$u['id'], $help]);   // do not repeat the hint within 30 minutes
    $out = [];
    if ($prevAdminAt === 0 || now() - $prevAdminAt > 24 * 3600) $out[] = clean($c['welcome'], 700);     // first message, or back after a day
    $isLoc = strpos($text, '[loc:') === 0;
    if (!$isLoc && preg_match('/\bLF-[A-Z0-9]{6}\b/', strtoupper($text), $mm)) {
        $o = q_one('SELECT * FROM orders WHERE id=? AND user_id=?', [$mm[0], (int)$u['id']]);
        $out[] = $o ? customer_order_text($o) . ' Our team will update you here if anything changes.'
                    : 'We could not find ' . $mm[0] . ' on your account. Please check the number in My Account > My Orders.';
    } elseif (!$isLoc && preg_match('/\b(order|track|tracking|delivery|deliver|shipping|status|payment|paid)\b/i', $text) && now() - $lastHelpAt > 1800) {
        $out[] = $help;
    }
    return array_values(array_filter($out, function ($t) { return $t !== ''; }));
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
        q_exec("DELETE FROM approvals WHERE kind='order_delete'");
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
    if (!empty($o['enquiries'])) {
        foreach (q_all('SELECT id FROM enquiries') as $e) delete_enquiry_files((int)$e['id']);   // photos and reply thread too
        $n['enquiries'] = q_exec('DELETE FROM enquiries');
    }
    if (!empty($o['notifications'])) { $n['notifications'] = q_exec('DELETE FROM notifications'); }
    if (!empty($o['log'])) { $n['log'] = q_exec('DELETE FROM admin_log'); }
    sweep_soldout();
    return $n;
}
