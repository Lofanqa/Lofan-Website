#!/usr/bin/env python3
"""
LOFAN local test server.      Run:  python server.py        (or double-click Start-Lofan.bat / press Ctrl+Shift+B in VS Code)

It runs the SAME PHP code that runs on lofan.qa, with a local SQLite database (data/dev.sqlite), so whatever you
test here behaves the same after you publish.  Your edits to index.html, css, js, images ... show up on refresh.
The old Python version of the server is kept in the "legacy" folder (no longer used).
"""
import os, shutil, socket, subprocess, sys, threading, time, webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
HOSTING = os.path.join(ROOT, 'hosting')
DATA = os.path.join(ROOT, 'data')
DB = os.path.join(DATA, 'dev.sqlite')
CONFIG = os.path.join(HOSTING, 'private', 'config.php')
PORT = int(os.environ.get('PORT', 8000))


def find_php():
    cands = [os.environ.get('PHP_EXE'), os.path.join(os.path.expanduser('~'), 'lofan-tools', 'php', 'php.exe'), shutil.which('php')]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def port_in_use(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(('127.0.0.1', port)) == 0


def main():
    php = find_php()
    if not php:
        print('\n  PHP was not found on this PC.\n  Install PHP 8.x (windows.php.net/download, "Non Thread Safe" zip), unzip it to  C:\\Users\\<you>\\lofan-tools\\php ,'
              '\n  then run this again.  (Or set the PHP_EXE environment variable to php.exe.)\n')
        sys.exit(1)
    ini = os.path.join(os.path.dirname(php), 'php.ini')
    base = [php] + (['-c', ini] if os.path.isfile(ini) else [])

    if port_in_use(PORT):
        print(f'\n  The Lofan server is ALREADY running on port {PORT}.  Open  http://localhost:{PORT}\n')
        return
    os.makedirs(DATA, exist_ok=True)

    if not os.path.isfile(CONFIG):      # local config (never uploaded: it is in .gitignore and removed from the zip)
        with open(CONFIG, 'w', encoding='utf-8') as f:
            f.write("<?php\nreturn ['driver' => 'sqlite', 'path' => '" + DB.replace('\\', '/') + "', 'root' => '" + ROOT.replace('\\', '/') + "'];\n")
    if not os.path.isfile(DB):          # first run: create the tables and load your shop items
        print('  First run: creating the local test database ...')
        subprocess.run([sys.executable, os.path.join(ROOT, 'build_hosting_package.py'), '--seed-only'], cwd=ROOT)
        r = subprocess.run(base + [os.path.join(HOSTING, 'dev', 'init_sqlite.php'), HOSTING], cwd=ROOT)
        if r.returncode != 0:
            print('  Could not create the database.'); sys.exit(1)

    if '--open' in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(f'http://localhost:{PORT}')).start()
    print(f'\n  LOFAN website (PHP) running ->  http://localhost:{PORT}')
    print(f'  Admin page              ->  http://localhost:{PORT}/admin.html')
    print('  Press Ctrl+C to stop.\n')
    try:
        subprocess.run(base + ['-d', 'display_errors=0', '-S', f'127.0.0.1:{PORT}', '-t', ROOT, os.path.join(HOSTING, 'dev', 'router.php')], cwd=ROOT)
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
