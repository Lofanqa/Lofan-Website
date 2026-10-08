#!/usr/bin/env python3
"""
LOFAN website server  –  run with:   python server.py      then open http://localhost:8000
Uses only the Python standard library (no installs). Data is stored in data/lofan.db
"""
import base64, hashlib, hmac, json, mimetypes, os, re, secrets, sqlite3, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'data')
RECEIPTS = os.path.join(DATA, 'receipts')
PRODUCT_IMG = os.path.join(ROOT, 'images', 'products')
DB_PATH = os.path.join(DATA, 'lofan.db')
PORT = int(os.environ.get('PORT', 8000))
CURRENCY = 'QAR'
for d in (DATA, RECEIPTS, PRODUCT_IMG):
    os.makedirs(d, exist_ok=True)

STATUSES = ['Awaiting payment', 'Payment submitted', 'Payment confirmed', 'Preparing',
            'Out for delivery', 'Delivered', 'Cancelled']

DEFAULT_SETTINGS = {
    'company': {'name': 'Lofan Development & Trading', 'crNumber': '', 'address': 'Doha, State of Qatar',
                'phone': '+974 6640 4222', 'email': 'info@lofan.qa', 'whatsapp': '97466404222'},
    'shipping': {'fee': 25, 'freeFrom': 300},
    'google': {'clientId': ''},
    'shop': {'autoDeleteSoldOut': False},
    'applepay': {'enabled': False, 'merchantId': '', 'displayName': 'Lofan', 'domain': '', 'sandbox': True,
                 'publicKey': '', 'secretKey': '', 'domainFile': ''},
    'payments': {
        'iban': {'enabled': True, 'bankName': '', 'accountName': 'Lofan Development & Trading',
                 'accountNumber': '', 'iban': '', 'swift': '', 'branch': 'Doha, Qatar'},
        'fawran': {'enabled': True, 'alias': '66404222', 'accountName': 'Lofan Development & Trading', 'bankName': ''},
        'ooredoo': {'enabled': True, 'number': '66404222', 'accountName': 'Lofan Development & Trading'},
    },
}

SEED_CATEGORIES = [('napkins', 'Napkins'), ('placemats', 'Placemats'), ('coasters', 'Trays & Coasters')]
SEED_PRODUCTS = [
    ('Olive Leaf Napkin', 'napkins', 45, 40, 'images/napkins.jpg', 'Linen napkin with hand-finished olive leaf embroidery.'),
    ('Scalloped Sage Placemat', 'placemats', 85, 25, 'images/placemat-1.jpg', 'Scalloped-edge placemat in soft sage.'),
    ('Sage & Linen Placemat Set', 'placemats', 160, 12, 'images/placemat-2.jpg', 'Layered sage and linen placemat set.'),
    ('Embroidered Charger Mat', 'placemats', 95, 18, 'images/placemat-3.jpg', 'Large embroidered charger mat for statement tables.'),
    ('Leaf Coaster Set of 4', 'coasters', 70, 30, 'images/coasters.jpg', 'Four round embroidered coasters.'),
    ('Tassel Napkin Set', 'napkins', 120, 10, 'images/custom.jpg', 'Napkin set finished with a hand-twisted tassel.'),
]

# Added once on top of the original items (nothing is removed or changed)
SEED_V2_CATEGORIES = [('custom', 'Custom Pieces')]
SEED_V2_PRODUCTS = [
    ('Whipstitch Linen Napkin', 'napkins', 55, 40, 'images/products/whipstitch-napkin.jpg', 'Natural linen napkin with a sage whipstitch edge and leaf embroidery.'),
    ('Napkin Ring & Tassel Set', 'napkins', 65, 25, 'images/products/napkin-ring-tassel.jpg', 'Embroidered napkin ring finished with a hand-twisted sage tassel.'),
    ('Scalloped Natural Placemat', 'placemats', 90, 20, 'images/products/scalloped-natural.jpg', 'Natural linen scalloped placemat with olive-branch embroidery.'),
    ('Layered Table Setting', 'placemats', 210, 8, 'images/products/table-set.jpg', 'Placemat, napkin and ring set for a complete place setting.'),
    ('Leaf Coaster Trio', 'coasters', 55, 30, 'images/products/coaster-trio.jpg', 'Three round embroidered coasters with a stitched edge.'),
    ('Oak Serving Tray', 'coasters', 140, 15, 'images/products/oak-tray.jpg', 'Natural oak serving tray, ideal with our coasters and linens.'),
    ('Made-to-Order Napkin Set', 'custom', 150, 50, 'images/products/ring-set.jpg', 'Choose your colours and embroidery – a bespoke napkin and ring set.'),
    ('Custom Table Collection', 'custom', 320, 50, 'images/products/table-set.jpg', 'A bespoke table collection for events, hotels and gifting. Contact us for details.'),
]


# ------------------------------------------------------------------ database
def conn():
    c = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')
    return c


def init_db():
    c = conn()
    c.executescript('''
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, phone TEXT UNIQUE,
        address TEXT DEFAULT '', salt TEXT, hash TEXT, role TEXT DEFAULT 'customer', created INTEGER);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, expires INTEGER);
    CREATE TABLE IF NOT EXISTS categories(key TEXT PRIMARY KEY, label TEXT, sort INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, cat TEXT, price INTEGER, stock INTEGER,
        img TEXT, desc TEXT DEFAULT '', active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, user_id INTEGER, created INTEGER, items TEXT, subtotal INTEGER,
        shipping INTEGER, total INTEGER, delivery TEXT, method TEXT, txn TEXT, receipt TEXT, status TEXT);
    CREATE TABLE IF NOT EXISTS order_events(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, status TEXT, note TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, title TEXT, body TEXT, ref TEXT,
        created INTEGER, read INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS enquiries(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, company TEXT, email TEXT, phone TEXT,
        type TEXT, qty TEXT, message TEXT, created INTEGER, status TEXT DEFAULT 'New');
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, sender TEXT, body TEXT,
        created INTEGER, seen INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
    ''')
    if not c.execute('SELECT 1 FROM categories LIMIT 1').fetchone():
        for i, (k, l) in enumerate(SEED_CATEGORIES):
            c.execute('INSERT INTO categories VALUES(?,?,?)', (k, l, i))
    if not c.execute('SELECT 1 FROM products LIMIT 1').fetchone():
        for p in SEED_PRODUCTS:
            c.execute('INSERT INTO products(name,cat,price,stock,img,desc) VALUES(?,?,?,?,?,?)', p)
    if not c.execute("SELECT 1 FROM settings WHERE key='settings'").fetchone():
        c.execute('INSERT INTO settings VALUES(?,?)', ('settings', json.dumps(DEFAULT_SETTINGS)))
    have = [r['name'] for r in c.execute('PRAGMA table_info(users)')]
    for col, typ in (('google_sub', 'TEXT'), ('lat', 'REAL'), ('lng', 'REAL'), ('loc_at', 'INTEGER')):
        if col not in have:
            c.execute(f'ALTER TABLE users ADD COLUMN {col} {typ}')
    if not c.execute("SELECT 1 FROM settings WHERE key='seed_v2'").fetchone():
        for k, l in SEED_V2_CATEGORIES:
            c.execute('INSERT OR IGNORE INTO categories VALUES(?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM categories))', (k, l))
        for p in SEED_V2_PRODUCTS:
            if not c.execute('SELECT 1 FROM products WHERE name=?', (p[0],)).fetchone():
                c.execute('INSERT INTO products(name,cat,price,stock,img,desc) VALUES(?,?,?,?,?,?)', p)
        c.execute("INSERT INTO settings VALUES('seed_v2','1')")
    c.close()


def get_settings(c):
    row = c.execute("SELECT value FROM settings WHERE key='settings'").fetchone()
    stored = json.loads(row['value']) if row else {}
    out = json.loads(json.dumps(DEFAULT_SETTINGS))
    for sec, val in stored.items():
        if isinstance(val, dict) and sec in out:
            for k, v in val.items():
                if isinstance(v, dict) and isinstance(out[sec].get(k), dict):
                    out[sec][k].update(v)
                else:
                    out[sec][k] = v
    return out


# ------------------------------------------------------------------ helpers
class ApiError(Exception):
    def __init__(self, code, msg, field=None):
        self.code, self.msg, self.field = code, msg, field


def now():
    return int(time.time())


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt, hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt), 200_000).hex()


def norm_phone(p):
    d = re.sub(r'\D', '', str(p or ''))
    d = re.sub(r'^00', '', d)
    return '974' + d if len(d) == 8 else d


def valid_phone(p):
    return bool(re.fullmatch(r'\d{10,15}', norm_phone(p)))


def valid_email(e):
    return bool(re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', str(e or '')))


def iban_ok(s):
    s = re.sub(r'\s', '', str(s or '')).upper()
    if not re.fullmatch(r'QA\d{2}[A-Z]{4}[A-Z0-9]{21}', s):
        return False
    return int(''.join(str(int(ch, 36)) for ch in s[4:] + s[:4])) % 97 == 1


def qa_mobile(s):
    d = re.sub(r'\D', '', str(s or ''))
    d = d[3:] if d.startswith('974') and len(d) == 11 else d
    return d if re.fullmatch(r'\d{8}', d) else None


def group4(s):
    s = re.sub(r'\s', '', s)
    return ' '.join(s[i:i + 4] for i in range(0, len(s), 4))


def clean(s, n=200):
    return str(s or '').strip()[:n]


def public_user(u):
    loc = {'lat': u['lat'], 'lng': u['lng'], 'at': u['loc_at']} if u['lat'] is not None and u['lng'] is not None else None
    return {'id': u['id'], 'name': u['name'], 'email': u['email'], 'phone': u['phone'] or '', 'address': u['address'] or '',
            'role': u['role'], 'google': bool(u['google_sub']), 'hasPassword': bool(u['hash']), 'location': loc}


def valid_loc(lat, lng):
    """GPS position from the customer's phone/browser -> (lat, lng) rounded, or None if it is not a real coordinate."""
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (lat == 0 and lng == 0):
        return None
    return round(lat, 6), round(lng, 6)


def save_user_loc(c, uid, loc):
    c.execute('UPDATE users SET lat=?,lng=?,loc_at=? WHERE id=?', (loc[0], loc[1], now(), uid))


def google_client_id(c):
    return os.environ.get('GOOGLE_CLIENT_ID') or get_settings(c)['google']['clientId']


def verify_google(credential, client_id):
    """Ask Google to validate the ID token, then check it was issued for OUR client id."""
    import urllib.request, urllib.parse
    try:
        url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + urllib.parse.quote(str(credential))
        with urllib.request.urlopen(url, timeout=10) as r:
            info = json.loads(r.read())
    except Exception:
        raise ApiError(401, 'Google could not verify your sign-in. Please try again.')
    ok = (info.get('aud') == client_id and info.get('iss') in ('accounts.google.com', 'https://accounts.google.com')
          and str(info.get('email_verified')).lower() == 'true' and int(info.get('exp', 0)) > now() and info.get('email') and info.get('sub'))
    if not ok:
        raise ApiError(401, 'Google sign-in could not be verified.')
    return info


def save_data_url(data_url, folder, basename, allowed, max_bytes):
    m = re.fullmatch(r'data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)', str(data_url or ''))
    if not m or m.group(1) not in allowed:
        raise ApiError(400, 'Unsupported file type')
    raw = base64.b64decode(m.group(2))
    if len(raw) > max_bytes:
        raise ApiError(400, 'File is too large')
    ext = allowed[m.group(1)]
    name = f'{basename}.{ext}'
    with open(os.path.join(folder, name), 'wb') as f:
        f.write(raw)
    return name


def new_order_id(c):
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    while True:
        oid = 'LF-' + ''.join(secrets.choice(alphabet) for _ in range(6))
        if not c.execute('SELECT 1 FROM orders WHERE id=?', (oid,)).fetchone():
            return oid


def notify(c, kind, title, body, ref=''):
    c.execute('INSERT INTO notifications(kind,title,body,ref,created) VALUES(?,?,?,?,?)', (kind, title, body, ref, now()))


def add_event(c, oid, status, note=''):
    c.execute('INSERT INTO order_events(order_id,status,note,created) VALUES(?,?,?,?)', (oid, status, note, now()))


def order_out(c, row, admin=False):
    o = dict(row)
    o['items'] = json.loads(o['items'])
    o['delivery'] = json.loads(o['delivery'])
    o['hasReceipt'] = bool(o.pop('receipt'))
    o['events'] = [dict(e) for e in c.execute('SELECT status,note,created FROM order_events WHERE order_id=? ORDER BY id', (o['id'],))]
    if not admin:
        o.pop('user_id', None)
    return o


def restore_stock(c, order_row):
    for it in json.loads(order_row['items']):
        c.execute('UPDATE products SET stock=stock+? WHERE id=?', (it['qty'], it['id']))


def sweep_soldout(c):
    """If the admin turned on 'auto-delete sold-out items': permanently remove items with no stock left.
    Items still reserved by an unpaid / unverified order are kept until that order is settled (it might be cancelled)."""
    if not get_settings(c)['shop']['autoDeleteSoldOut']:
        return 0
    reserved = set()
    for r in c.execute("SELECT items FROM orders WHERE status IN ('Awaiting payment','Payment submitted')"):
        reserved.update(i['id'] for i in json.loads(r['items']))
    gone = [r['id'] for r in c.execute('SELECT id FROM products WHERE stock<=0') if r['id'] not in reserved]
    for pid in gone:
        c.execute('DELETE FROM products WHERE id=?', (pid,))
    return len(gone)


def payment_info(c):
    s = get_settings(c)
    p, methods = s['payments'], []
    if p['iban']['enabled'] and iban_ok(p['iban']['iban']):
        d = p['iban']
        rows = [('Bank', d['bankName']), ('Account name', d['accountName']), ('Account number', d['accountNumber']),
                ('IBAN', group4(d['iban'])), ('SWIFT / BIC', d['swift']), ('Branch', d['branch']), ('Currency', 'QAR – Qatari Riyal')]
        methods.append({'id': 'iban', 'label': 'Bank Transfer (IBAN)',
                        'hint': 'Transfer the exact total in QAR from your Qatari bank app or branch to the account below. Write the payment reference in the transfer remarks / beneficiary note.',
                        'details': [[k, v] for k, v in rows if v]})
    if p['fawran']['enabled'] and p['fawran']['alias']:
        d = p['fawran']
        rows = [('Fawran alias (mobile / IBAN)', d['alias']), ('Account name', d['accountName']), ('Bank', d['bankName'])]
        methods.append({'id': 'fawran', 'label': 'Fawran (Instant)',
                        'hint': 'Open your bank app, choose Fawran / instant payment, send to the alias below and add the payment reference as the note. Funds arrive within seconds.',
                        'details': [[k, v] for k, v in rows if v]})
    if p['ooredoo']['enabled'] and p['ooredoo']['number']:
        d = p['ooredoo']
        rows = [('Ooredoo Money number', d['number']), ('Account name', d['accountName'])]
        methods.append({'id': 'ooredoo', 'label': 'Ooredoo Money',
                        'hint': 'Open the Ooredoo Money app, choose Send Money, enter the number below and add the payment reference as the note.',
                        'details': [[k, v] for k, v in rows if v]})
    ap = s['applepay']
    if ap['enabled'] and not applepay_missing(ap):
        methods.append({'id': 'applepay', 'label': 'Apple Pay', 'wallet': True,
                        'hint': 'Pay securely with Face ID / Touch ID using a card in your Apple Wallet. Your order is confirmed instantly.',
                        'details': [], 'applepay': {'displayName': ap['displayName'] or 'Lofan', 'countryCode': 'QA', 'currencyCode': CURRENCY}})
    return {'company': s['company'], 'currency': CURRENCY, 'methods': methods}


# ------------------------------------------------------------------ Apple Pay
# Needs: Apple Merchant ID + merchant identity certificate, a verified HTTPS domain, and a payment provider
# (built-in adapter: Checkout.com). See README.txt > APPLE PAY SETUP.
APPLEPAY_DIR = os.path.join(DATA, 'applepay')
IDENTITY_PEM = os.path.join(APPLEPAY_DIR, 'identity.pem')
os.makedirs(APPLEPAY_DIR, exist_ok=True)


def applepay_missing(ap, has_identity=None):
    has_identity = os.path.isfile(IDENTITY_PEM) if has_identity is None else has_identity
    need = []
    if not ap.get('merchantId'): need.append('Apple Merchant ID')
    if not has_identity: need.append('Merchant identity certificate (PEM)')
    if not ap.get('publicKey') or not ap.get('secretKey'): need.append('Payment provider public + secret key')
    if not ap.get('domainFile'): need.append('Domain verification file')
    return need


def settings_for_admin(c):
    out = json.loads(json.dumps(get_settings(c)))
    ap = out['applepay']
    ap['hasSecret'] = bool(ap['secretKey']); ap['secretKey'] = ''          # never send secrets back to the browser
    ap['hasIdentity'] = os.path.isfile(IDENTITY_PEM)
    ap['missing'] = applepay_missing(get_settings(c)['applepay'])
    return out


def apple_validate(ap, validation_url, host):
    """Merchant validation: our server proves to Apple that we own the Merchant ID (mutual-TLS with our certificate)."""
    import ssl, urllib.request
    from urllib.parse import urlparse as _up
    u = _up(str(validation_url or ''))
    if u.scheme != 'https' or not (u.hostname or '').endswith('.apple.com'):
        raise ApiError(400, 'Invalid Apple Pay validation address.')
    try:
        ctx = ssl.create_default_context()
        ctx.load_cert_chain(IDENTITY_PEM)
    except Exception as e:
        sys.stderr.write('Apple Pay certificate problem (check the PEM saved in Admin): %r\n' % (e,))
        raise ApiError(502, 'Apple Pay could not be started. Please choose another payment method.')
    body = json.dumps({'merchantIdentifier': ap['merchantId'], 'displayName': ap['displayName'] or 'Lofan',
                       'initiative': 'web', 'initiativeContext': ap['domain'] or host.split(':')[0]}).encode()
    req = urllib.request.Request(validation_url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        sys.stderr.write('Apple Pay merchant validation failed: %r\n' % (e,))
        raise ApiError(502, 'Apple Pay could not be started. Please choose another payment method.')


def psp_charge(ap, token_data, order, email, name):
    """Charge an Apple Pay token through Checkout.com. Returns (approved, payment_id). Replace this function to use another provider."""
    import urllib.request, urllib.error
    base = 'https://api.sandbox.checkout.com' if ap['sandbox'] else 'https://api.checkout.com'

    def post(path, key, payload, extra=None):
        headers = {'Content-Type': 'application/json', 'Authorization': key}
        headers.update(extra or {})
        req = urllib.request.Request(base + path, data=json.dumps(payload).encode(), headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            try: return {'_error': json.loads(e.read())}
            except Exception: return {'_error': {}}
        except Exception:
            raise ApiError(502, 'The payment provider could not be reached. Please try again.')

    tok = post('/tokens', ap['publicKey'], {'type': 'applepay', 'token_data': token_data})
    if not tok.get('token'): raise ApiError(402, 'Apple Pay could not read your card. Please try again or choose another method.')
    pay = post('/payments', 'Bearer ' + ap['secretKey'],
               {'source': {'type': 'token', 'token': tok['token']}, 'amount': int(order['total']) * 100, 'currency': CURRENCY,
                'reference': order['id'], 'capture': True, 'customer': {'email': email, 'name': name}},
               {'Cko-Idempotency-Key': order['id']})
    approved = bool(pay.get('approved')) or str(pay.get('status', '')).lower() in ('authorized', 'captured', 'paid')
    return approved, str(pay.get('id') or '')


_attempts = {}


def throttle(key, limit=10, window=600):
    t = time.time()
    hits = [x for x in _attempts.get(key, []) if t - x < window]
    if len(hits) >= limit:
        raise ApiError(429, 'Too many attempts. Please wait a few minutes.')
    hits.append(t)
    _attempts[key] = hits


# ------------------------------------------------------------------ request handler
class Handler(BaseHTTPRequestHandler):
    server_version = 'Lofan/1.0'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        if '/api/' in (self.path or ''):
            sys.stderr.write('%s %s\n' % (self.command, self.path.split('?')[0]))

    # ---- plumbing
    def send_json(self, code, obj, cookie=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        raw = getattr(self, '_body', b'')   # the body was already read off the socket in dispatch()
        if not raw:
            return {}
        if 'application/json' not in (self.headers.get('Content-Type') or ''):
            raise ApiError(415, 'JSON required')
        try:
            data = json.loads(raw)
        except ValueError:
            raise ApiError(400, 'Invalid JSON')
        if not isinstance(data, dict):
            raise ApiError(400, 'Invalid JSON')
        return data

    def current_user(self, c):
        if hasattr(self, '_user'):
            return self._user
        self._user = None
        cookie = self.headers.get('Cookie') or ''
        m = re.search(r'lofan_session=([A-Za-z0-9_-]+)', cookie)
        if m:
            row = c.execute('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',
                            (m.group(1), now())).fetchone()
            self._user = row
        return self._user

    def need_user(self, c):
        u = self.current_user(c)
        if not u:
            raise ApiError(401, 'Please sign in first')
        return u

    def need_admin(self, c):
        u = self.need_user(c)
        if u['role'] != 'admin':
            raise ApiError(403, 'Admin access only')
        return u

    def start_session(self, c, user_id):
        tok = secrets.token_urlsafe(32)
        c.execute('DELETE FROM sessions WHERE expires<?', (now(),))
        c.execute('INSERT INTO sessions VALUES(?,?,?)', (tok, user_id, now() + 30 * 86400))
        return f'lofan_session={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age={30 * 86400}'

    # ---- verbs
    def do_GET(self): self.dispatch('GET')
    def do_POST(self): self.dispatch('POST')
    def do_PUT(self): self.dispatch('PUT')
    def do_DELETE(self): self.dispatch('DELETE')

    def dispatch(self, method):
        self.__dict__.pop('_user', None)   # connections are reused: never carry a login over between requests
        n = int(self.headers.get('Content-Length') or 0)
        if n > 8_000_000:
            self.close_connection = True
            return self.send_json(413, {'error': 'Request too large'})
        self._body = self.rfile.read(n) if n else b''   # always consume the body, even if a route ignores it, so keep-alive stays in sync
        path = urlparse(self.path)
        if path.path.startswith('/api/'):
            c = conn()
            try:
                c.execute('BEGIN IMMEDIATE' if method != 'GET' else 'BEGIN')
                code, obj, cookie = self.api(c, method, path.path[5:].rstrip('/'), parse_qs(path.query))
                c.execute('COMMIT')
                if isinstance(obj, tuple):   # raw file response
                    self.send_file_bytes(*obj)
                else:
                    self.send_json(code, obj, cookie)
            except ApiError as e:
                try: c.execute('ROLLBACK')
                except sqlite3.Error: pass
                self.send_json(e.code, {'error': e.msg, 'field': e.field} if e.field else {'error': e.msg})
            except (ConnectionError, BrokenPipeError):
                pass
            except Exception as e:  # unexpected
                try: c.execute('ROLLBACK')
                except sqlite3.Error: pass
                sys.stderr.write('ERROR %r\n' % (e,))
                self.send_json(500, {'error': 'Server error'})
            finally:
                c.close()
        elif method == 'GET':
            self.static(path.path)
        else:
            self.send_json(405, {'error': 'Method not allowed'})

    def send_file_bytes(self, data, ctype, name):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Content-Disposition', f'inline; filename="{name}"')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    # ---- static files
    def static(self, p):
        p = unquote(p)
        if p in ('', '/'):
            p = '/index.html'
        if p == '/.well-known/apple-developer-merchantid-domain-association.txt':   # Apple domain verification (pasted in admin)
            c = conn()
            try: txt = get_settings(c)['applepay']['domainFile']
            finally: c.close()
            data = txt.encode() if txt else b'Not found'
            self.send_response(200 if txt else 404)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        full = os.path.realpath(os.path.join(ROOT, p.lstrip('/')))
        rel = os.path.relpath(full, ROOT).replace('\\', '/')
        blocked = rel.startswith(('data', '.vscode', '.git')) or rel.endswith(('.py', '.db', '.bat', '.db-wal', '.db-shm'))
        if not full.startswith(ROOT) or blocked or not os.path.isfile(full):
            self.send_response(404)
            msg = b'Not found'
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return
        size = os.path.getsize(full)
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        start, end, code = 0, size - 1, 200
        rng = re.fullmatch(r'bytes=(\d*)-(\d*)', self.headers.get('Range') or '')
        if rng and (rng.group(1) or rng.group(2)):
            if rng.group(1):
                start = int(rng.group(1))
                end = int(rng.group(2)) if rng.group(2) else size - 1
            else:
                start = max(0, size - int(rng.group(2)))
            end = min(end, size - 1)
            code = 206
        try:
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'no-cache')
            if code == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(end - start + 1))
            self.end_headers()
            with open(full, 'rb') as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (ConnectionError, BrokenPipeError):
            pass

    # ================================================================== API
    def api(self, c, method, route, q):
        R = lambda m, pat: method == m and re.fullmatch(pat, route)

        # ---------- public
        if R('GET', 'me'):
            u = self.current_user(c)
            return 200, {'user': public_user(u) if u else None}, None

        if R('POST', 'register'):
            d = self.read_json()
            name, email, phone = clean(d.get('name'), 80), clean(d.get('email'), 120).lower(), norm_phone(d.get('phone'))
            pw = str(d.get('password') or '')
            if len(name) < 2: raise ApiError(400, 'Please enter your full name.', 'name')
            if not valid_phone(phone): raise ApiError(400, 'Please enter a valid mobile number.', 'phone')
            if not valid_email(email): raise ApiError(400, 'Please enter a valid email address.', 'email')
            if len(pw) < 6: raise ApiError(400, 'Password must be at least 6 characters.', 'password')
            em_row = c.execute('SELECT google_sub, hash FROM users WHERE email=?', (email,)).fetchone()
            ph_row = c.execute('SELECT 1 FROM users WHERE phone=?', (phone,)).fetchone()
            if em_row and ph_row:
                raise ApiError(409, 'This email and mobile number are already registered to an existing account. Please sign in instead.', 'email')
            if em_row:
                extra = ' It was created with Google – choose "Continue with Google".' if em_row['google_sub'] and not em_row['hash'] else ''
                raise ApiError(409, 'This email is already registered to an existing account. Please sign in, or use a different email.' + extra, 'email')
            if ph_row:
                raise ApiError(409, 'This mobile number is already registered to an existing account. Please sign in, or use a different number.', 'phone')
            salt, h = hash_pw(pw)
            cur = c.execute('INSERT INTO users(name,email,phone,salt,hash,role,created) VALUES(?,?,?,?,?,?,?)', (name, email, phone, salt, h, 'customer', now()))
            cookie = self.start_session(c, cur.lastrowid)
            u = c.execute('SELECT * FROM users WHERE id=?', (cur.lastrowid,)).fetchone()
            return 200, {'user': public_user(u)}, cookie

        if R('POST', 'login'):
            d = self.read_json()
            ident, pw = clean(d.get('id'), 120).lower(), str(d.get('password') or '')
            throttle(self.client_address[0] + ident)
            u = c.execute('SELECT * FROM users WHERE email=? OR phone=?', (ident, norm_phone(ident) if valid_phone(ident) else '-')).fetchone()
            ok = False
            if u and u['hash']:
                _, h = hash_pw(pw, u['salt'])
                ok = hmac.compare_digest(h, u['hash'])
            elif u and u['google_sub']:
                raise ApiError(401, 'This account uses Google. Please choose "Continue with Google".')
            if not ok: raise ApiError(401, 'Incorrect email/phone or password.')
            return 200, {'user': public_user(u)}, self.start_session(c, u['id'])

        if R('GET', 'check'):   # live "is this email / mobile already registered?" hint on the sign-up form
            throttle('chk' + self.client_address[0], 80, 600)
            em, ph = clean((q.get('email') or [''])[0], 120).lower(), norm_phone((q.get('phone') or [''])[0])
            out = {}
            if em and valid_email(em): out['emailTaken'] = bool(c.execute('SELECT 1 FROM users WHERE email=?', (em,)).fetchone())
            if ph and valid_phone(ph): out['phoneTaken'] = bool(c.execute('SELECT 1 FROM users WHERE phone=?', (ph,)).fetchone())
            return 200, out, None

        if R('GET', 'config'):
            co = get_settings(c)['company']
            return 200, {'googleClientId': google_client_id(c), 'whatsapp': co['whatsapp'], 'phone': co['phone']}, None

        if R('POST', 'google'):
            d = self.read_json()
            cid = google_client_id(c)
            if not cid: raise ApiError(503, 'Google sign-in is not set up yet.')
            throttle('g' + self.client_address[0], 20)
            info = verify_google(d.get('credential'), cid)
            email, sub = info['email'].lower(), info['sub']
            u = c.execute('SELECT * FROM users WHERE google_sub=? OR email=?', (sub, email)).fetchone()
            created = False
            if u:
                if u['role'] == 'admin': raise ApiError(403, 'Admin accounts must sign in with email and password.')
                if not u['google_sub']: c.execute('UPDATE users SET google_sub=? WHERE id=?', (sub, u['id']))
                uid = u['id']
            else:
                name = clean(info.get('name') or email.split('@')[0], 80)
                cur = c.execute('INSERT INTO users(name,email,phone,salt,hash,role,created,google_sub) VALUES(?,?,NULL,NULL,NULL,?,?,?)', (name, email, 'customer', now(), sub))
                uid, created = cur.lastrowid, True
            u = c.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
            return 200, {'user': public_user(u), 'created': created}, self.start_session(c, uid)

        if R('POST', 'logout'):
            m = re.search(r'lofan_session=([A-Za-z0-9_-]+)', self.headers.get('Cookie') or '')
            if m: c.execute('DELETE FROM sessions WHERE token=?', (m.group(1),))
            return 200, {'ok': True}, 'lofan_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'

        if R('GET', 'products'):
            s = get_settings(c)
            cats = {r['key']: r['label'] for r in c.execute('SELECT key,label FROM categories ORDER BY sort,rowid')}
            prods = [dict(r) for r in c.execute('SELECT id,name,cat,price,stock,img,desc FROM products WHERE active=1 ORDER BY id')]
            return 200, {'categories': cats, 'products': prods, 'shipping': s['shipping'], 'currency': CURRENCY, 'company': s['company']}, None

        if R('POST', 'enquiries'):
            d = self.read_json()
            name, email, phone, msg = clean(d.get('name'), 80), clean(d.get('email'), 120), clean(d.get('phone'), 30), clean(d.get('message'), 2000)
            if not name or not msg or not valid_email(email) or not phone: raise ApiError(400, 'Please complete the required fields.')
            cur = c.execute('INSERT INTO enquiries(name,company,email,phone,type,qty,message,created) VALUES(?,?,?,?,?,?,?,?)',
                            (name, clean(d.get('company'), 80), email, phone, clean(d.get('type'), 60), clean(d.get('qty'), 60), msg, now()))
            notify(c, 'enquiry', f'New enquiry from {name}', f"{clean(d.get('type'), 60)} · {phone}", str(cur.lastrowid))
            return 200, {'ok': True}, None

        if R('GET', 'admin/status'):
            return 200, {'hasAdmin': bool(c.execute("SELECT 1 FROM users WHERE role='admin'").fetchone())}, None

        if R('POST', 'admin/setup'):
            if c.execute("SELECT 1 FROM users WHERE role='admin'").fetchone(): raise ApiError(403, 'An admin account already exists.')
            d = self.read_json()
            name, email, pw = clean(d.get('name'), 80), clean(d.get('email'), 120).lower(), str(d.get('password') or '')
            if len(name) < 2 or not valid_email(email): raise ApiError(400, 'Enter a name and a valid email.')
            if len(pw) < 8: raise ApiError(400, 'Admin password must be at least 8 characters.')
            if c.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone(): raise ApiError(409, 'That email is already used by a customer account.')
            salt, h = hash_pw(pw)
            cur = c.execute('INSERT INTO users(name,email,phone,salt,hash,role,created) VALUES(?,?,?,?,?,?,?)', (name, email, 'admin-' + secrets.token_hex(4), salt, h, 'admin', now()))
            u = c.execute('SELECT * FROM users WHERE id=?', (cur.lastrowid,)).fetchone()
            return 200, {'user': public_user(u)}, self.start_session(c, cur.lastrowid)

        # ---------- customer
        if R('PUT', 'me'):
            u, d = self.need_user(c), self.read_json()
            name, email, phone = clean(d.get('name'), 80), clean(d.get('email'), 120).lower(), norm_phone(d.get('phone'))
            if len(name) < 2: raise ApiError(400, 'Please enter your name.')
            if u['role'] == 'admin':
                phone = u['phone']
            elif not valid_phone(phone): raise ApiError(400, 'Please enter a valid phone number.')
            if not valid_email(email): raise ApiError(400, 'Please enter a valid email address.')
            if c.execute('SELECT 1 FROM users WHERE email=? AND id<>?', (email, u['id'])).fetchone(): raise ApiError(409, 'This email is already registered to another account. Please use a different email.', 'email')
            if c.execute('SELECT 1 FROM users WHERE phone=? AND id<>?', (phone, u['id'])).fetchone(): raise ApiError(409, 'This mobile number is already registered to another account. Please use a different number.', 'phone')
            c.execute('UPDATE users SET name=?,email=?,phone=?,address=? WHERE id=?', (name, email, phone, clean(d.get('address'), 300), u['id']))
            return 200, {'user': public_user(c.execute('SELECT * FROM users WHERE id=?', (u['id'],)).fetchone())}, None

        if R('PUT', 'me/location'):   # customer shares / updates their current location (their own explicit action)
            u, d = self.need_user(c), self.read_json()
            loc = valid_loc(d.get('lat'), d.get('lng'))
            if not loc: raise ApiError(400, 'That location could not be read. Please try again.')
            save_user_loc(c, u['id'], loc)
            return 200, {'user': public_user(c.execute('SELECT * FROM users WHERE id=?', (u['id'],)).fetchone())}, None

        if R('DELETE', 'me/location'):
            u = self.need_user(c)
            c.execute('UPDATE users SET lat=NULL,lng=NULL,loc_at=NULL WHERE id=?', (u['id'],))
            return 200, {'user': public_user(c.execute('SELECT * FROM users WHERE id=?', (u['id'],)).fetchone())}, None

        if R('POST', 'me/password'):
            u, d = self.need_user(c), self.read_json()
            if u['hash']:   # Google-only accounts have no password yet, so they can simply set one
                _, h = hash_pw(str(d.get('current') or ''), u['salt'])
                if not hmac.compare_digest(h, u['hash']): raise ApiError(400, 'Current password is incorrect.')
            new = str(d.get('new') or '')
            if len(new) < (8 if u['role'] == 'admin' else 6): raise ApiError(400, 'New password is too short.')
            salt, h = hash_pw(new)
            c.execute('UPDATE users SET salt=?,hash=? WHERE id=?', (salt, h, u['id']))
            return 200, {'ok': True}, None

        if R('GET', 'payment-info'):
            self.need_user(c)
            return 200, payment_info(c), None

        if R('POST', 'orders'):
            u, d = self.need_user(c), self.read_json()
            dl = d.get('delivery') or {}
            delivery = {'name': clean(dl.get('name'), 80), 'phone': norm_phone(dl.get('phone')), 'email': clean(dl.get('email'), 120),
                        'address': clean(dl.get('address'), 300), 'notes': clean(dl.get('notes'), 300)}
            loc = valid_loc(dl.get('lat'), dl.get('lng'))   # optional: the customer chose "Share my current location"
            if loc:
                delivery['lat'], delivery['lng'] = loc
                try: delivery['acc'] = max(0, min(100000, int(float(dl.get('acc') or 0))))
                except (TypeError, ValueError): delivery['acc'] = 0
                save_user_loc(c, u['id'], loc)
            if len(delivery['name']) < 2 or not valid_phone(delivery['phone']) or not valid_email(delivery['email']) or len(delivery['address']) < 5:
                raise ApiError(400, 'Please complete your delivery details (name, phone, email, address).')
            want = {}
            for it in d.get('items') or []:
                try: pid, qty = int(it.get('id')), int(it.get('qty'))
                except (TypeError, ValueError, AttributeError): raise ApiError(400, 'Invalid cart')
                want[pid] = want.get(pid, 0) + max(0, qty)
            lines, subtotal = [], 0
            for pid, qty in want.items():
                p = c.execute('SELECT * FROM products WHERE id=? AND active=1', (pid,)).fetchone()
                if not p or qty < 1: raise ApiError(400, 'An item in your cart is no longer available.')
                if p['stock'] < qty: raise ApiError(409, f"Sorry, only {p['stock']} of \"{p['name']}\" left in stock.")
                lines.append({'id': pid, 'name': p['name'], 'price': p['price'], 'qty': qty})
                subtotal += p['price'] * qty
            if not lines: raise ApiError(400, 'Your cart is empty.')
            sh = get_settings(c)['shipping']
            shipping = 0 if subtotal >= sh['freeFrom'] else sh['fee']
            for ln in lines:
                c.execute('UPDATE products SET stock=stock-? WHERE id=?', (ln['qty'], ln['id']))
            oid = new_order_id(c)
            c.execute('INSERT INTO orders(id,user_id,created,items,subtotal,shipping,total,delivery,status) VALUES(?,?,?,?,?,?,?,?,?)',
                      (oid, u['id'], now(), json.dumps(lines), subtotal, shipping, subtotal + shipping, json.dumps(delivery), 'Awaiting payment'))
            add_event(c, oid, 'Awaiting payment', 'Order placed')
            c.execute('UPDATE users SET address=? WHERE id=? AND (address IS NULL OR address="")', (delivery['address'], u['id']))
            n = sum(l['qty'] for l in lines)
            notify(c, 'order', f'New order {oid}', f"{delivery['name']} · {n} item{'s' if n != 1 else ''} · {subtotal + shipping} {CURRENCY} · awaiting payment", oid)
            return 200, {'order': order_out(c, c.execute('SELECT * FROM orders WHERE id=?', (oid,)).fetchone())}, None

        if R('GET', 'orders'):
            u = self.need_user(c)
            rows = c.execute('SELECT * FROM orders WHERE user_id=? ORDER BY created DESC', (u['id'],)).fetchall()
            return 200, {'orders': [order_out(c, r) for r in rows]}, None

        m = re.fullmatch(r'orders/(LF-[A-Z0-9]{6})', route) if method == 'GET' else None
        if m:
            u = self.need_user(c)
            r = c.execute('SELECT * FROM orders WHERE id=? AND user_id=?', (m.group(1), u['id'])).fetchone()
            if not r: raise ApiError(404, 'Order not found')
            return 200, {'order': order_out(c, r)}, None

        m = re.fullmatch(r'orders/(LF-[A-Z0-9]{6})/payment', route) if method == 'POST' else None
        if m:
            u, d = self.need_user(c), self.read_json()
            r = c.execute('SELECT * FROM orders WHERE id=? AND user_id=?', (m.group(1), u['id'])).fetchone()
            if not r: raise ApiError(404, 'Order not found')
            if r['status'] != 'Awaiting payment': raise ApiError(409, 'Payment was already submitted for this order.')
            info = payment_info(c)
            method_id = clean(d.get('method'), 20)
            meth = next((x for x in info['methods'] if x['id'] == method_id), None)
            if not meth: raise ApiError(400, 'Please choose a payment method.')
            txn = clean(d.get('txn'), 60)
            if len(txn) < 4: raise ApiError(400, 'Please enter the transaction / reference number from your payment receipt.')
            receipt = None
            rc = d.get('receipt')
            if rc and rc.get('data'):
                receipt = save_data_url(rc['data'], RECEIPTS, r['id'], {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf'}, 1_500_000)
            c.execute('UPDATE orders SET method=?,txn=?,receipt=?,status=? WHERE id=?', (meth['label'], txn, receipt, 'Payment submitted', r['id']))
            add_event(c, r['id'], 'Payment submitted', f"{meth['label']} · ref {txn}")
            notify(c, 'payment', f"Payment submitted – {r['id']}", f"{json.loads(r['delivery'])['name']} paid {r['total']} {CURRENCY} via {meth['label']} (ref {txn}). Please verify.", r['id'])
            return 200, {'order': order_out(c, c.execute('SELECT * FROM orders WHERE id=?', (r['id'],)).fetchone())}, None

        m = re.fullmatch(r'orders/(LF-[A-Z0-9]{6})/cancel', route) if method == 'POST' else None
        if m:
            u = self.need_user(c)
            r = c.execute('SELECT * FROM orders WHERE id=? AND user_id=?', (m.group(1), u['id'])).fetchone()
            if not r: raise ApiError(404, 'Order not found')
            if r['status'] != 'Awaiting payment': raise ApiError(409, 'Only unpaid orders can be cancelled here. Please contact us.')
            restore_stock(c, r)
            c.execute("UPDATE orders SET status='Cancelled' WHERE id=?", (r['id'],))
            sweep_soldout(c)
            add_event(c, r['id'], 'Cancelled', 'Cancelled by customer')
            notify(c, 'order', f"Order {r['id']} cancelled", 'Cancelled by the customer before payment.', r['id'])
            return 200, {'ok': True}, None

        m = re.fullmatch(r'orders/(LF-[A-Z0-9]{6})/applepay/(session|pay)', route) if method == 'POST' else None
        if m:
            u, d = self.need_user(c), self.read_json()
            r = c.execute('SELECT * FROM orders WHERE id=? AND user_id=?', (m.group(1), u['id'])).fetchone()
            if not r: raise ApiError(404, 'Order not found')
            if r['status'] != 'Awaiting payment': raise ApiError(409, 'This order is no longer awaiting payment.')
            ap = get_settings(c)['applepay']
            if not ap['enabled'] or applepay_missing(ap): raise ApiError(400, 'Apple Pay is not available right now.')
            if m.group(2) == 'session':
                return 200, apple_validate(ap, d.get('validationURL'), self.headers.get('Host') or ''), None
            token = d.get('token')
            if not isinstance(token, dict): raise ApiError(400, 'Missing Apple Pay token.')
            throttle('ap%s' % u['id'], 10, 600)
            delivery = json.loads(r['delivery'])
            approved, pid = psp_charge(ap, token, r, delivery['email'], delivery['name'])
            if not approved: raise ApiError(402, 'Your payment was declined. Please try another card or payment method.')
            c.execute("UPDATE orders SET method=?,txn=?,status=? WHERE id=?", ('Apple Pay', pid, 'Payment confirmed', r['id']))
            add_event(c, r['id'], 'Payment confirmed', f'Apple Pay – paid online (ref {pid})')
            notify(c, 'payment', f"Apple Pay payment received – {r['id']}", f"{delivery['name']} paid {r['total']} {CURRENCY} by Apple Pay (ref {pid}). Already confirmed.", r['id'])
            return 200, {'order': order_out(c, c.execute('SELECT * FROM orders WHERE id=?', (r['id'],)).fetchone())}, None

        # ---------- customer chat (website live chat with the admin)
        def msg_out(rows):
            out = []
            for r in rows:
                m = re.fullmatch(r'\[loc:(-?\d+\.\d+),(-?\d+\.\d+)\]', r['body'] or '')   # a shared location is stored as [loc:lat,lng]
                out.append({'id': r['id'], 'sender': r['sender'], 'body': '' if m else r['body'], 'created': r['created'],
                            'loc': {'lat': float(m.group(1)), 'lng': float(m.group(2))} if m else None})
            return out

        if R('GET', 'chat'):
            u = self.need_user(c)
            after = int((q.get('after') or ['0'])[0] or 0)
            if (q.get('open') or ['0'])[0] == '1':
                c.execute("UPDATE messages SET seen=1 WHERE user_id=? AND sender='admin'", (u['id'],))
            rows = c.execute('SELECT * FROM messages WHERE user_id=? AND id>? ORDER BY id LIMIT 200', (u['id'], after)).fetchall()
            return 200, {'messages': msg_out(rows)}, None

        if R('GET', 'chat/unread'):
            u = self.need_user(c)
            n = c.execute("SELECT COUNT(*) n FROM messages WHERE user_id=? AND sender='admin' AND seen=0", (u['id'],)).fetchone()['n']
            return 200, {'unread': n}, None

        if R('POST', 'chat'):
            u, d = self.need_user(c), self.read_json()
            if u['role'] == 'admin': raise ApiError(403, 'Use the admin chat page.')
            body, loc = clean(d.get('body'), 1000), None
            if d.get('location'):
                loc = valid_loc((d['location'] or {}).get('lat'), (d['location'] or {}).get('lng'))
                if not loc: raise ApiError(400, 'That location could not be read. Please try again.')
                body = f'[loc:{loc[0]:.6f},{loc[1]:.6f}]'
                save_user_loc(c, u['id'], loc)
            if not body: raise ApiError(400, 'Type a message first.')
            throttle('chat%s' % u['id'], 40, 60)
            cur = c.execute("INSERT INTO messages(user_id,sender,body,created) VALUES(?,?,?,?)", (u['id'], 'customer', body, now()))
            notify(c, 'chat', f"Message from {u['name']}", '📍 Shared their location' if loc else body[:140], str(u['id']))
            return 200, {'message': msg_out([c.execute('SELECT * FROM messages WHERE id=?', (cur.lastrowid,)).fetchone()])[0]}, None

        # ---------- admin
        if route.startswith('admin/'):
            self.need_admin(c)

        if R('GET', 'admin/orders'):
            st = (q.get('status') or [''])[0]
            rows = c.execute('SELECT * FROM orders WHERE (?="" OR status=?) ORDER BY created DESC', (st, st)).fetchall()
            return 200, {'orders': [order_out(c, r, True) for r in rows], 'statuses': STATUSES}, None

        m = re.fullmatch(r'admin/orders/(LF-[A-Z0-9]{6})', route) if method == 'PUT' else None
        if m:
            d = self.read_json()
            r = c.execute('SELECT * FROM orders WHERE id=?', (m.group(1),)).fetchone()
            if not r: raise ApiError(404, 'Order not found')
            new = d.get('status')
            if new not in STATUSES: raise ApiError(400, 'Invalid status')
            if r['status'] == 'Cancelled' and new != 'Cancelled': raise ApiError(409, 'Cancelled orders cannot be reopened.')
            if new == 'Cancelled' and r['status'] != 'Cancelled': restore_stock(c, r)
            c.execute('UPDATE orders SET status=? WHERE id=?', (new, r['id']))
            sweep_soldout(c)
            add_event(c, r['id'], new, clean(d.get('note'), 200))
            return 200, {'order': order_out(c, c.execute('SELECT * FROM orders WHERE id=?', (r['id'],)).fetchone(), True)}, None

        m = re.fullmatch(r'admin/receipt/(LF-[A-Z0-9]{6})', route) if method == 'GET' else None
        if m:
            r = c.execute('SELECT receipt FROM orders WHERE id=?', (m.group(1),)).fetchone()
            if not r or not r['receipt']: raise ApiError(404, 'No receipt')
            path = os.path.join(RECEIPTS, os.path.basename(r['receipt']))
            with open(path, 'rb') as f:
                data = f.read()
            return 200, (data, mimetypes.guess_type(path)[0] or 'application/octet-stream', os.path.basename(path)), None

        if R('GET', 'admin/notifications'):
            after = int((q.get('after') or ['0'])[0] or 0)
            items = [dict(r) for r in c.execute('SELECT * FROM notifications WHERE id>? ORDER BY id DESC LIMIT 100', (after,))]
            recent = [dict(r) for r in c.execute('SELECT * FROM notifications ORDER BY id DESC LIMIT 30')] if after == 0 else []
            unread = c.execute('SELECT COUNT(*) n FROM notifications WHERE read=0').fetchone()['n']
            latest = c.execute('SELECT COALESCE(MAX(id),0) n FROM notifications').fetchone()['n']
            chat_unread = c.execute("SELECT COUNT(*) n FROM messages WHERE sender='customer' AND seen=0").fetchone()['n']
            return 200, {'items': items, 'recent': recent, 'unread': unread, 'latest': latest, 'chatUnread': chat_unread}, None

        if R('POST', 'admin/notifications/read'):
            c.execute('UPDATE notifications SET read=1')
            return 200, {'ok': True}, None

        if R('GET', 'admin/chats'):
            rows = c.execute("""SELECT u.id,u.name,u.phone,
                (SELECT body FROM messages m WHERE m.user_id=u.id ORDER BY m.id DESC LIMIT 1) last,
                (SELECT MAX(created) FROM messages m WHERE m.user_id=u.id) lastAt,
                (SELECT COUNT(*) FROM messages m WHERE m.user_id=u.id AND m.sender='customer' AND m.seen=0) unread
                FROM users u WHERE u.role='customer' AND EXISTS(SELECT 1 FROM messages m WHERE m.user_id=u.id) ORDER BY lastAt DESC""").fetchall()
            return 200, {'threads': [dict(r) for r in rows]}, None

        m = re.fullmatch(r'admin/chats/(\d+)', route)
        if m and method == 'GET':
            cu = c.execute("SELECT id,name,phone,email,address,lat,lng,loc_at FROM users WHERE id=? AND role='customer'", (m.group(1),)).fetchone()
            if not cu: raise ApiError(404, 'Customer not found')
            after = int((q.get('after') or ['0'])[0] or 0)
            c.execute("UPDATE messages SET seen=1 WHERE user_id=? AND sender='customer'", (cu['id'],))
            rows = c.execute('SELECT * FROM messages WHERE user_id=? AND id>? ORDER BY id LIMIT 300', (cu['id'], after)).fetchall()
            return 200, {'customer': dict(cu), 'messages': msg_out(rows)}, None
        if m and method == 'POST':
            cu = c.execute("SELECT id FROM users WHERE id=? AND role='customer'", (m.group(1),)).fetchone()
            if not cu: raise ApiError(404, 'Customer not found')
            body = clean(self.read_json().get('body'), 1000)
            if not body: raise ApiError(400, 'Type a message first.')
            cur = c.execute("INSERT INTO messages(user_id,sender,body,created,seen) VALUES(?,?,?,?,0)", (cu['id'], 'admin', body, now()))
            c.execute("UPDATE messages SET seen=1 WHERE user_id=? AND sender='customer'", (cu['id'],))
            return 200, {'message': msg_out([c.execute('SELECT * FROM messages WHERE id=?', (cur.lastrowid,)).fetchone()])[0]}, None

        if R('GET', 'admin/products'):
            cats = {r['key']: r['label'] for r in c.execute('SELECT key,label FROM categories ORDER BY sort,rowid')}
            return 200, {'categories': cats, 'products': [dict(r) for r in c.execute('SELECT * FROM products ORDER BY id')]}, None

        def product_fields(d, base=None):
            base = dict(base) if base else {}
            if 'name' in d: base['name'] = clean(d['name'], 100)
            if 'cat' in d:
                if not c.execute('SELECT 1 FROM categories WHERE key=?', (d['cat'],)).fetchone(): raise ApiError(400, 'Unknown category')
                base['cat'] = d['cat']
            for f in ('price', 'stock'):
                if f in d:
                    try: base[f] = max(0, int(d[f]))
                    except (TypeError, ValueError): raise ApiError(400, f'Invalid {f}')
            if 'desc' in d: base['desc'] = clean(d['desc'], 300)
            if 'active' in d: base['active'] = 1 if d['active'] else 0
            if d.get('image') and d['image'].get('data'):
                slug = re.sub(r'[^a-z0-9]+', '-', str(base.get('name', 'item')).lower()).strip('-') or 'item'
                fn = save_data_url(d['image']['data'], PRODUCT_IMG, f'{slug}-{secrets.token_hex(3)}', {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}, 4_000_000)
                base['img'] = 'images/products/' + fn
            return base

        if R('POST', 'admin/products'):
            p = product_fields(self.read_json())
            if not p.get('name') or 'cat' not in p or 'price' not in p or 'img' not in p: raise ApiError(400, 'Name, category, price and photo are required.')
            c.execute('INSERT INTO products(name,cat,price,stock,img,desc,active) VALUES(?,?,?,?,?,?,?)',
                      (p['name'], p['cat'], p['price'], p.get('stock', 0), p['img'], p.get('desc', ''), p.get('active', 1)))
            return 200, {'ok': True}, None

        m = re.fullmatch(r'admin/products/(\d+)', route)
        if m and method == 'PUT':
            row = c.execute('SELECT * FROM products WHERE id=?', (m.group(1),)).fetchone()
            if not row: raise ApiError(404, 'Not found')
            p = product_fields(self.read_json(), row)
            c.execute('UPDATE products SET name=?,cat=?,price=?,stock=?,img=?,desc=?,active=? WHERE id=?',
                      (p['name'], p['cat'], p['price'], p['stock'], p['img'], p['desc'], p['active'], row['id']))
            gone = sweep_soldout(c) if p['stock'] <= 0 else 0
            return 200, {'ok': True, 'autoDeleted': gone}, None
        if m and method == 'DELETE':   # permanent: the item disappears from the shop and the admin list (past orders keep their own copy)
            c.execute('DELETE FROM products WHERE id=?', (m.group(1),))
            return 200, {'ok': True}, None

        if R('POST', 'admin/products/delete-soldout'):   # one click: permanently remove every item that has no stock
            n = c.execute('DELETE FROM products WHERE stock<=0').rowcount
            return 200, {'ok': True, 'deleted': n}, None

        if R('POST', 'admin/categories'):
            label = clean(self.read_json().get('label'), 40)
            key = re.sub(r'[^a-z0-9]+', '-', label.lower()).strip('-')
            if not key: raise ApiError(400, 'Enter a category name')
            if c.execute('SELECT 1 FROM categories WHERE key=?', (key,)).fetchone(): raise ApiError(409, 'Category already exists')
            c.execute('INSERT INTO categories VALUES(?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM categories))', (key, label))
            return 200, {'ok': True}, None

        if R('GET', 'admin/settings'):
            return 200, {'settings': settings_for_admin(c)}, None

        if R('PUT', 'admin/settings'):
            d = self.read_json()
            s = get_settings(c)
            co, sh, pay = d.get('company') or {}, d.get('shipping') or {}, d.get('payments') or {}
            for k in ('name', 'crNumber', 'address', 'phone', 'email', 'whatsapp'):
                if k in co: s['company'][k] = clean(co[k], 150)
            if s['company']['email'] and not valid_email(s['company']['email']): raise ApiError(400, 'Company email is not valid.')
            s['company']['whatsapp'] = re.sub(r'\D', '', s['company']['whatsapp'])
            for k in ('fee', 'freeFrom'):
                if k in sh:
                    try: s['shipping'][k] = max(0, int(sh[k]))
                    except (TypeError, ValueError): raise ApiError(400, 'Shipping values must be numbers.')
            ib = pay.get('iban') or {}
            for k in ('bankName', 'accountName', 'accountNumber', 'branch'):
                if k in ib: s['payments']['iban'][k] = clean(ib[k], 100)
            if 'enabled' in ib: s['payments']['iban']['enabled'] = bool(ib['enabled'])
            if 'iban' in ib:
                v = re.sub(r'\s', '', clean(ib['iban'], 40)).upper()
                if v and not iban_ok(v): raise ApiError(400, 'Invalid Qatar IBAN. It must be 29 characters starting with QA (e.g. QA58 DOHB 0000 1234 5678 90AB CDEF G) and pass the checksum.')
                s['payments']['iban']['iban'] = v
            if 'swift' in ib:
                v = clean(ib['swift'], 11).upper().replace(' ', '')
                if v and not re.fullmatch(r'[A-Z]{4}QA[A-Z0-9]{2}([A-Z0-9]{3})?', v): raise ApiError(400, 'Invalid SWIFT/BIC for a Qatar bank (8 or 11 characters, e.g. XXXXQAQA).')
                s['payments']['iban']['swift'] = v
            fw = pay.get('fawran') or {}
            for k in ('accountName', 'bankName'):
                if k in fw: s['payments']['fawran'][k] = clean(fw[k], 100)
            if 'enabled' in fw: s['payments']['fawran']['enabled'] = bool(fw['enabled'])
            if 'alias' in fw:
                v = clean(fw['alias'], 40).replace(' ', '')
                if v and not (qa_mobile(v) or iban_ok(v)): raise ApiError(400, 'Fawran alias must be a Qatar mobile number (8 digits) or a valid Qatar IBAN.')
                s['payments']['fawran']['alias'] = qa_mobile(v) or v.upper()
            oo = pay.get('ooredoo') or {}
            if 'accountName' in oo: s['payments']['ooredoo']['accountName'] = clean(oo['accountName'], 100)
            if 'enabled' in oo: s['payments']['ooredoo']['enabled'] = bool(oo['enabled'])
            if 'number' in oo:
                v = clean(oo['number'], 20)
                if v and not qa_mobile(v): raise ApiError(400, 'Ooredoo Money number must be a Qatar mobile number (8 digits).')
                s['payments']['ooredoo']['number'] = qa_mobile(v) or ''
            if 'google' in d:
                gid = clean((d['google'] or {}).get('clientId'), 200)
                if gid and not re.fullmatch(r'[\w-]+\.apps\.googleusercontent\.com', gid): raise ApiError(400, 'Google Client ID looks wrong. It ends with .apps.googleusercontent.com')
                s['google']['clientId'] = gid
            ap_in = d.get('applepay')
            if ap_in is not None:
                a = s['applepay']
                if 'enabled' in ap_in: a['enabled'] = bool(ap_in['enabled'])
                if 'sandbox' in ap_in: a['sandbox'] = bool(ap_in['sandbox'])
                for k, mx in (('merchantId', 100), ('displayName', 60), ('domain', 120), ('publicKey', 200)):
                    if k in ap_in: a[k] = clean(ap_in[k], mx)
                if ap_in.get('secretKey'): a['secretKey'] = clean(ap_in['secretKey'], 200)   # blank = keep the saved one
                if 'domainFile' in ap_in: a['domainFile'] = str(ap_in['domainFile'] or '').strip()[:5000]
                pem = str(ap_in.get('identityPem') or '').strip()
                if pem and ('-----BEGIN CERTIFICATE-----' not in pem or 'PRIVATE KEY-----' not in pem):
                    raise ApiError(400, 'Paste BOTH the certificate and the private key (PEM text) in the Apple Pay certificate box.')
                miss = applepay_missing(a, bool(pem) or os.path.isfile(IDENTITY_PEM))
                if a['enabled'] and miss:
                    raise ApiError(400, 'Apple Pay cannot be switched on yet. Still needed: ' + ', '.join(miss) + '.')
                if pem:
                    with open(IDENTITY_PEM, 'w', encoding='utf-8') as f: f.write(pem + '\n')
            if 'shop' in d:
                s['shop']['autoDeleteSoldOut'] = bool((d['shop'] or {}).get('autoDeleteSoldOut'))
            c.execute("UPDATE settings SET value=? WHERE key='settings'", (json.dumps(s),))
            swept = sweep_soldout(c)
            out = settings_for_admin(c)
            out['swept'] = swept
            return 200, {'settings': out}, None

        if R('GET', 'admin/enquiries'):
            return 200, {'enquiries': [dict(r) for r in c.execute('SELECT * FROM enquiries ORDER BY id DESC')]}, None

        m = re.fullmatch(r'admin/enquiries/(\d+)', route)
        if m and method == 'PUT':
            st = clean(self.read_json().get('status'), 20)
            if st not in ('New', 'Replied', 'Closed'): raise ApiError(400, 'Invalid status')
            c.execute('UPDATE enquiries SET status=? WHERE id=?', (st, m.group(1)))
            return 200, {'ok': True}, None
        if m and method == 'DELETE':   # permanently remove an enquiry (and the contact details in it)
            c.execute('DELETE FROM enquiries WHERE id=?', (m.group(1),))
            return 200, {'ok': True}, None

        if R('GET', 'admin/customers'):
            rows = c.execute("""SELECT u.id,u.name,u.email,u.phone,u.address,u.created,u.lat,u.lng,u.loc_at,
                (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) orders,
                (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status NOT IN ('Delivered','Cancelled')) openOrders,
                (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id=u.id AND o.status<>'Cancelled') spent
                FROM users u WHERE role='customer' ORDER BY u.id DESC""").fetchall()
            return 200, {'customers': [dict(r) for r in rows]}, None

        m = re.fullmatch(r'admin/customers/(\d+)', route)
        if m and method == 'DELETE':
            # Permanently erase a customer's contact details. ?orders=keep  -> their past orders stay for your accounts
            #                                                  ?orders=delete -> their orders (and receipts) are erased too
            cu = c.execute("SELECT id,name FROM users WHERE id=? AND role='customer'", (m.group(1),)).fetchone()
            if not cu: raise ApiError(404, 'Customer not found')
            mode = (q.get('orders') or ['keep'])[0]
            orders = c.execute('SELECT * FROM orders WHERE user_id=?', (cu['id'],)).fetchall()
            if mode == 'delete':
                for o in orders:
                    if o['status'] in ('Awaiting payment', 'Payment submitted'): restore_stock(c, o)   # unpaid: put the items back on sale
                    if o['receipt']:
                        try: os.remove(os.path.join(RECEIPTS, os.path.basename(o['receipt'])))
                        except OSError: pass
                    c.execute('DELETE FROM order_events WHERE order_id=?', (o['id'],))
                    c.execute('DELETE FROM orders WHERE id=?', (o['id'],))
                sweep_soldout(c)
            else:
                c.execute('UPDATE orders SET user_id=0 WHERE user_id=?', (cu['id'],))   # orders stay, but no longer linked to an account
            c.execute('DELETE FROM messages WHERE user_id=?', (cu['id'],))
            c.execute("DELETE FROM notifications WHERE kind='chat' AND ref=?", (str(cu['id']),))
            c.execute('DELETE FROM sessions WHERE user_id=?', (cu['id'],))
            c.execute('DELETE FROM users WHERE id=?', (cu['id'],))
            return 200, {'ok': True, 'ordersDeleted': len(orders) if mode == 'delete' else 0, 'ordersKept': 0 if mode == 'delete' else len(orders)}, None

        if R('GET', 'admin/stats'):
            t = time.localtime()
            midnight = int(time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1)))
            paid = "('Payment confirmed','Preparing','Out for delivery','Delivered')"
            one = lambda sql, *a: c.execute(sql, a).fetchone()[0]
            days = []
            for i in range(6, -1, -1):
                a, b = midnight - i * 86400, midnight - (i - 1) * 86400
                days.append({'label': time.strftime('%a', time.localtime(a + 43200)),
                             'orders': one("SELECT COUNT(*) FROM orders WHERE created>=? AND created<? AND status<>'Cancelled'", a, b),
                             'revenue': one(f'SELECT COALESCE(SUM(total),0) FROM orders WHERE created>=? AND created<? AND status IN {paid}', a, b)})
            month = int(time.mktime((t.tm_year, t.tm_mon, 1, 0, 0, 0, 0, 0, -1)))
            low = [dict(r) for r in c.execute('SELECT id,name,stock FROM products WHERE stock>0 AND stock<=5 ORDER BY stock')]
            return 200, {
                'ordersToday': one("SELECT COUNT(*) FROM orders WHERE created>=? AND status<>'Cancelled'", midnight),
                'toVerify': one("SELECT COUNT(*) FROM orders WHERE status='Payment submitted'"),
                'awaitingPayment': one("SELECT COUNT(*) FROM orders WHERE status='Awaiting payment'"),
                'toDeliver': one("SELECT COUNT(*) FROM orders WHERE status IN ('Payment confirmed','Preparing','Out for delivery')"),
                'revenueMonth': one(f'SELECT COALESCE(SUM(total),0) FROM orders WHERE created>=? AND status IN {paid}', month),
                'revenueAll': one(f'SELECT COALESCE(SUM(total),0) FROM orders WHERE status IN {paid}'),
                'customers': one("SELECT COUNT(*) FROM users WHERE role='customer'"),
                'newCustomers7': one("SELECT COUNT(*) FROM users WHERE role='customer' AND created>=?", midnight - 6 * 86400),
                'chatUnread': one("SELECT COUNT(*) FROM messages WHERE sender='customer' AND seen=0"),
                'newEnquiries': one("SELECT COUNT(*) FROM enquiries WHERE status='New'"),
                'soldOut': one('SELECT COUNT(*) FROM products WHERE stock<=0'),
                'lowStock': low, 'days': days, 'currency': CURRENCY}, None

        raise ApiError(404, 'Not found')


if __name__ == '__main__':
    init_db()
    try:
        srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    except OSError:
        print(f'\n  The Lofan server is ALREADY running on port {PORT}.  Open  http://localhost:{PORT}\n')
        sys.exit(0)
    if '--open' in sys.argv:   # used by the VS Code task: open the website in the browser once the server is up
        import threading, webbrowser
        threading.Timer(1.2, lambda: webbrowser.open(f'http://localhost:{PORT}')).start()
    print(f'\n  LOFAN website running ->  http://localhost:{PORT}')
    print(f'  Admin page            ->  http://localhost:{PORT}/admin.html')
    print('  Press Ctrl+C to stop.\n')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')

