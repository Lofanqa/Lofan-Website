<?php
/* LOFAN – API routes. One function; returns [http_code, data] (or ['raw', bytes, content_type, filename]). */
defined('LOFAN') or exit;

function handle_api($method, $route, $body)
{
    $m = [];
    $R = function ($mth, $pat) use ($method, $route, &$m) {
        return $method === $mth && preg_match('#^' . $pat . '$#D', $route, $m) === 1;
    };
    $json = function () use ($body) {   // the request JSON as an array
        if ($body === '' || $body === null) return [];
        $ct = $_SERVER['CONTENT_TYPE'] ?? ($_SERVER['HTTP_CONTENT_TYPE'] ?? '');
        if (stripos($ct, 'application/json') === false) throw new ApiError(415, 'JSON required');
        $d = json_decode($body, true);
        if (!is_array($d)) throw new ApiError(400, 'Invalid JSON');
        return $d;
    };
    $objmap = function ($pairs) { $o = new stdClass; foreach ($pairs as $k => $v) $o->{(string)$k} = $v; return $o; };
    $msg_out = function ($rows) {
        $out = [];
        foreach ($rows as $r) {
            $loc = null;
            if (preg_match('/^\[loc:(-?\d+\.\d+),(-?\d+\.\d+)\]$/D', (string)$r['body'], $mm)) $loc = ['lat' => (float)$mm[1], 'lng' => (float)$mm[2]];
            $out[] = ['id' => (int)$r['id'], 'sender' => $r['sender'], 'body' => $loc ? '' : $r['body'], 'created' => (int)$r['created'], 'loc' => $loc,
                'auto' => !empty($r['auto'])];
        }
        return $out;
    };
    $one_msg = function ($id) use ($msg_out) { return $msg_out([q_one('SELECT * FROM messages WHERE id=?', [(int)$id])])[0]; };
    $cats = function () use ($objmap) {
        $c = [];
        foreach (q_all('SELECT `key`,label FROM categories ORDER BY sort, `key`') as $r) $c[$r['key']] = $r['label'];
        return $objmap($c);
    };

    /* ================= public ================= */
    if ($R('GET', 'me')) {
        $u = current_user();
        return [200, ['user' => $u ? public_user($u) : null]];
    }

    if ($R('POST', 'register')) {
        $d = $json();
        $name = clean($d['name'] ?? '', 80); $email = lower(clean($d['email'] ?? '', 120)); $phone = norm_phone($d['phone'] ?? '');
        $pw = str_val($d['password'] ?? '');
        if (slen($name) < 2) throw new ApiError(400, 'Please enter your full name.', 'name');
        if (!valid_phone($phone)) throw new ApiError(400, 'Please enter a valid mobile number.', 'phone');
        if (!valid_email($email)) throw new ApiError(400, 'Please enter a valid email address.', 'email');
        if (!password_ok($pw)) throw new ApiError(400, PASSWORD_RULE, 'password');
        $em = q_one('SELECT google_sub, `hash` FROM users WHERE email=?', [$email]);
        $ph = q_val('SELECT 1 FROM users WHERE phone=?', [$phone]);
        if ($em && $ph) throw new ApiError(409, 'This email and mobile number are already registered to an existing account. Please sign in instead.', 'email');
        if ($em) {
            $extra = (!empty($em['google_sub']) && empty($em['hash'])) ? ' It was created with Google – choose "Continue with Google".' : '';
            throw new ApiError(409, 'This email is already registered to an existing account. Please sign in, or use a different email.' . $extra, 'email');
        }
        if ($ph) throw new ApiError(409, 'This mobile number is already registered to an existing account. Please sign in, or use a different number.', 'phone');
        try {
            $id = q_insert("INSERT INTO users(name,email,phone,salt,`hash`,role,created) VALUES(?,?,?,?,?,?,?)", [$name, $email, $phone, '', hash_new_pw($pw), 'customer', now()]);
        } catch (PDOException $e) {
            throw new ApiError(409, 'This email or mobile number is already registered to an existing account. Please sign in instead.', 'email');
        }
        start_session($id);
        return [200, ['user' => public_user(user_by_id($id))]];
    }

    if ($R('POST', 'login')) {
        $d = $json();
        $ident = lower(clean($d['id'] ?? '', 120)); $pw = str_val($d['password'] ?? '');
        throttle(client_ip() . $ident);
        $u = q_one('SELECT * FROM users WHERE email=? OR phone=?', [$ident, valid_phone($ident) ? norm_phone($ident) : '-']);
        $ok = false;
        if ($u && !empty($u['hash'])) $ok = check_pw($pw, $u);
        elseif ($u && !empty($u['google_sub'])) throw new ApiError(401, 'This account uses Google. Please choose "Continue with Google".');
        if (!$ok) {
            if ($u && $u['role'] === 'admin') log_admin('login_failed', 'Wrong password for ' . $u['email'], $u, true);
            throw new ApiError(401, 'Incorrect email/phone or password.');
        }
        if (!empty($u['disabled'])) {
            log_admin('login_blocked', 'Disabled account tried to sign in: ' . $u['email'], $u, true);
            throw new ApiError(401, 'This account has been disabled. Please contact the owner.');
        }
        start_session($u['id'], $u['role'] === 'admin');
        if ($u['role'] === 'admin') log_admin('login', 'Signed in', $u);
        return [200, ['user' => public_user($u)]];
    }

    if ($R('GET', 'check')) {   // live "is this email / mobile already registered?" hint on the sign-up form
        throttle('chk' . client_ip(), 80, 600);
        $em = lower(clean(qs('email'), 120)); $ph = norm_phone(qs('phone'));
        $out = [];
        if ($em !== '' && valid_email($em)) $out['emailTaken'] = (bool)q_val('SELECT 1 FROM users WHERE email=?', [$em]);
        if ($ph !== '' && valid_phone($ph)) $out['phoneTaken'] = (bool)q_val('SELECT 1 FROM users WHERE phone=?', [$ph]);
        return [200, $out ?: new stdClass];
    }

    if ($R('GET', 'config')) {
        $st = get_settings(); $co = $st['company'];
        return [200, ['googleClientId' => google_client_id(), 'whatsapp' => $co['whatsapp'], 'phone' => $co['phone'],
            'shipping' => ['fee' => (int)$st['shipping']['fee'], 'freeFrom' => (int)$st['shipping']['freeFrom']]]];
    }

    if ($R('POST', 'google')) {
        $d = $json();
        $cid = google_client_id();
        if (!$cid) throw new ApiError(503, 'Google sign-in is not set up yet.');
        throttle('g' . client_ip(), 20);
        $info = verify_google($d['credential'] ?? '', $cid);
        $email = lower($info['email']); $sub = $info['sub'];
        $u = q_one('SELECT * FROM users WHERE google_sub=? OR email=?', [$sub, $email]);
        $created = false;
        if ($u) {
            if ($u['role'] === 'admin') throw new ApiError(403, 'Admin accounts must sign in with email and password.');
            if (empty($u['google_sub'])) q_exec('UPDATE users SET google_sub=? WHERE id=?', [$sub, (int)$u['id']]);
            $uid = (int)$u['id'];
        } else {
            $name = clean(($info['name'] ?? '') ?: explode('@', $email)[0], 80);
            $uid = q_insert('INSERT INTO users(name,email,phone,salt,`hash`,role,created,google_sub) VALUES(?,?,NULL,NULL,NULL,?,?,?)', [$name, $email, 'customer', now(), $sub]);
            $created = true;
        }
        start_session($uid);
        return [200, ['user' => public_user(user_by_id($uid)), 'created' => $created]];
    }

    /* password reset for admins and staff with a 6-digit code sent to their login e-mail */
    if ($R('POST', 'auth/otp/request')) {   // "Forgot password?" on the admin sign-in page. Always the same answer, so it reveals nothing.
        $d = $json(); $em = lower(clean($d['email'] ?? '', 120));
        throttle('otpreq' . client_ip(), 6, 900);
        $u = $em !== '' ? q_one("SELECT * FROM users WHERE email=? AND role='admin' AND (disabled IS NULL OR disabled=0)", [$em]) : null;
        if ($u) otp_issue($u);
        return [200, ['ok' => true, 'message' => 'If this e-mail belongs to an admin account, a 6-digit code has been sent to it. The code is valid for ' . OTP_MINUTES . ' minutes.']];
    }
    if ($R('POST', 'auth/otp/confirm')) {   // enter the code and the new password
        $d = $json(); $em = lower(clean($d['email'] ?? '', 120)); $code = str_val($d['code'] ?? ''); $pw = str_val($d['password'] ?? '');
        $u = $em !== '' ? q_one("SELECT * FROM users WHERE email=? AND role='admin'", [$em]) : null;
        if (!$u) throw new ApiError(400, 'The code is not valid or has expired. Please request a new one.', 'code');
        throttle('otp' . $u['id'], 8, 900);                         // wrong guesses are counted (this is kept even if the request fails)
        if (!preg_match('/^\d{6}$/', $code) || !otp_accept($u, $code)) throw new ApiError(400, 'The code is not valid or has expired. Please request a new one.', 'code');
        if (!password_ok($pw)) throw new ApiError(400, PASSWORD_RULE, 'password');
        q_exec("UPDATE users SET salt='', `hash`=? WHERE id=?", [hash_new_pw($pw), (int)$u['id']]);
        q_exec('DELETE FROM sessions WHERE user_id=?', [(int)$u['id']]);   // every device is signed out; sign in again with the new password
        log_admin('password.reset_code', 'Password reset with an e-mail code', $u);
        return [200, ['ok' => true]];
    }
    if ($R('POST', 'me/otp/request')) {     // logged-in admin / staff: send a code to their own login e-mail
        $u = need_admin();
        throttle('otpreq' . $u['id'], 6, 900);
        $parts = explode('@', (string)$u['email']);
        $masked = substr($parts[0], 0, 1) . '***@' . ($parts[1] ?? '');
        if (!otp_issue($u)) throw new ApiError(502, 'The code could not be sent right now (or you asked for several codes in the last 15 minutes). Please wait a few minutes and try again.');
        return [200, ['ok' => true, 'sentTo' => $masked]];
    }

    if ($R('POST', 'logout')) {
        $cu = current_user();
        if ($cu && $cu['role'] === 'admin') log_admin('logout', 'Signed out', $cu);
        $tok = $_COOKIE['lofan_session'] ?? '';
        if ($tok !== '' && preg_match('/^[A-Za-z0-9_-]+$/D', $tok)) q_exec('DELETE FROM sessions WHERE token=?', [$tok]);
        set_session_cookie('', time() - 3600);
        return [200, ['ok' => true]];
    }

    if ($R('GET', 'products')) {
        $s = get_settings();
        $prods = array_map(function ($p) {
            foreach (['id', 'price', 'stock'] as $k) $p[$k] = (int)$p[$k];
            $p['images'] = product_images($p);                      // photos shown as a slider (first = main photo)
            $p['size'] = (string)($p['size'] ?? ''); $p['includes'] = (string)($p['includes'] ?? '');
            return $p;
        }, q_all('SELECT id,name,cat,price,stock,img,images,size,includes,`desc` FROM products WHERE active=1 ORDER BY id DESC'));   // newest first
        return [200, ['categories' => $cats(), 'products' => $prods, 'shipping' => $s['shipping'], 'currency' => CURRENCY, 'company' => $s['company']]];
    }

    if ($R('POST', 'enquiries')) {
        $d = $json();
        $name = clean($d['name'] ?? '', 80); $email = clean($d['email'] ?? '', 120); $phone = clean($d['phone'] ?? '', 30); $msg = clean($d['message'] ?? '', 2000);
        if (slen($name) < 2) throw new ApiError(400, 'Please enter your full name.', 'name');
        if (!valid_email($email)) throw new ApiError(400, 'Please enter a valid email address.', 'email');
        if (!valid_phone(norm_phone($phone))) throw new ApiError(400, 'Please enter your mobile number (we reply on WhatsApp or SMS).', 'phone');
        if (slen($msg) < 5) throw new ApiError(400, 'Please describe what you need.', 'message');
        if (is_array($d['images'] ?? null) && count($d['images']) > ENQ_MAX_IMAGES) throw new ApiError(400, 'You can attach up to ' . ENQ_MAX_IMAGES . ' reference photos.');
        $type = clean($d['type'] ?? '', 60);
        $id = q_insert('INSERT INTO enquiries(name,company,email,phone,type,qty,message,created) VALUES(?,?,?,?,?,?,?,?)',
            [$name, clean($d['company'] ?? '', 80), $email, $phone, $type, clean($d['qty'] ?? '', 60), $msg, now()]);
        $files = save_enquiry_images($d['images'] ?? [], $id);
        if ($files) q_exec('UPDATE enquiries SET images=? WHERE id=?', [json_encode($files, JSON_UNESCAPED_SLASHES), $id]);
        q_exec("INSERT INTO enquiry_msgs(enquiry_id,sender,channel,body,by_name,created) VALUES(?,?,?,?,?,?)", [$id, 'customer', 'web', $msg, $name, now()]);
        notify('enquiry', "New enquiry from $name", ($type !== '' ? $type . ' · ' : '') . $phone . ($files ? ' · ' . count($files) . ' photo(s)' : ''), (string)$id);
        return [200, ['ok' => true]];
    }

    if ($R('GET', 'admin/status')) return [200, ['hasAdmin' => (bool)q_val("SELECT 1 FROM users WHERE role='admin'")]];

    if ($R('POST', 'admin/setup')) {
        if (q_val("SELECT 1 FROM users WHERE role='admin'")) throw new ApiError(403, 'An admin account already exists.');
        $d = $json();
        $name = clean($d['name'] ?? '', 80); $email = lower(clean($d['email'] ?? '', 120)); $pw = str_val($d['password'] ?? '');
        if (strlen($name) < 2 || !valid_email($email)) throw new ApiError(400, 'Enter a name and a valid email.');
        if (!password_ok($pw)) throw new ApiError(400, 'Admin ' . lcfirst(PASSWORD_RULE));
        if (q_val('SELECT 1 FROM users WHERE email=?', [$email])) throw new ApiError(409, 'That email is already used by a customer account.');
        $id = q_insert("INSERT INTO users(name,email,phone,salt,`hash`,role,created,admin_level) VALUES(?,?,?,?,?,?,?,?)", [$name, $email, 'admin-' . bin2hex(random_bytes(4)), '', hash_new_pw($pw), 'admin', now(), 'owner']);
        start_session($id, true);
        log_admin('admin.setup', 'First admin (owner) account created: ' . $email, user_by_id($id));
        return [200, ['user' => public_user(user_by_id($id))]];
    }

    /* ================= customer ================= */
    if ($R('PUT', 'me')) {
        $u = need_user(); $d = $json();
        $name = clean($d['name'] ?? '', 80); $email = lower(clean($d['email'] ?? '', 120)); $phone = norm_phone($d['phone'] ?? '');
        if (slen($name) < 2) throw new ApiError(400, 'Please enter your name.');
        if ($u['role'] === 'admin') $phone = $u['phone'];
        elseif (!valid_phone($phone)) throw new ApiError(400, 'Please enter a valid phone number.');
        if (!valid_email($email)) throw new ApiError(400, 'Please enter a valid email address.');
        if (q_val('SELECT 1 FROM users WHERE email=? AND id<>?', [$email, (int)$u['id']])) throw new ApiError(409, 'This email is already registered to another account. Please use a different email.', 'email');
        if (q_val('SELECT 1 FROM users WHERE phone=? AND id<>?', [$phone, (int)$u['id']])) throw new ApiError(409, 'This mobile number is already registered to another account. Please use a different number.', 'phone');
        q_exec('UPDATE users SET name=?,email=?,phone=?,address=? WHERE id=?', [$name, $email, $phone, clean($d['address'] ?? '', 300), (int)$u['id']]);
        return [200, ['user' => public_user(user_by_id($u['id']))]];
    }

    if ($R('PUT', 'me/location')) {   // customer shares / updates their current location (their own explicit action)
        $u = need_user(); $d = $json();
        $loc = valid_loc($d['lat'] ?? null, $d['lng'] ?? null);
        if (!$loc) throw new ApiError(400, 'That location could not be read. Please try again.');
        save_user_loc($u['id'], $loc);
        return [200, ['user' => public_user(user_by_id($u['id']))]];
    }
    if ($R('DELETE', 'me/location')) {
        $u = need_user();
        q_exec('UPDATE users SET lat=NULL,lng=NULL,loc_at=NULL WHERE id=?', [(int)$u['id']]);
        return [200, ['user' => public_user(user_by_id($u['id']))]];
    }

    if ($R('POST', 'me/password')) {
        $u = need_user(); $d = $json();
        if (!empty($u['hash']) && !check_pw(str_val($d['current'] ?? ''), $u)) throw new ApiError(400, 'Current password is incorrect.');   // Google-only accounts have no password yet
        $new = str_val($d['new'] ?? '');
        if (!password_ok($new)) throw new ApiError(400, 'New ' . lcfirst(PASSWORD_RULE), 'new');
        q_exec("UPDATE users SET salt='', `hash`=? WHERE id=?", [hash_new_pw($new), (int)$u['id']]);
        q_exec('DELETE FROM sessions WHERE user_id=? AND token<>?', [(int)$u['id'], session_token()]);   // other devices are signed out
        if ($u['role'] === 'admin') log_admin('password.change', 'Changed own password', $u);
        return [200, ['ok' => true]];
    }

    if ($R('GET', 'payment-info')) { need_user(); return [200, payment_info()]; }

    if ($R('POST', 'orders')) {
        $u = need_user(); $d = $json();
        $dl = is_array($d['delivery'] ?? null) ? $d['delivery'] : [];
        $delivery = ['name' => clean($dl['name'] ?? '', 80), 'phone' => norm_phone($dl['phone'] ?? ''), 'email' => clean($dl['email'] ?? '', 120),
            'address' => clean($dl['address'] ?? '', 300), 'notes' => clean($dl['notes'] ?? '', 300)];
        $loc = valid_loc($dl['lat'] ?? null, $dl['lng'] ?? null);   // optional: the customer chose "Share my current location"
        if ($loc) {
            $delivery['lat'] = $loc[0]; $delivery['lng'] = $loc[1];
            $delivery['acc'] = max(0, min(100000, (int)(is_numeric($dl['acc'] ?? null) ? $dl['acc'] : 0)));
            save_user_loc($u['id'], $loc);
        }
        if (slen($delivery['name']) < 2 || !valid_phone($delivery['phone']) || !valid_email($delivery['email']) || strlen($delivery['address']) < 5)
            throw new ApiError(400, 'Please complete your delivery details (name, phone, email, address).');
        $want = [];
        foreach (is_array($d['items'] ?? null) ? $d['items'] : [] as $it) {
            if (!is_array($it) || !isset($it['id'], $it['qty']) || !is_numeric($it['id']) || !is_numeric($it['qty'])) throw new ApiError(400, 'Invalid cart');
            $pid = (int)$it['id'];
            $want[$pid] = ($want[$pid] ?? 0) + max(0, (int)$it['qty']);
        }
        $lines = []; $subtotal = 0;
        foreach ($want as $pid => $qty) {
            $p = q_one('SELECT * FROM products WHERE id=? AND active=1', [$pid]);
            if (!$p || $qty < 1) throw new ApiError(400, 'An item in your cart is no longer available.');
            if ((int)$p['stock'] < $qty) throw new ApiError(409, 'Sorry, only ' . (int)$p['stock'] . ' of "' . $p['name'] . '" left in stock.');
            $lines[] = ['id' => $pid, 'name' => $p['name'], 'price' => (int)$p['price'], 'qty' => $qty];
            $subtotal += (int)$p['price'] * $qty;
        }
        if (!$lines) throw new ApiError(400, 'Your cart is empty.');
        $sh = get_settings()['shipping'];
        $shipping = $subtotal >= (int)$sh['freeFrom'] ? 0 : (int)$sh['fee'];
        foreach ($lines as $ln) {
            if (q_exec('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?', [$ln['qty'], $ln['id'], $ln['qty']]) < 1)
                throw new ApiError(409, 'Sorry, "' . $ln['name'] . '" has just sold out. Please refresh and try again.');
        }
        $oid = new_order_id();
        q_exec('INSERT INTO orders(id,user_id,created,items,subtotal,shipping,total,delivery,status) VALUES(?,?,?,?,?,?,?,?,?)',
            [$oid, (int)$u['id'], now(), json_encode($lines, JSON_UNESCAPED_UNICODE), $subtotal, $shipping, $subtotal + $shipping, json_encode($delivery, JSON_UNESCAPED_UNICODE), 'Awaiting payment']);
        add_event($oid, 'Awaiting payment', 'Order placed');
        q_exec("UPDATE users SET address=? WHERE id=? AND (address IS NULL OR address='')", [$delivery['address'], (int)$u['id']]);
        $n = array_sum(array_column($lines, 'qty'));
        notify('order', "New order $oid", $delivery['name'] . ' · ' . $n . ' item' . ($n != 1 ? 's' : '') . ' · ' . ($subtotal + $shipping) . ' ' . CURRENCY . ' · awaiting payment', $oid);
        queue_alert('placed', $oid);
        return [200, ['order' => order_out(order_by_id($oid))]];
    }

    if ($R('GET', 'orders')) {
        $u = need_user();
        return [200, ['orders' => array_map(function ($r) { return order_out($r); }, q_all('SELECT * FROM orders WHERE user_id=? ORDER BY created DESC', [(int)$u['id']]))]];
    }

    if ($R('GET', 'orders/(LF-[A-Z0-9]{6})')) {
        $u = need_user();
        $r = q_one('SELECT * FROM orders WHERE id=? AND user_id=?', [$m[1], (int)$u['id']]);
        if (!$r) throw new ApiError(404, 'Order not found');
        return [200, ['order' => order_out($r)]];
    }

    if ($R('POST', 'orders/(LF-[A-Z0-9]{6})/payment')) {
        $u = need_user(); $d = $json(); $oid = $m[1];
        $r = q_one('SELECT * FROM orders WHERE id=? AND user_id=?', [$oid, (int)$u['id']]);
        if (!$r) throw new ApiError(404, 'Order not found');
        if ($r['status'] === 'Cancelled') throw new ApiError(409, 'This order was cancelled (it was not paid in time). Please place a new order.');
        if ($r['status'] !== 'Awaiting payment') throw new ApiError(409, 'Payment was already submitted for this order.');
        $meth = null;
        foreach (payment_info()['methods'] as $x) if ($x['id'] === clean($d['method'] ?? '', 20)) $meth = $x;
        if (!$meth) throw new ApiError(400, 'Please choose a payment method.');
        $txn = clean($d['txn'] ?? '', 60);
        if (strlen($txn) < 4) throw new ApiError(400, 'Please enter the transaction / reference number from your payment receipt.');
        $receipt = null;
        $rc = $d['receipt'] ?? null;
        if (is_array($rc) && !empty($rc['data'])) {
            $receipt = save_data_url($rc['data'], receipts_dir(), $oid, ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'], 1500000);
        }
        if ($receipt === null && !empty(get_settings()['orders']['requireReceipt']))
            throw new ApiError(400, 'Please upload your payment receipt (a screenshot from your bank / wallet app). It is required to confirm your order.', 'receipt');
        q_exec('UPDATE orders SET method=?,txn=?,receipt=?,status=? WHERE id=?', [$meth['label'], $txn, $receipt, 'Payment submitted', $oid]);
        add_event($oid, 'Payment submitted', $meth['label'] . ' · ref ' . $txn);
        $dn = (json_decode($r['delivery'], true) ?: [])['name'] ?? '';
        notify('payment', "Payment submitted – $oid", $dn . ' paid ' . (int)$r['total'] . ' ' . CURRENCY . ' via ' . $meth['label'] . " (ref $txn). Please verify.", $oid);
        queue_alert('submitted', $oid);
        return [200, ['order' => order_out(order_by_id($oid))]];
    }

    /* card payment: the customer is sent to the payment provider's own page. Card details never reach this website. */
    if ($R('POST', 'orders/(LF-[A-Z0-9]{6})/card/start')) {
        $u = need_user(); $oid = $m[1];
        $r = q_one('SELECT * FROM orders WHERE id=? AND user_id=?', [$oid, (int)$u['id']]);
        if (!$r) throw new ApiError(404, 'Order not found');
        if ($r['status'] !== 'Awaiting payment') throw new ApiError(409, 'This order is no longer awaiting payment.');
        $cfg = get_settings()['payments']['card'];
        if (empty($cfg['enabled']) || str_val($cfg['apiToken']) === '') throw new ApiError(400, 'Card payment is not available right now. Please choose another payment method.');
        throttle('card' . $u['id'], 10, 600);
        $dl = json_decode($r['delivery'], true) ?: [];
        $back = site_base_url() . '/api/card/return/' . $oid;
        $inv = mf_call('/v2/SendPayment', $cfg['apiToken'], [
            'CustomerName' => slice(str_val($dl['name'] ?? 'Customer'), 60), 'InvoiceValue' => (int)$r['total'],
            'CustomerEmail' => valid_email(str_val($dl['email'] ?? '')) ? str_val($dl['email']) : str_val($u['email']),
            'NotificationOption' => 'LNK', 'CustomerReference' => $oid, 'Language' => 'EN',
            'CallBackUrl' => $back, 'ErrorUrl' => $back . '?fail=1', 'UserDefinedField' => 'Lofan order ' . $oid]);
        if (empty($inv['InvoiceURL']) || empty($inv['InvoiceId'])) throw new ApiError(502, 'The card payment page could not be opened. Please choose another payment method or try again.');
        q_exec('UPDATE orders SET method=?,txn=? WHERE id=?', ['Bank card (secure online)', 'MF-' . (int)$inv['InvoiceId'], $oid]);
        add_event($oid, 'Awaiting payment', 'Card payment page opened (ref MF-' . (int)$inv['InvoiceId'] . ')');
        return [200, ['url' => (string)$inv['InvoiceURL']]];
    }
    if ($R('GET', 'card/return/(LF-[A-Z0-9]{6})')) {   // the provider sends the customer back here; the server checks the payment itself
        $oid = $m[1]; $page = 'payment.html?order=' . $oid;
        $r = order_by_id($oid);
        if (!$r) return ['redirect', 'index.html'];
        if ($r['status'] !== 'Awaiting payment') return ['redirect', $page . '&paid=1'];
        $pid = qs('paymentId', '');
        $cfg = get_settings()['payments']['card'];
        if ($pid === '' || !ctype_digit($pid) || str_val($cfg['apiToken']) === '') return ['redirect', $page . '&failed=1'];
        $st = mf_call('/v2/GetPaymentStatus', $cfg['apiToken'], ['Key' => $pid, 'KeyType' => 'PaymentId']);
        $invId = (int)($st['InvoiceId'] ?? 0);
        $paid = ($st['InvoiceStatus'] ?? '') === 'Paid' && $r['txn'] === 'MF-' . $invId && abs((float)($st['InvoiceValue'] ?? 0) - (int)$r['total']) < 0.5;
        if (!$paid) return ['redirect', $page . '&failed=1'];
        $n = q_exec("UPDATE orders SET status='Payment confirmed', method='Bank card (secure online)', txn=? WHERE id=? AND status='Awaiting payment'", ['MF-' . $invId . ' / ' . $pid, $oid]);
        if ($n) {
            add_event($oid, 'Payment confirmed', 'Card payment approved by the payment provider (ref ' . $pid . ')');
            $dn = (json_decode($r['delivery'], true) ?: [])['name'] ?? '';
            notify('payment', "Card payment received – $oid", "$dn paid " . (int)$r['total'] . ' ' . CURRENCY . ' by card. Already confirmed.', $oid);
            queue_alert('confirmed', $oid);
        }
        return ['redirect', $page . '&paid=1'];
    }

    if ($R('POST', 'orders/(LF-[A-Z0-9]{6})/cancel')) {
        $u = need_user(); $oid = $m[1];
        $r = q_one('SELECT * FROM orders WHERE id=? AND user_id=?', [$oid, (int)$u['id']]);
        if (!$r) throw new ApiError(404, 'Order not found');
        if ($r['status'] !== 'Awaiting payment') throw new ApiError(409, 'Only unpaid orders can be cancelled here. Please contact us.');
        restore_stock($r);
        q_exec("UPDATE orders SET status='Cancelled' WHERE id=?", [$oid]);
        sweep_soldout();
        add_event($oid, 'Cancelled', 'Cancelled by customer');
        notify('order', "Order $oid cancelled", 'Cancelled by the customer before payment.', $oid);
        return [200, ['ok' => true]];
    }

    if ($R('POST', 'orders/(LF-[A-Z0-9]{6})/applepay/(session|pay)')) {
        $u = need_user(); $d = $json(); $oid = $m[1]; $step = $m[2];
        $r = q_one('SELECT * FROM orders WHERE id=? AND user_id=?', [$oid, (int)$u['id']]);
        if (!$r) throw new ApiError(404, 'Order not found');
        if ($r['status'] !== 'Awaiting payment') throw new ApiError(409, 'This order is no longer awaiting payment.');
        $ap = get_settings()['applepay'];
        if (empty($ap['enabled']) || applepay_missing($ap)) throw new ApiError(400, 'Apple Pay is not available right now.');
        if ($step === 'session') return [200, apple_validate($ap, $d['validationURL'] ?? '', $_SERVER['HTTP_HOST'] ?? '')];
        $token = $d['token'] ?? null;
        if (!is_array($token)) throw new ApiError(400, 'Missing Apple Pay token.');
        throttle('ap' . $u['id'], 10, 600);
        $delivery = json_decode($r['delivery'], true) ?: [];
        list($approved, $pid) = psp_charge($ap, $token, $r, $delivery['email'] ?? '', $delivery['name'] ?? '');
        if (!$approved) throw new ApiError(402, 'Your payment was declined. Please try another card or payment method.');
        q_exec('UPDATE orders SET method=?,txn=?,status=? WHERE id=?', ['Apple Pay', $pid, 'Payment confirmed', $oid]);
        add_event($oid, 'Payment confirmed', "Apple Pay – paid online (ref $pid)");
        notify('payment', "Apple Pay payment received – $oid", ($delivery['name'] ?? '') . ' paid ' . (int)$r['total'] . ' ' . CURRENCY . " by Apple Pay (ref $pid). Already confirmed.", $oid);
        queue_alert('confirmed', $oid);
        return [200, ['order' => order_out(order_by_id($oid))]];
    }

    /* ----- customer chat (website live chat with the admin) ----- */
    if ($R('GET', 'chat')) {
        $u = need_user();
        $after = (int)qs('after', '0');
        if (qs('open', '0') === '1') q_exec("UPDATE messages SET seen=1 WHERE user_id=? AND sender='admin'", [(int)$u['id']]);
        return [200, ['messages' => $msg_out(q_all('SELECT * FROM messages WHERE user_id=? AND id>? ORDER BY id LIMIT 200', [(int)$u['id'], $after]))]];
    }
    if ($R('GET', 'chat/unread')) {
        $u = need_user();
        return [200, ['unread' => (int)q_val("SELECT COUNT(*) FROM messages WHERE user_id=? AND sender='admin' AND seen=0", [(int)$u['id']])]];
    }
    if ($R('POST', 'chat')) {
        $u = need_user(); $d = $json();
        if ($u['role'] === 'admin') throw new ApiError(403, 'Use the admin chat page.');
        $text = clean($d['body'] ?? '', 1000); $loc = null;
        if (!empty($d['location'])) {
            $l = is_array($d['location']) ? $d['location'] : [];
            $loc = valid_loc($l['lat'] ?? null, $l['lng'] ?? null);
            if (!$loc) throw new ApiError(400, 'That location could not be read. Please try again.');
            $text = '[loc:' . num6($loc[0]) . ',' . num6($loc[1]) . ']';
            save_user_loc($u['id'], $loc);
        }
        if ($text === '') throw new ApiError(400, 'Type a message first.');
        throttle('chat' . $u['id'], 40, 60);
        $prevAdminAt = (int)q_val("SELECT MAX(created) FROM messages WHERE user_id=? AND sender='admin'", [(int)$u['id']]);
        $id = q_insert('INSERT INTO messages(user_id,sender,body,created) VALUES(?,?,?,?)', [(int)$u['id'], 'customer', $text, now()]);
        notify('chat', 'Message from ' . $u['name'], $loc ? '📍 Shared their location' : slice($text, 140), (string)$u['id']);
        foreach (chat_auto_texts($u, $text, $prevAdminAt) as $auto) {   // welcome / order-query replies from Lofan
            q_insert('INSERT INTO messages(user_id,sender,body,created,seen,auto) VALUES(?,?,?,?,0,1)', [(int)$u['id'], 'admin', $auto, now()]);
        }
        return [200, ['message' => $one_msg($id)]];
    }

    /* ================= admin ================= */
    if (strpos($route, 'admin/') === 0) need_admin();

    if ($R('GET', 'admin/orders')) {
        $st = qs('status');
        $rows = q_all("SELECT * FROM orders WHERE (?='' OR status=?) ORDER BY created DESC", [$st, $st]);
        return [200, ['orders' => array_map(function ($r) { return order_out($r, true); }, $rows), 'statuses' => STATUSES]];
    }

    if ($R('PUT', 'admin/orders/(LF-[A-Z0-9]{6})')) {
        $d = $json(); $oid = $m[1];
        $r = q_one('SELECT * FROM orders WHERE id=?', [$oid]);
        if (!$r) throw new ApiError(404, 'Order not found');
        $new = $d['status'] ?? null;
        if (!in_array($new, STATUSES, true)) throw new ApiError(400, 'Invalid status');
        if ($r['status'] === 'Cancelled' && $new !== 'Cancelled') throw new ApiError(409, 'Cancelled orders cannot be reopened.');
        if ($new === 'Cancelled' && $r['status'] !== 'Cancelled') restore_stock($r);
        q_exec('UPDATE orders SET status=? WHERE id=?', [$new, $oid]);
        sweep_soldout();
        add_event($oid, $new, clean($d['note'] ?? '', 200));
        log_admin('order.status', "$oid: {$r['status']} -> $new" . (clean($d['note'] ?? '', 80) !== '' ? ' (' . clean($d['note'], 80) . ')' : ''));
        if ($new === 'Payment confirmed' && $r['status'] !== 'Payment confirmed') queue_alert('confirmed', $oid);   // the order is only CONFIRMED after the payment is verified
        return [200, ['order' => order_out(order_by_id($oid), true)]];
    }

    /* ----- deleting an order: the owner can always do it; staff need the owner's approval first ----- */
    if ($R('DELETE', 'admin/orders/(LF-[A-Z0-9]{6})')) {
        $me = need_admin(); $oid = $m[1];
        $r = order_by_id($oid);
        if (!$r) throw new ApiError(404, 'Order not found');
        $how = 'by the owner';
        if (!is_owner($me)) {
            $ok = $r['del_state'] === 'approved' && now() - (int)$r['del_decided_at'] <= DELETE_APPROVAL_HOURS * 3600;
            if (!$ok) throw new ApiError(403, 'Only the owner can delete an order. Ask the owner for approval first (Request deletion).');
            $by = q_one("SELECT req_user FROM approvals WHERE ref=? AND kind='order_delete' AND status='approved' ORDER BY id DESC LIMIT 1", [$oid]);
            if (!$by || (int)$by['req_user'] !== (int)$me['id']) throw new ApiError(403, 'This deletion was approved for the staff member who asked for it.');
            $how = 'with approval of ' . $r['del_decided_by'];
        }
        $d = json_decode($r['delivery'], true) ?: [];
        purge_order($r);
        log_admin('order.delete', "Deleted order $oid (" . str_val($d['name'] ?? '') . ', ' . (int)$r['total'] . ' ' . CURRENCY . ', was "' . $r['status'] . '") ' . $how);
        return [200, ['ok' => true]];
    }
    if ($R('POST', 'admin/orders/(LF-[A-Z0-9]{6})/delete-request')) {
        $me = need_admin(); $oid = $m[1]; $d = $json();
        $r = order_by_id($oid);
        if (!$r) throw new ApiError(404, 'Order not found');
        if (is_owner($me)) throw new ApiError(400, 'You are an owner - you can delete this order directly.');
        if ($r['del_state'] === 'pending') throw new ApiError(409, 'A deletion request for this order is already waiting for the owner.');
        if ($r['del_state'] === 'approved' && now() - (int)$r['del_decided_at'] <= DELETE_APPROVAL_HOURS * 3600) throw new ApiError(409, 'The owner already approved this - you can delete the order now.');
        $reason = clean($d['reason'] ?? '', 300);
        if (slen($reason) < 3) throw new ApiError(400, 'Please write why this order should be deleted.');
        q_exec("UPDATE orders SET del_state='pending',del_by=?,del_reason=?,del_at=?,del_decided_by=NULL,del_decided_at=NULL WHERE id=?", [$me['name'], $reason, now(), $oid]);
        $dd = json_decode($r['delivery'], true) ?: [];
        approval_add('order_delete', $oid, "Delete order $oid", $reason . ' · ' . str_val($dd['name'] ?? '') . ' · ' . (int)$r['total'] . ' ' . CURRENCY, $me);
        notify('order', "Deletion request - $oid", $me['name'] . ' asks to delete this order (' . str_val($dd['name'] ?? '') . ', ' . (int)$r['total'] . ' ' . CURRENCY . '): ' . $reason, $oid, null, true);
        log_admin('order.delete_request', "$oid: requested by " . $me['name'] . ' - ' . $reason);
        return [200, ['order' => order_out(order_by_id($oid), true)]];
    }
    if ($R('POST', 'admin/orders/(LF-[A-Z0-9]{6})/delete-decision')) {
        $me = need_owner(); $oid = $m[1]; $d = $json();
        $r = order_by_id($oid);
        if (!$r) throw new ApiError(404, 'Order not found');
        if ($r['del_state'] !== 'pending') throw new ApiError(409, 'There is no deletion request waiting for this order.');
        $yes = !empty($d['approve']);
        $asked = q_one("SELECT req_user FROM approvals WHERE ref=? AND kind='order_delete' AND status='pending' ORDER BY id DESC LIMIT 1", [$oid]);
        q_exec('UPDATE orders SET del_state=?,del_decided_by=?,del_decided_at=? WHERE id=?', [$yes ? 'approved' : 'rejected', $me['name'], now(), $oid]);
        approval_decide($oid, ['order_delete'], $yes ? 'approved' : 'rejected', $me['name']);
        // the answer goes only to the staff member who asked (everybody else sees it in the approvals list)
        notify('order', ($yes ? 'Deletion approved' : 'Deletion rejected') . " - $oid", $me['name'] . ($yes ? ' approved' : ' rejected') . ' your request to delete this order.', $oid,
            $asked ? (int)$asked['req_user'] : null, !$asked);
        log_admin($yes ? 'order.delete_approve' : 'order.delete_reject', "$oid: " . ($yes ? 'approved' : 'rejected') . ' (requested by ' . $r['del_by'] . ')');
        return [200, ['order' => order_out(order_by_id($oid), true)]];
    }

    if ($R('GET', 'admin/receipt/(LF-[A-Z0-9]{6})')) {
        $r = q_one('SELECT receipt FROM orders WHERE id=?', [$m[1]]);
        if (!$r || empty($r['receipt'])) throw new ApiError(404, 'No receipt');
        $path = receipts_dir() . '/' . basename($r['receipt']);
        if (!is_file($path)) throw new ApiError(404, 'No receipt');
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'pdf' => 'application/pdf'];
        return ['raw', file_get_contents($path), $types[$ext] ?? 'application/octet-stream', basename($path)];
    }

    /* what each admin may see: shared notices, owner-only notices (owners), and notices addressed to this admin only */
    $notif_vis = function ($me) { return ['((to_user IS NULL AND (owners_only=0 OR ?=1)) OR to_user=?)', [is_owner($me) ? 1 : 0, (int)$me['id']]]; };
    if ($R('GET', 'admin/notifications')) {
        $me = current_user(); $after = (int)qs('after', '0');
        list($vis, $vp) = $notif_vis($me);
        $fix = function ($r) { $r['id'] = (int)$r['id']; $r['created'] = (int)$r['created']; $r['read'] = (int)$r['read']; return $r; };
        $items = array_map($fix, q_all("SELECT * FROM notifications WHERE $vis AND id>? ORDER BY id DESC LIMIT 100", array_merge($vp, [$after])));
        $recent = $after === 0 ? array_map($fix, q_all("SELECT * FROM notifications WHERE $vis ORDER BY id DESC LIMIT 30", $vp)) : [];
        return [200, ['items' => $items, 'recent' => $recent,
            'unread' => (int)q_val("SELECT COUNT(*) FROM notifications WHERE $vis AND `read`=0", $vp),
            'latest' => (int)q_val("SELECT COALESCE(MAX(id),0) FROM notifications WHERE $vis", $vp),
            'chatUnread' => (int)q_val("SELECT COUNT(*) FROM messages WHERE sender='customer' AND seen=0")]];
    }
    if ($R('POST', 'admin/notifications/read')) {
        list($vis, $vp) = $notif_vis(current_user());
        q_exec("UPDATE notifications SET `read`=1 WHERE $vis", $vp); return [200, ['ok' => true]];
    }
    if ($R('POST', 'admin/notifications/delete')) {   // remove unwanted notifications (only the ones this admin can see): ?mode = read | all | ids
        $me = current_user(); $d = $json(); $mode = str_val($d['mode'] ?? ''); $n = 0;
        list($vis, $vp) = $notif_vis($me);
        if ($mode === 'read') $n = q_exec("DELETE FROM notifications WHERE $vis AND `read`=1", $vp);
        elseif ($mode === 'all') $n = q_exec("DELETE FROM notifications WHERE $vis", $vp);
        elseif ($mode === 'ids' && is_array($d['ids'] ?? null)) { foreach ($d['ids'] as $i) $n += q_exec("DELETE FROM notifications WHERE id=? AND $vis", array_merge([(int)$i], $vp)); }
        else throw new ApiError(400, 'Choose what to delete.');
        log_admin('notifications.delete', "$mode: $n removed");
        return [200, ['ok' => true, 'deleted' => $n]];
    }
    if ($R('DELETE', 'admin/notifications/(\d+)')) {
        list($vis, $vp) = $notif_vis(current_user());
        q_exec("DELETE FROM notifications WHERE id=? AND $vis", array_merge([(int)$m[1]], $vp));
        return [200, ['ok' => true]];
    }

    /* approvals: owners see every request; staff see their own open requests and every decided one (with who asked) */
    if ($R('GET', 'admin/approvals')) {
        return [200, ['approvals' => array_map(function ($r) {
            return ['id' => (int)$r['id'], 'kind' => $r['kind'], 'ref' => $r['ref'], 'title' => $r['title'], 'detail' => $r['detail'], 'status' => $r['status'],
                'by' => $r['req_name'], 'byId' => (int)$r['req_user'], 'decidedBy' => (string)$r['decided_by'], 'created' => (int)$r['created'], 'decidedAt' => (int)$r['decided_at']];
        }, approval_list(current_user()))]];
    }

    if ($R('GET', 'admin/chats')) {
        $rows = q_all("SELECT u.id,u.name,u.phone,
            (SELECT body FROM messages m WHERE m.user_id=u.id ORDER BY m.id DESC LIMIT 1) AS `last`,
            (SELECT MAX(created) FROM messages m WHERE m.user_id=u.id) AS lastAt,
            (SELECT COUNT(*) FROM messages m WHERE m.user_id=u.id AND m.sender='customer' AND m.seen=0) AS unread
            FROM users u WHERE u.role='customer' AND EXISTS(SELECT 1 FROM messages m WHERE m.user_id=u.id) ORDER BY lastAt DESC");
        return [200, ['threads' => array_map(function ($r) { $r['id'] = (int)$r['id']; $r['lastAt'] = (int)$r['lastAt']; $r['unread'] = (int)$r['unread']; return $r; }, $rows)]];
    }
    if ($R('GET', 'admin/chats/(\d+)')) {
        $cu = q_one("SELECT id,name,phone,email,address,lat,lng,loc_at FROM users WHERE id=? AND role='customer'", [(int)$m[1]]);
        if (!$cu) throw new ApiError(404, 'Customer not found');
        $after = (int)qs('after', '0');
        q_exec("UPDATE messages SET seen=1 WHERE user_id=? AND sender='customer'", [(int)$cu['id']]);
        $cu['id'] = (int)$cu['id'];
        foreach (['lat', 'lng'] as $k) if ($cu[$k] !== null) $cu[$k] = (float)$cu[$k];
        if ($cu['loc_at'] !== null) $cu['loc_at'] = (int)$cu['loc_at'];
        return [200, ['customer' => $cu, 'messages' => $msg_out(q_all('SELECT * FROM messages WHERE user_id=? AND id>? ORDER BY id LIMIT 300', [(int)$cu['id'], $after]))]];
    }
    if ($R('POST', 'admin/chats/(\d+)')) {
        $cu = q_one("SELECT id FROM users WHERE id=? AND role='customer'", [(int)$m[1]]);
        if (!$cu) throw new ApiError(404, 'Customer not found');
        $text = clean($json()['body'] ?? '', 1000);
        if ($text === '') throw new ApiError(400, 'Type a message first.');
        $id = q_insert('INSERT INTO messages(user_id,sender,body,created,seen) VALUES(?,?,?,?,0)', [(int)$cu['id'], 'admin', $text, now()]);
        q_exec("UPDATE messages SET seen=1 WHERE user_id=? AND sender='customer'", [(int)$cu['id']]);
        return [200, ['message' => $one_msg($id)]];
    }

    if ($R('DELETE', 'admin/chats/(\d+)/messages/(\d+)')) {   // delete one unwanted chat message
        q_exec('DELETE FROM messages WHERE id=? AND user_id=?', [(int)$m[2], (int)$m[1]]);
        log_admin('chat.delete', 'Deleted one chat message of customer #' . (int)$m[1]);
        return [200, ['ok' => true]];
    }
    if ($R('DELETE', 'admin/chats/(\d+)')) {                  // clear a whole conversation
        $n = q_exec('DELETE FROM messages WHERE user_id=?', [(int)$m[1]]);
        q_exec("DELETE FROM notifications WHERE kind='chat' AND ref=?", [(string)(int)$m[1]]);
        log_admin('chat.clear', "Cleared the conversation with customer #" . (int)$m[1] . " ($n messages)");
        return [200, ['ok' => true, 'deleted' => $n]];
    }

    $prod_out = function ($p) {   // one product as the admin sees it (photos, size, and a change waiting for the owner)
        foreach (['id', 'price', 'stock', 'active'] as $k) $p[$k] = (int)$p[$k];
        $p['images'] = product_images($p);
        $p['size'] = (string)($p['size'] ?? ''); $p['includes'] = (string)($p['includes'] ?? '');
        $req = json_decode((string)($p['req_json'] ?? ''), true);
        $p['request'] = (is_array($req) && $req) ? ['by' => (string)$p['req_by'], 'at' => (int)$p['req_at'], 'changes' => $req] : null;
        unset($p['req_json'], $p['req_by'], $p['req_at']);
        return $p;
    };
    if ($R('GET', 'admin/products')) {
        return [200, ['categories' => $cats(), 'products' => array_map($prod_out, q_all('SELECT * FROM products ORDER BY id DESC'))]];
    }

    if ($R('POST', 'admin/products/delete-soldout')) {   // one click: permanently remove every item that has no stock
        $n = q_exec('DELETE FROM products WHERE stock<=0');
        log_admin('product.deleteSoldOut', "$n sold-out item(s) deleted");
        return [200, ['ok' => true, 'deleted' => $n]];
    }
    /* Prices, descriptions, photos and other item details are changed directly only by an OWNER.
       Staff send the change to the owner (a "request"); it is applied when the owner approves. Stock and hiding an item stay direct. */
    if ($R('POST', 'admin/products')) {
        $me = current_user(); $c = product_changes($json(), []);
        if (empty($c['name']) || !isset($c['cat']) || !isset($c['price']) || empty($c['images'])) throw new ApiError(400, 'Name, category, price and at least one photo are required.');
        $owner = is_owner($me);
        $id = q_insert('INSERT INTO products(name,cat,price,stock,img,`desc`,active,images,size,includes) VALUES(?,?,?,?,?,?,?,?,?,?)',
            [$c['name'], $c['cat'], $c['price'], $c['stock'] ?? 0, $c['images'][0], $c['desc'] ?? '', $owner ? ($c['active'] ?? 1) : 0,
                json_encode($c['images'], JSON_UNESCAPED_SLASHES), $c['size'] ?? '', $c['includes'] ?? '']);
        if (!$owner) {                                     // staff: the item stays hidden until the owner approves it
            q_exec('UPDATE products SET req_json=?,req_by=?,req_at=? WHERE id=?', [json_encode(['active' => 1]), $me['name'], now(), $id]);
            approval_add('product_add', $id, 'New item: ' . $c['name'], $c['price'] . ' ' . CURRENCY . ' · hidden until the owner approves it', $me);
            notify('product', 'New item waiting for approval', $me['name'] . ' added "' . $c['name'] . '" (' . $c['price'] . ' ' . CURRENCY . '). It is hidden until you approve it.', (string)$id, null, true);
        }
        log_admin('product.add', $c['name'] . ' (' . $c['price'] . ' QAR, stock ' . ($c['stock'] ?? 0) . ')' . ($owner ? '' : ' - waiting for owner approval'));
        return [200, ['ok' => true, 'pending' => !$owner]];
    }
    if ($R('PUT', 'admin/products/(\d+)')) {
        $row = q_one('SELECT * FROM products WHERE id=?', [(int)$m[1]]);
        if (!$row) throw new ApiError(404, 'Not found');
        $me = current_user(); $c = product_changes($json(), $row);
        $direct = $c; $ask = [];
        if (!is_owner($me)) {                              // staff: only stock and "hide" are theirs; everything else needs the owner
            $direct = [];
            foreach ($c as $k => $v) {
                if ($k === 'stock' || ($k === 'active' && !$v)) $direct[$k] = $v; else $ask[$k] = $v;
            }
        }
        if ($direct) {
            apply_product_changes($row['id'], $direct);
            log_admin('product.edit', $row['name'] . ' - ' . implode('; ', describe_product_changes($row, $direct)));
        }
        if ($ask) {
            $old = json_decode((string)($row['req_json'] ?? ''), true);
            $merged = array_merge(is_array($old) ? $old : [], $ask);
            q_exec('UPDATE products SET req_json=?,req_by=?,req_at=? WHERE id=?', [json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $me['name'], now(), (int)$row['id']]);
            $what = implode('; ', describe_product_changes($row, $ask));
            approval_add('product_change', $row['id'], 'Change: ' . $row['name'], $what, $me);
            notify('product', 'Item change waiting for approval - ' . $row['name'], $me['name'] . ' asks to change: ' . $what, (string)$row['id'], null, true);
            log_admin('product.change_request', $row['name'] . ' - ' . $what);
        }
        $gone = (array_key_exists('stock', $direct) && (int)$direct['stock'] <= 0) ? sweep_soldout() : 0;
        return [200, ['ok' => true, 'pending' => (bool)$ask, 'autoDeleted' => $gone]];
    }
    if ($R('POST', 'admin/products/(\d+)/change-decision')) {   // the owner approves or rejects what staff asked for
        need_owner(); $d = $json();
        $row = q_one('SELECT * FROM products WHERE id=?', [(int)$m[1]]);
        if (!$row) throw new ApiError(404, 'Not found');
        $req = json_decode((string)($row['req_json'] ?? ''), true);
        if (!is_array($req) || !$req) throw new ApiError(409, 'There is no change waiting for this item.');
        $yes = !empty($d['approve']);
        $what = implode('; ', describe_product_changes($row, $req));
        if ($yes) apply_product_changes($row['id'], $req);
        q_exec('UPDATE products SET req_json=NULL,req_by=NULL,req_at=NULL WHERE id=?', [(int)$row['id']]);
        $owner = current_user();
        $asked = q_one("SELECT req_user FROM approvals WHERE ref=? AND kind IN ('product_change','product_add') AND status='pending' ORDER BY id DESC LIMIT 1", [(string)$row['id']]);
        approval_decide((string)$row['id'], ['product_change', 'product_add'], $yes ? 'approved' : 'rejected', $owner['name']);
        notify('product', ($yes ? 'Item change approved' : 'Item change rejected') . ' - ' . $row['name'], $owner['name'] . ($yes ? ' approved' : ' rejected') . ' your change request.', (string)$row['id'],
            $asked ? (int)$asked['req_user'] : null, !$asked);
        log_admin($yes ? 'product.change_approve' : 'product.change_reject', $row['name'] . ' - ' . $what . ' (requested by ' . $row['req_by'] . ')');
        if ($yes) sweep_soldout();
        return [200, ['product' => $prod_out(q_one('SELECT * FROM products WHERE id=?', [(int)$row['id']]))]];
    }
    if ($R('DELETE', 'admin/products/(\d+)')) {   // permanent: gone from the shop and the admin list (past orders keep their own copy)
        $pn = q_val('SELECT name FROM products WHERE id=?', [(int)$m[1]]);
        q_exec('DELETE FROM products WHERE id=?', [(int)$m[1]]);
        log_admin('product.delete', 'Deleted forever: ' . $pn);
        return [200, ['ok' => true]];
    }

    if ($R('POST', 'admin/categories')) {
        $label = clean($json()['label'] ?? '', 40);
        $key = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($label)), '-');
        if ($key === '') throw new ApiError(400, 'Enter a category name');
        if (q_val('SELECT 1 FROM categories WHERE `key`=?', [$key])) throw new ApiError(409, 'Category already exists');
        q_exec('INSERT INTO categories(`key`,label,sort) VALUES(?,?,?)', [$key, $label, (int)q_val('SELECT COALESCE(MAX(sort),0) FROM categories') + 1]);
        return [200, ['ok' => true]];
    }

    if ($R('GET', 'admin/settings')) return [200, ['settings' => settings_for_admin(is_owner(current_user()))]];

    if ($R('PUT', 'admin/settings')) {
        $d = $json();
        $isOwner = is_owner(current_user());
        if (!$isOwner && array_diff(array_keys($d), ['shop'])) throw new ApiError(403, 'Only an owner account can change company, payment and alert settings.');
        $s = get_settings();
        $co = is_array($d['company'] ?? null) ? $d['company'] : []; $sh = is_array($d['shipping'] ?? null) ? $d['shipping'] : []; $pay = is_array($d['payments'] ?? null) ? $d['payments'] : [];
        foreach (['name', 'crNumber', 'address', 'phone', 'email', 'whatsapp'] as $k) if (array_key_exists($k, $co)) $s['company'][$k] = clean($co[$k], 150);
        if ($s['company']['email'] !== '' && !valid_email($s['company']['email'])) throw new ApiError(400, 'Company email is not valid.');
        $s['company']['whatsapp'] = preg_replace('/\D/', '', $s['company']['whatsapp']);
        foreach (['fee', 'freeFrom'] as $k) if (array_key_exists($k, $sh)) {
            if (!is_numeric($sh[$k])) throw new ApiError(400, 'Shipping values must be numbers.');
            $s['shipping'][$k] = max(0, (int)$sh[$k]);
        }
        $ib = is_array($pay['iban'] ?? null) ? $pay['iban'] : [];
        foreach (['bankName', 'accountName', 'accountNumber', 'branch'] as $k) if (array_key_exists($k, $ib)) $s['payments']['iban'][$k] = clean($ib[$k], 100);
        if (array_key_exists('enabled', $ib)) $s['payments']['iban']['enabled'] = (bool)$ib['enabled'];
        if (array_key_exists('iban', $ib)) {
            $v = strtoupper(preg_replace('/\s/', '', clean($ib['iban'], 40)));
            if ($v !== '' && !iban_ok($v)) throw new ApiError(400, 'Invalid Qatar IBAN. It must be 29 characters starting with QA (e.g. QA58 DOHB 0000 1234 5678 90AB CDEF G) and pass the checksum.');
            $s['payments']['iban']['iban'] = $v;
        }
        if (array_key_exists('swift', $ib)) {
            $v = str_replace(' ', '', strtoupper(clean($ib['swift'], 11)));
            if ($v !== '' && !preg_match('/^[A-Z]{4}QA[A-Z0-9]{2}([A-Z0-9]{3})?$/D', $v)) throw new ApiError(400, 'Invalid SWIFT/BIC for a Qatar bank (8 or 11 characters, e.g. XXXXQAQA).');
            $s['payments']['iban']['swift'] = $v;
        }
        $fw = is_array($pay['fawran'] ?? null) ? $pay['fawran'] : [];
        foreach (['accountName', 'bankName'] as $k) if (array_key_exists($k, $fw)) $s['payments']['fawran'][$k] = clean($fw[$k], 100);
        if (array_key_exists('enabled', $fw)) $s['payments']['fawran']['enabled'] = (bool)$fw['enabled'];
        if (array_key_exists('alias', $fw)) {
            $v = str_replace(' ', '', clean($fw['alias'], 40));
            if ($v !== '' && !(qa_mobile($v) || iban_ok($v))) throw new ApiError(400, 'Fawran alias must be a Qatar mobile number (8 digits) or a valid Qatar IBAN.');
            $s['payments']['fawran']['alias'] = qa_mobile($v) ?: strtoupper($v);
        }
        $oo = is_array($pay['ooredoo'] ?? null) ? $pay['ooredoo'] : [];
        if (array_key_exists('accountName', $oo)) $s['payments']['ooredoo']['accountName'] = clean($oo['accountName'], 100);
        if (array_key_exists('enabled', $oo)) $s['payments']['ooredoo']['enabled'] = (bool)$oo['enabled'];
        if (array_key_exists('number', $oo)) {
            $v = clean($oo['number'], 20);
            if ($v !== '' && !qa_mobile($v)) throw new ApiError(400, 'Ooredoo Money number must be a Qatar mobile number (8 digits).');
            $s['payments']['ooredoo']['number'] = qa_mobile($v) ?: '';
        }
        if (array_key_exists('google', $d)) {
            $gid = clean((is_array($d['google']) ? $d['google'] : [])['clientId'] ?? '', 200);
            if ($gid !== '' && !preg_match('/^[\w-]+\.apps\.googleusercontent\.com$/D', $gid)) throw new ApiError(400, 'Google Client ID looks wrong. It ends with .apps.googleusercontent.com');
            $s['google']['clientId'] = $gid;
        }
        $pemToWrite = null;
        $cd = is_array($pay['card'] ?? null) ? $pay['card'] : [];           // card payments (hosted page of the payment provider)
        if (array_key_exists('test', $cd)) $s['payments']['card']['test'] = (bool)$cd['test'];
        if (!empty($cd['apiToken'])) $s['payments']['card']['apiToken'] = clean($cd['apiToken'], 300);   // blank = keep the saved token
        if (array_key_exists('enabled', $cd)) $s['payments']['card']['enabled'] = (bool)$cd['enabled'];
        if (!empty($s['payments']['card']['enabled']) && str_val($s['payments']['card']['apiToken']) === '')
            throw new ApiError(400, 'Card payments cannot be switched on yet. Paste the API token from your payment provider first.');
        $en = is_array($d['enquiry'] ?? null) ? $d['enquiry'] : [];           // the reply text for enquiries
        if (array_key_exists('template', $en)) {
            $t = clean($en['template'], 900);
            if ($t === '') throw new ApiError(400, 'The reply text cannot be empty.');
            $s['enquiry']['template'] = $t;
        }
        if (array_key_exists('applepay', $d) && is_array($d['applepay'])) {
            $ai = $d['applepay'];
            $a = &$s['applepay'];
            if (array_key_exists('enabled', $ai)) $a['enabled'] = (bool)$ai['enabled'];
            if (array_key_exists('sandbox', $ai)) $a['sandbox'] = (bool)$ai['sandbox'];
            foreach (['merchantId' => 100, 'displayName' => 60, 'domain' => 120, 'publicKey' => 200] as $k => $mx) if (array_key_exists($k, $ai)) $a[$k] = clean($ai[$k], $mx);
            if (!empty($ai['secretKey'])) $a['secretKey'] = clean($ai['secretKey'], 200);   // blank = keep the saved one
            if (array_key_exists('domainFile', $ai)) $a['domainFile'] = slice(trim(str_val($ai['domainFile'])), 5000);
            $pem = trim(str_val($ai['identityPem'] ?? ''));
            if ($pem !== '' && (strpos($pem, '-----BEGIN CERTIFICATE-----') === false || strpos($pem, 'PRIVATE KEY-----') === false))
                throw new ApiError(400, 'Paste BOTH the certificate and the private key (PEM text) in the Apple Pay certificate box.');
            $miss = applepay_missing($a, $pem !== '' || is_file(identity_pem()));
            if (!empty($a['enabled']) && $miss) throw new ApiError(400, 'Apple Pay cannot be switched on yet. Still needed: ' . implode(', ', $miss) . '.');
            if ($pem !== '') $pemToWrite = $pem;
            unset($a);
        }
        if (array_key_exists('shop', $d)) $s['shop']['autoDeleteSoldOut'] = !empty((is_array($d['shop']) ? $d['shop'] : [])['autoDeleteSoldOut']);
        if (array_key_exists('orders', $d) && is_array($d['orders'])) {
            $oi = $d['orders'];
            if (array_key_exists('requireReceipt', $oi)) $s['orders']['requireReceipt'] = (bool)$oi['requireReceipt'];
            if (array_key_exists('unpaidHours', $oi)) {
                if (!is_numeric($oi['unpaidHours']) || $oi['unpaidHours'] < 0 || $oi['unpaidHours'] > 720) throw new ApiError(400, 'Release unpaid orders after 0 to 720 hours (0 = never).');
                $s['orders']['unpaidHours'] = (int)$oi['unpaidHours'];
            }
        }
        if (array_key_exists('chat', $d) && is_array($d['chat'])) {          // automatic chat replies
            $ch = $d['chat'];
            if (array_key_exists('autoReply', $ch)) $s['chat']['autoReply'] = (bool)$ch['autoReply'];
            if (array_key_exists('welcome', $ch)) {
                $w = clean($ch['welcome'], 700);
                if ($w === '') throw new ApiError(400, 'The welcome message cannot be empty (switch automatic replies off instead).');
                $s['chat']['welcome'] = $w;
            }
            if (array_key_exists('orderHelp', $ch)) $s['chat']['orderHelp'] = clean($ch['orderHelp'], 400);
        }
        if (array_key_exists('alerts', $d) && is_array($d['alerts'])) {
            $al = $d['alerts'];
            $a = &$s['alerts'];
            if (is_array($al['events'] ?? null)) foreach (['placed', 'submitted', 'confirmed'] as $k) if (array_key_exists($k, $al['events'])) $a['events'][$k] = (bool)$al['events'][$k];
            unset($a['sms']);                                                    // SMS / Twilio alerts no longer exist
            $wa = is_array($al['whatsapp'] ?? null) ? $al['whatsapp'] : [];
            if (array_key_exists('enabled', $wa)) $a['whatsapp']['enabled'] = (bool)$wa['enabled'];
            if (array_key_exists('provider', $wa)) {
                if (!in_array($wa['provider'], ['callmebot', 'webhook'], true)) throw new ApiError(400, 'Unknown WhatsApp service.');
                $a['whatsapp']['provider'] = $wa['provider'];
            }
            if (array_key_exists('number', $wa)) {
                $nr = clean($wa['number'], 30);
                $e = $nr === '' ? '' : normalize_e164($nr);
                if ($e === null) throw new ApiError(400, 'That WhatsApp number is not valid. Use the international format, e.g. +97466404222.');
                $a['whatsapp']['number'] = $e;                                  // blank = use the company WhatsApp number
            }
            if (!empty($wa['apiKey'])) $a['whatsapp']['apiKey'] = clean($wa['apiKey'], 40);   // blank = keep the saved one
            if (array_key_exists('webhookUrl', $wa)) $a['whatsapp']['webhookUrl'] = clean($wa['webhookUrl'], 300);
            if ($a['whatsapp']['apiKey'] !== '' && !preg_match('/^[A-Za-z0-9_-]{3,40}$/D', $a['whatsapp']['apiKey'])) throw new ApiError(400, 'The CallMeBot API key looks wrong (letters and numbers only, no spaces).');
            if ($a['whatsapp']['webhookUrl'] !== '' && !preg_match('#^https://[^\s]+$#D', $a['whatsapp']['webhookUrl'])) throw new ApiError(400, 'The WhatsApp service address must start with https://');
            if (!empty($a['whatsapp']['enabled'])) {
                $miss = [];
                if (whatsapp_target($s) === '') $miss[] = 'the WhatsApp number';
                if ($a['whatsapp']['provider'] === 'callmebot') { if ($a['whatsapp']['apiKey'] === '') $miss[] = 'the CallMeBot API key'; }
                elseif ($a['whatsapp']['webhookUrl'] === '') $miss[] = 'the service address (https://...)';
                if ($miss) throw new ApiError(400, 'WhatsApp alerts cannot be switched on yet. Still needed: ' . implode(', ', $miss) . '.');
            }
            $tg = is_array($al['telegram'] ?? null) ? $al['telegram'] : [];
            if (array_key_exists('enabled', $tg)) $a['telegram']['enabled'] = (bool)$tg['enabled'];
            if (array_key_exists('chatId', $tg)) $a['telegram']['chatId'] = clean($tg['chatId'], 60);
            if (!empty($tg['botToken'])) $a['telegram']['botToken'] = clean($tg['botToken'], 100);
            if ($a['telegram']['botToken'] !== '' && !preg_match('/^\d{6,}:[A-Za-z0-9_-]{30,}$/D', $a['telegram']['botToken'])) throw new ApiError(400, 'Telegram bot token looks wrong (it looks like 123456789:AA...).');
            if ($a['telegram']['chatId'] !== '' && !preg_match('/^(-?\d{5,}|@[A-Za-z0-9_]{4,})$/D', $a['telegram']['chatId'])) throw new ApiError(400, 'Telegram chat id must be a number (or @channelname).');
            if (!empty($a['telegram']['enabled']) && ($a['telegram']['botToken'] === '' || $a['telegram']['chatId'] === '')) throw new ApiError(400, 'Telegram cannot be switched on yet. Still needed: bot token and chat id.');
            unset($a);
        }
        if ($pemToWrite !== null) {
            if (!is_dir(dirname(identity_pem()))) @mkdir(dirname(identity_pem()), 0750, true);
            file_put_contents(identity_pem(), $pemToWrite . "\n");
            @chmod(identity_pem(), 0600);
        }
        save_settings($s);
        log_admin('settings.update', 'Changed: ' . implode(', ', array_keys($d)));
        $swept = sweep_soldout();
        $out = settings_for_admin($isOwner);
        $out['swept'] = $swept;
        return [200, ['settings' => $out]];
    }

    /* enquiries as an inbox: each enquiry is a conversation (the customer's message, reference photos, and every reply) */
    $enq_out = function ($r) {
        $r['id'] = (int)$r['id']; $r['created'] = (int)$r['created'];
        $imgs = array_values(array_filter((array)json_decode((string)($r['images'] ?? ''), true), 'is_string'));
        $r['images'] = array_map(function ($i, $n) use ($r) { return ['n' => $n + 1, 'url' => '/api/admin/enquiries/' . $r['id'] . '/image/' . ($n + 1)]; }, $imgs, array_keys($imgs));
        $r['reply'] = enquiry_reply_text($r);                       // the default WhatsApp / SMS text, ready to send
        $r['messages'] = array_map(function ($x) { return ['id' => (int)$x['id'], 'sender' => $x['sender'], 'channel' => $x['channel'], 'body' => $x['body'], 'by' => (string)$x['by_name'], 'created' => (int)$x['created']]; },
            q_all('SELECT * FROM enquiry_msgs WHERE enquiry_id=? ORDER BY id', [$r['id']]));
        return $r;
    };
    if ($R('GET', 'admin/enquiries')) {
        return [200, ['enquiries' => array_map($enq_out, q_all('SELECT * FROM enquiries ORDER BY id DESC'))]];
    }
    if ($R('GET', 'admin/enquiries/(\d+)/image/(\d+)')) {   // a reference photo (admins only)
        $r = q_one('SELECT images FROM enquiries WHERE id=?', [(int)$m[1]]);
        $imgs = array_values(array_filter((array)json_decode((string)($r['images'] ?? ''), true), 'is_string'));
        $f = $imgs[(int)$m[2] - 1] ?? null;
        if (!$f) throw new ApiError(404, 'Photo not found');
        $path = enquiry_image_dir() . '/' . basename($f);
        if (!is_file($path)) throw new ApiError(404, 'Photo not found');
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        return ['raw', file_get_contents($path), ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'][$ext] ?? 'application/octet-stream', basename($path)];
    }
    if ($R('POST', 'admin/enquiries/(\d+)/messages')) {   // record a reply that was sent (WhatsApp / SMS) or an internal note
        $me = current_user(); $d = $json(); $eid = (int)$m[1];
        $enq = q_one('SELECT * FROM enquiries WHERE id=?', [$eid]);
        if (!$enq) throw new ApiError(404, 'Enquiry not found');
        $ch = str_val($d['channel'] ?? '');
        if (!in_array($ch, ['whatsapp', 'sms', 'note'], true)) throw new ApiError(400, 'Choose WhatsApp, SMS or a note.');
        $body = clean($d['body'] ?? '', 1500);
        if ($body === '') throw new ApiError(400, 'Write the message first.');
        q_exec('INSERT INTO enquiry_msgs(enquiry_id,sender,channel,body,by_name,created) VALUES(?,?,?,?,?,?)', [$eid, 'admin', $ch, $body, $me['name'], now()]);
        if ($ch !== 'note' && $enq['status'] === 'New') q_exec("UPDATE enquiries SET status='Replied' WHERE id=?", [$eid]);
        log_admin('enquiry.reply', "Enquiry #$eid: " . ($ch === 'note' ? 'note added' : 'replied by ' . ($ch === 'sms' ? 'SMS' : 'WhatsApp')));
        return [200, ['enquiry' => $enq_out(q_one('SELECT * FROM enquiries WHERE id=?', [$eid]))]];
    }
    if ($R('PUT', 'admin/enquiries/(\d+)')) {
        $st = clean($json()['status'] ?? '', 20);
        if (!in_array($st, ['New', 'Replied', 'Closed'], true)) throw new ApiError(400, 'Invalid status');
        q_exec('UPDATE enquiries SET status=? WHERE id=?', [$st, (int)$m[1]]);
        return [200, ['ok' => true]];
    }
    if ($R('DELETE', 'admin/enquiries/(\d+)')) {   // permanently remove an enquiry, its photos and its messages
        delete_enquiry_files((int)$m[1]);
        q_exec('DELETE FROM enquiries WHERE id=?', [(int)$m[1]]);
        log_admin('enquiry.delete', 'Deleted enquiry #' . (int)$m[1]);
        return [200, ['ok' => true]];
    }

    if ($R('GET', 'admin/customers')) {
        $rows = q_all("SELECT u.id,u.name,u.email,u.phone,u.address,u.created,u.lat,u.lng,u.loc_at,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) AS orders,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status NOT IN ('Delivered','Cancelled')) AS openOrders,
            (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id=u.id AND o.status<>'Cancelled') AS spent
            FROM users u WHERE role='customer' ORDER BY u.id DESC");
        return [200, ['customers' => array_map(function ($r) {
            foreach (['id', 'created', 'orders', 'openOrders', 'spent'] as $k) $r[$k] = (int)$r[$k];
            foreach (['lat', 'lng'] as $k) if ($r[$k] !== null) $r[$k] = (float)$r[$k];
            if ($r['loc_at'] !== null) $r['loc_at'] = (int)$r['loc_at'];
            return $r;
        }, $rows)]];
    }

    if ($R('DELETE', 'admin/customers/(\d+)')) {
        // Permanently erase a customer's contact details.  ?orders=keep  -> their past orders stay for your accounts
        //                                                   ?orders=delete -> their orders (and receipts) are erased too
        need_owner();
        $cid = (int)$m[1];
        $cu = q_one("SELECT id,name FROM users WHERE id=? AND role='customer'", [$cid]);
        if (!$cu) throw new ApiError(404, 'Customer not found');
        $mode = qs('orders', 'keep');
        log_admin('customer.delete', 'Erased customer ' . $cu['name'] . ' (orders ' . ($mode === 'delete' ? 'deleted' : 'kept') . ')');
        $orders = q_all('SELECT * FROM orders WHERE user_id=?', [$cid]);
        if ($mode === 'delete') {
            foreach ($orders as $o) {
                if (in_array($o['status'], ['Awaiting payment', 'Payment submitted'], true)) restore_stock($o);   // unpaid: put the items back on sale
                if (!empty($o['receipt'])) @unlink(receipts_dir() . '/' . basename($o['receipt']));
                q_exec('DELETE FROM order_events WHERE order_id=?', [$o['id']]);
                q_exec('DELETE FROM orders WHERE id=?', [$o['id']]);
            }
            sweep_soldout();
        } else {
            q_exec('UPDATE orders SET user_id=0 WHERE user_id=?', [$cid]);   // orders stay, but no longer linked to an account
        }
        q_exec('DELETE FROM messages WHERE user_id=?', [$cid]);
        q_exec("DELETE FROM notifications WHERE kind='chat' AND ref=?", [(string)$cid]);
        q_exec('DELETE FROM sessions WHERE user_id=?', [$cid]);
        q_exec('DELETE FROM users WHERE id=?', [$cid]);
        return [200, ['ok' => true, 'ordersDeleted' => $mode === 'delete' ? count($orders) : 0, 'ordersKept' => $mode === 'delete' ? 0 : count($orders)]];
    }

    if ($R('GET', 'admin/stats')) {
        $midnight = strtotime('today');
        $paid = "('Payment confirmed','Preparing','Out for delivery','Delivered')";
        $one = function ($sql, $p = []) { return (int)q_val($sql, $p); };
        $days = [];
        for ($i = 6; $i >= 0; $i--) {
            $a = $midnight - $i * 86400; $b = $midnight - ($i - 1) * 86400;
            $days[] = ['label' => date('D', $a + 43200),
                'orders' => $one("SELECT COUNT(*) FROM orders WHERE created>=? AND created<? AND status<>'Cancelled'", [$a, $b]),
                'revenue' => $one("SELECT COALESCE(SUM(total),0) FROM orders WHERE created>=? AND created<? AND status IN $paid", [$a, $b])];
        }
        $month = strtotime(date('Y-m-01'));
        $low = array_map(function ($r) { $r['id'] = (int)$r['id']; $r['stock'] = (int)$r['stock']; return $r; }, q_all('SELECT id,name,stock FROM products WHERE stock>0 AND stock<=5 ORDER BY stock'));
        return [200, [
            'ordersToday' => $one("SELECT COUNT(*) FROM orders WHERE created>=? AND status<>'Cancelled'", [$midnight]),
            'toVerify' => $one("SELECT COUNT(*) FROM orders WHERE status='Payment submitted'"),
            'awaitingPayment' => $one("SELECT COUNT(*) FROM orders WHERE status='Awaiting payment'"),
            'toDeliver' => $one("SELECT COUNT(*) FROM orders WHERE status IN ('Payment confirmed','Preparing','Out for delivery')"),
            'revenueMonth' => $one("SELECT COALESCE(SUM(total),0) FROM orders WHERE created>=? AND status IN $paid", [$month]),
            'revenueAll' => $one("SELECT COALESCE(SUM(total),0) FROM orders WHERE status IN $paid"),
            'customers' => $one("SELECT COUNT(*) FROM users WHERE role='customer'"),
            'newCustomers7' => $one("SELECT COUNT(*) FROM users WHERE role='customer' AND created>=?", [$midnight - 6 * 86400]),
            'chatUnread' => $one("SELECT COUNT(*) FROM messages WHERE sender='customer' AND seen=0"),
            'newEnquiries' => $one("SELECT COUNT(*) FROM enquiries WHERE status='New'"),
            'soldOut' => $one('SELECT COUNT(*) FROM products WHERE stock<=0'),
            'lowStock' => $low, 'days' => $days, 'currency' => CURRENCY]];
    }

    /* ----- admin accounts (owner only) ----- */
    $active_owners = function () {
        return (int)q_val("SELECT COUNT(*) FROM users WHERE role='admin' AND (admin_level='owner' OR admin_level IS NULL OR admin_level='') AND (disabled IS NULL OR disabled=0)");
    };
    if ($R('GET', 'admin/admins')) {
        need_owner();
        $rows = q_all("SELECT id,name,email,admin_level,disabled,created,last_login FROM users WHERE role='admin' ORDER BY id");
        return [200, ['admins' => array_map(function ($r) {
            return ['id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'], 'level' => admin_level($r), 'disabled' => !empty($r['disabled']),
                'created' => (int)$r['created'], 'lastLogin' => $r['last_login'] === null ? null : (int)$r['last_login'],
                'sessions' => (int)q_val('SELECT COUNT(*) FROM sessions WHERE user_id=? AND expires>?', [(int)$r['id'], now()])];
        }, $rows)]];
    }
    if ($R('POST', 'admin/admins')) {
        need_owner(); $d = $json();
        $name = clean($d['name'] ?? '', 80); $email = lower(clean($d['email'] ?? '', 120)); $pw = str_val($d['password'] ?? '');
        $level = ($d['level'] ?? 'staff') === 'owner' ? 'owner' : 'staff';
        if (slen($name) < 2 || !valid_email($email)) throw new ApiError(400, 'Enter a name and a valid email for the new admin.');
        if (!password_ok($pw)) throw new ApiError(400, PASSWORD_RULE);
        if (q_val('SELECT 1 FROM users WHERE email=?', [$email])) throw new ApiError(409, 'This email already has an account (customer or admin). Use a different email.');
        if ((int)q_val("SELECT COUNT(*) FROM users WHERE role='admin'") >= 10) throw new ApiError(409, 'You can have up to 10 admin accounts.');
        $id = q_insert("INSERT INTO users(name,email,phone,salt,`hash`,role,created,admin_level,disabled) VALUES(?,?,?,?,?,?,?,?,0)",
            [$name, $email, 'admin-' . bin2hex(random_bytes(4)), '', hash_new_pw($pw), 'admin', now(), $level]);
        log_admin('admin.create', "Created $level account: $name <$email>");
        return [200, ['ok' => true, 'id' => $id]];
    }
    if ($R('PUT', 'admin/admins/(\d+)')) {
        $me = need_owner(); $d = $json(); $id = (int)$m[1];
        $t = q_one("SELECT * FROM users WHERE id=? AND role='admin'", [$id]);
        if (!$t) throw new ApiError(404, 'Admin not found');
        $self = $id === (int)$me['id'];
        $isOwnerT = admin_level($t) === 'owner';
        $did = [];
        if (array_key_exists('name', $d)) {
            if (slen(clean($d['name'], 80)) < 2) throw new ApiError(400, 'Enter a name.');
            q_exec('UPDATE users SET name=? WHERE id=?', [clean($d['name'], 80), $id]); $did[] = 'name';
        }
        if (array_key_exists('level', $d)) {
            $lvl = $d['level'] === 'owner' ? 'owner' : 'staff';
            if ($lvl !== admin_level($t)) {
                if ($self) throw new ApiError(409, 'You cannot change your own level.');
                if ($isOwnerT && $active_owners() <= 1) throw new ApiError(409, 'At least one active owner is required.');
                q_exec('UPDATE users SET admin_level=? WHERE id=?', [$lvl, $id]); $did[] = "level $lvl";
            }
        }
        if (array_key_exists('disabled', $d)) {
            $dis = $d['disabled'] ? 1 : 0;
            if ($dis && $self) throw new ApiError(409, 'You cannot disable your own account.');
            if ($dis && $isOwnerT && $active_owners() <= 1) throw new ApiError(409, 'At least one active owner is required.');
            q_exec('UPDATE users SET disabled=? WHERE id=?', [$dis, $id]);
            if ($dis) q_exec('DELETE FROM sessions WHERE user_id=?', [$id]);
            $did[] = $dis ? 'disabled' : 'enabled';
        }
        if (!empty($d['password'])) {
            if (!password_ok(str_val($d['password']))) throw new ApiError(400, PASSWORD_RULE);
            q_exec("UPDATE users SET salt='', `hash`=? WHERE id=?", [hash_new_pw(str_val($d['password'])), $id]);
            if (!$self) q_exec('DELETE FROM sessions WHERE user_id=?', [$id]);
            $did[] = 'password reset';
        }
        log_admin('admin.update', $t['name'] . ' <' . $t['email'] . '>: ' . ($did ? implode(', ', $did) : 'no change'));
        return [200, ['ok' => true]];
    }
    if ($R('DELETE', 'admin/admins/(\d+)')) {
        $me = need_owner(); $id = (int)$m[1];
        $t = q_one("SELECT * FROM users WHERE id=? AND role='admin'", [$id]);
        if (!$t) throw new ApiError(404, 'Admin not found');
        if ($id === (int)$me['id']) throw new ApiError(409, 'You cannot delete your own account.');
        if (admin_level($t) === 'owner' && $active_owners() <= 1 && empty($t['disabled'])) throw new ApiError(409, 'At least one active owner is required.');
        q_exec('DELETE FROM sessions WHERE user_id=?', [$id]);
        q_exec('DELETE FROM users WHERE id=?', [$id]);
        log_admin('admin.delete', 'Deleted admin account ' . $t['name'] . ' <' . $t['email'] . '>');
        return [200, ['ok' => true]];
    }

    /* ----- admin sign-in sessions ("who is logged in, from where") ----- */
    $admin_sessions = function () {
        $me = current_user();
        $sql = "SELECT s.token, s.user_id, s.ip, s.ua, s.created, s.last_seen, s.expires, u.name, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.role='admin' AND s.expires>?";
        $p = [now()];
        if (!is_owner($me)) { $sql .= ' AND s.user_id=?'; $p[] = (int)$me['id']; }
        return q_all($sql . ' ORDER BY s.last_seen DESC', $p);
    };
    if ($R('GET', 'admin/sessions')) {
        $cur = session_token();
        return [200, ['sessions' => array_map(function ($r) use ($cur) {
            return ['sid' => session_sid($r['token']), 'userId' => (int)$r['user_id'], 'name' => $r['name'], 'email' => $r['email'], 'ip' => $r['ip'], 'ua' => $r['ua'],
                'created' => (int)$r['created'], 'lastSeen' => (int)$r['last_seen'], 'expires' => (int)$r['expires'], 'current' => $r['token'] === $cur];
        }, $admin_sessions())]];
    }
    if ($R('POST', 'admin/sessions/revoke-others')) {   // sign out every other device (owners: every other admin session too)
        $me = current_user(); $cur = session_token(); $n = 0;
        foreach ($admin_sessions() as $r) if ($r['token'] !== $cur) $n += q_exec('DELETE FROM sessions WHERE token=?', [$r['token']]);
        log_admin('session.revokeAll', "Signed out $n other session(s)");
        return [200, ['ok' => true, 'revoked' => $n]];
    }
    if ($R('DELETE', 'admin/sessions/([a-f0-9]{16})')) {
        $n = 0;
        foreach ($admin_sessions() as $r) if (session_sid($r['token']) === $m[1]) { $n += q_exec('DELETE FROM sessions WHERE token=?', [$r['token']]); log_admin('session.revoke', 'Signed out ' . $r['name'] . ' (' . $r['ip'] . ')'); }
        if (!$n) throw new ApiError(404, 'Session not found');
        return [200, ['ok' => true]];
    }

    /* ----- access / activity log (owner only) ----- */
    if ($R('GET', 'admin/log')) {
        need_owner();
        $sql = 'SELECT * FROM admin_log WHERE 1=1'; $p = [];
        if ((int)qs('admin', '0') > 0) { $sql .= ' AND user_id=?'; $p[] = (int)qs('admin'); }
        $needle = clean(qs('q'), 60);
        if ($needle !== '') { $sql .= ' AND (action LIKE ? OR detail LIKE ? OR admin_name LIKE ? OR ip LIKE ?)'; $like = '%' . str_replace(['%', '_'], ['', ''], $needle) . '%'; array_push($p, $like, $like, $like, $like); }
        $rows = q_all($sql . ' ORDER BY id DESC LIMIT 300', $p);
        return [200, ['log' => array_map(function ($r) { $r['id'] = (int)$r['id']; $r['user_id'] = (int)$r['user_id']; $r['created'] = (int)$r['created']; return $r; }, $rows)]];
    }

    /* ----- reset test data (owner only) ----- */
    if ($R('POST', 'admin/reset')) {
        need_owner(); $d = $json();
        if (str_val($d['confirm'] ?? '') !== 'RESET') throw new ApiError(400, 'Type the word RESET to confirm.');
        $o = [];
        foreach (['orders', 'customers', 'chats', 'enquiries', 'notifications', 'log'] as $k) $o[$k] = !empty($d[$k]);
        if (!array_filter($o)) throw new ApiError(400, 'Tick at least one thing to reset.');
        $o['restoreStock'] = !empty($d['restoreStock']);
        $n = reset_data($o);
        log_admin('reset', 'Data reset: ' . json_encode($n));
        return [200, ['ok' => true, 'deleted' => $n]];
    }

    /* ----- test the order alerts (owner only) ----- */
    if ($R('POST', 'admin/alerts/test')) {
        need_owner(); $d = $json();
        $ch = in_array($d['channel'] ?? '', ['whatsapp', 'telegram'], true) ? $d['channel'] : null;
        $res = deliver_alert("🔔 *LOFAN TEST ALERT*\nIf you can read this, your order alerts work.\nTime: " . date('d M Y, H:i'), $ch);
        if (!$res) throw new ApiError(400, 'No alert channel is switched on yet. Switch on WhatsApp or Telegram, press Save, then test again.');
        foreach ($res as $r) log_admin('alert.test', $r[0] . ' to ' . $r[1] . ' - ' . ($r[2] ? 'sent' : 'FAILED ' . $r[3]));
        return [200, ['results' => array_map(function ($r) { return ['channel' => $r[0], 'to' => $r[1], 'ok' => $r[2], 'detail' => $r[3]]; }, $res)]];
    }

    throw new ApiError(404, 'Not found');
}
