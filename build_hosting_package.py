#!/usr/bin/env python3
"""
Builds the ZIP you upload to cPanel  ->  dist/lofan-cpanel.zip

    python build_hosting_package.py            # website + your current shop items (no customers / orders)
    python build_hosting_package.py --full     # ALSO copies customers, orders, chats and enquiries from this PC
    python build_hosting_package.py --preview  # builds, then runs the PHP version on http://localhost:8020 for a final check

The pages (index.html, js/, css/, images/, videos/) are taken from this folder, so every edit you make here
is included the next time you run it.  The server code for hosting lives in the "hosting" folder.
"""
import json, os, shutil, sqlite3, subprocess, sys, time, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
HOSTING = os.path.join(ROOT, 'hosting')
DIST = os.path.join(ROOT, 'dist')
STAGE = os.path.join(DIST, 'lofan-site')
ZIP = os.path.join(DIST, 'lofan-cpanel.zip')
DB = os.path.join(ROOT, 'data', 'lofan.db')
PHP = os.environ.get('PHP_EXE') or os.path.join(os.path.expanduser('~'), 'lofan-tools', 'php', 'php.exe')

PAGES = ['index.html', 'account.html', 'payment.html', 'admin.html']
FOLDERS = ['css', 'js', 'images', 'videos']
SKIP_FILES = {'reference-design.jpg'}             # your design reference – not needed on the live site
FULL = '--full' in sys.argv
PREVIEW = '--preview' in sys.argv

DEFAULT_SEED = {
    'categories': [{'key': 'napkins', 'label': 'Napkins', 'sort': 0}, {'key': 'placemats', 'label': 'Placemats', 'sort': 1},
                   {'key': 'coasters', 'label': 'Trays & Coasters', 'sort': 2}, {'key': 'custom', 'label': 'Custom Pieces', 'sort': 3}],
    'products': [],
}


def export_seed():
    """Shop content from the local database. Secrets (Apple Pay keys, Google id) are removed."""
    DEVDB = os.path.join(ROOT, 'data', 'dev.sqlite')
    db = DEVDB if os.path.isfile(DEVDB) else DB            # the PHP test database wins over the old Python one
    if not os.path.isfile(db):
        print('  (no local database found – using the default shop items)')
        return DEFAULT_SEED
    c = sqlite3.connect('file:' + db.replace('\\', '/') + '?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    rows = lambda sql: [dict(r) for r in c.execute(sql)]
    seed = {'categories': rows('SELECT key,label,sort FROM categories ORDER BY sort'),
            'products': rows('SELECT id,name,cat,price,stock,img,desc,active FROM products ORDER BY id')}
    s = c.execute("SELECT value FROM settings WHERE key='settings'").fetchone()
    if s:
        st = json.loads(s[0])
        ap = st.get('applepay', {})
        st['applepay'] = {**ap, 'enabled': False, 'secretKey': '', 'publicKey': '', 'domainFile': '', 'merchantId': '', 'domain': ''}
        st['google'] = {'clientId': ''}
        al = st.get('alerts') or {}                                   # never export SMS / Telegram secrets
        if isinstance(al.get('sms'), dict): al['sms']['twilioToken'] = ''
        if isinstance(al.get('telegram'), dict): al['telegram']['botToken'] = ''
        seed['settings'] = st
    if FULL:
        for t in ('users', 'orders', 'order_events', 'messages', 'notifications', 'enquiries'):
            seed[t] = rows(f'SELECT * FROM {t}')
        print('  --full: including', {t: len(seed[t]) for t in ('users', 'orders', 'messages', 'enquiries')})
        print('  NOTE: receipts (uploaded payment proofs) are not copied; copy data/receipts/* to private/receipts/ by hand if you need them.')
    c.close()
    missing = [p['img'] for p in seed['products'] if not os.path.isfile(os.path.join(ROOT, p['img']))]
    if missing:
        print('  WARNING: these product photos are missing from the images folder:', missing)
    return seed


def copy_tree(src, dst):
    for base, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in ('__pycache__', '.git')]
        rel = os.path.relpath(base, src)
        os.makedirs(os.path.join(dst, rel), exist_ok=True)
        for f in files:
            if f in SKIP_FILES or f.startswith('_tmp'):
                continue
            shutil.copy2(os.path.join(base, f), os.path.join(dst, rel, f))


def stage():
    if os.path.isdir(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(STAGE)
    for p in PAGES:
        shutil.copy2(os.path.join(ROOT, p), STAGE)
    for f in FOLDERS:
        copy_tree(os.path.join(ROOT, f), os.path.join(STAGE, f))
    # server files for cPanel (everything in /hosting except the local-preview helpers)
    for name in os.listdir(HOSTING):
        if name in ('dev', 'images-products.htaccess'):
            continue
        src = os.path.join(HOSTING, name)
        if os.path.isdir(src):
            copy_tree(src, os.path.join(STAGE, name))
        else:
            shutil.copy2(src, STAGE)
    os.makedirs(os.path.join(STAGE, 'images', 'products'), exist_ok=True)
    shutil.copy2(os.path.join(HOSTING, 'images-products.htaccess'), os.path.join(STAGE, 'images', 'products', '.htaccess'))
    for d in ('receipts', 'applepay', 'throttle'):          # empty folders the server writes to (never ship local test files)
        shutil.rmtree(os.path.join(STAGE, 'private', d), ignore_errors=True)
        os.makedirs(os.path.join(STAGE, 'private', d), exist_ok=True)
        open(os.path.join(STAGE, 'private', d, 'index.html'), 'w').close()
    with open(os.path.join(STAGE, 'private', 'seed.json'), 'w', encoding='utf-8') as f:
        json.dump(export_seed(), f, ensure_ascii=False, indent=1)
    for stray in ('config.php', 'installed.lock', 'force_https.flag', 'error.log'):
        p = os.path.join(STAGE, 'private', stray)
        if os.path.exists(p):
            os.remove(p)


def make_zip():
    if os.path.exists(ZIP):
        os.remove(ZIP)
    n = 0
    with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, dirs, files in os.walk(STAGE):
            for f in sorted(files):
                full = os.path.join(base, f)
                z.write(full, os.path.relpath(full, STAGE).replace('\\', '/'))
                n += 1
    return n


UPDATE_ZIP = os.path.join(DIST, 'lofan-update.zip')
UPDATE_SKIP = {'install.php', 'private/seed.json', 'README-HOSTING.txt'}


def make_update_zip():
    """For a site that is already installed: same files, but no installer / seed data. Safe to extract over the live site."""
    if os.path.exists(UPDATE_ZIP):
        os.remove(UPDATE_ZIP)
    n = 0
    with zipfile.ZipFile(UPDATE_ZIP, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, dirs, files in os.walk(STAGE):
            for f in sorted(files):
                full = os.path.join(base, f)
                rel = os.path.relpath(full, STAGE).replace('\\', '/')
                if rel in UPDATE_SKIP:
                    continue
                z.write(full, rel)
                n += 1
    return n


def preview():
    pv = os.path.join(DIST, 'lofan-preview')
    if os.path.isdir(pv):
        shutil.rmtree(pv)
    shutil.copytree(STAGE, pv)
    shutil.copy2(os.path.join(HOSTING, 'dev', 'router.php'), os.path.join(pv, 'router.php'))
    data = os.path.join(DIST, 'preview-data'); os.makedirs(data, exist_ok=True)
    dbfile = os.path.join(data, 'preview.sqlite')
    if os.path.exists(dbfile):
        os.remove(dbfile)
    with open(os.path.join(pv, 'private', 'config.php'), 'w', encoding='utf-8') as f:
        f.write("<?php\nreturn " + "['driver'=>'sqlite','path'=>'" + dbfile.replace('\\', '/') + "'];\n")
    subprocess.run([PHP, '-c', os.path.join(os.path.dirname(PHP), 'php.ini'), os.path.join(HOSTING, 'dev', 'init_sqlite.php'), pv], check=True)
    print('\n  Preview of the hosting (PHP) version:  http://localhost:8020      (Ctrl+C to stop)\n')
    subprocess.run([PHP, '-c', os.path.join(os.path.dirname(PHP), 'php.ini'), '-S', '127.0.0.1:8020', '-t', pv, os.path.join(pv, 'router.php')])


if __name__ == '__main__':
    if '--seed-only' in sys.argv:      # refresh hosting/private/seed.json (used by the GitHub -> cPanel deployment)
        with open(os.path.join(HOSTING, 'private', 'seed.json'), 'w', encoding='utf-8') as f:
            json.dump(export_seed(), f, ensure_ascii=False, indent=1)
        print('hosting/private/seed.json updated from your current local shop.')
        sys.exit(0)
    os.makedirs(DIST, exist_ok=True)
    print('Building the cPanel package ...')
    stage()
    n = make_zip()
    mb = os.path.getsize(ZIP) / 1024 / 1024
    n2 = make_update_zip()
    print(f'\n  DONE\n  FIRST INSTALL ->  {ZIP}   ({n} files, {mb:.2f} MB)\n  UPDATE ONLY   ->  {UPDATE_ZIP}   ({n2} files, {os.path.getsize(UPDATE_ZIP) / 1024 / 1024:.2f} MB)'
          '\n  Already installed?  Upload lofan-update.zip in cPanel > File Manager > public_html and Extract (overwrite).  Your database, customers and orders are kept.\n')
    if PREVIEW:
        preview()
