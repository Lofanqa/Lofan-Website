<?php
/* =====================================================================
   LOFAN – one-time installer for cPanel hosting.
   Open  https://lofan.qa/install.php  once, enter the MySQL details, press Install.
   It creates the tables, loads the shop items, saves the settings and then deletes itself.
   ===================================================================== */
define('LOFAN', 1);
require __DIR__ . '/private/lib.php';

$cfgFile = __DIR__ . '/private/config.php';
$lockFile = __DIR__ . '/private/installed.lock';
$locked = is_file($lockFile) && is_file($cfgFile);
$errors = [];
$done = false;
$selfDeleted = false;
$v = ['host' => 'localhost', 'name' => '', 'user' => '', 'force' => is_https()];

function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function writable_dir($d) { if (!is_dir($d)) @mkdir($d, 0755, true); return is_dir($d) && is_writable($d); }

$checks = [
    ['PHP 7.4 or newer (this server: ' . PHP_VERSION . ')', version_compare(PHP_VERSION, '7.4.0', '>='), true],
    ['MySQL driver (pdo_mysql)', extension_loaded('pdo_mysql'), true],
    ['JSON support', function_exists('json_encode'), true],
    ['cURL (needed for Google sign-in / Apple Pay – optional for the demo)', function_exists('curl_init'), false],
    ['mbstring (Arabic names) – recommended', function_exists('mb_substr'), false],
    ['Folder "private" is writable', writable_dir(__DIR__ . '/private'), true],
    ['Folder "images/products" is writable (for new product photos)', writable_dir(__DIR__ . '/images/products'), true],
];
$blocking = false;
foreach ($checks as $c) if ($c[2] && !$c[1]) $blocking = true;

if (!$locked && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $v['host'] = trim($_POST['host'] ?? 'localhost');
    $v['name'] = trim($_POST['name'] ?? '');
    $v['user'] = trim($_POST['user'] ?? '');
    $pass = (string)($_POST['pass'] ?? '');
    $v['force'] = !empty($_POST['force']);
    if ($blocking) $errors[] = 'Please fix the red items in the checklist first.';
    if (!preg_match('/^(localhost|127\.0\.0\.1|\[?::1\]?)$/', $v['host'])) $errors[] = 'For safety the database host must be "localhost" (that is what cPanel uses).';
    if ($v['name'] === '' || $v['user'] === '') $errors[] = 'Enter the database name and user.';
    if (!$errors) {
        try {
            $pdo = new PDO('mysql:host=' . $v['host'] . ';dbname=' . $v['name'] . ';charset=utf8mb4', $v['user'], $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $pdo->query('SELECT 1');
        } catch (Throwable $e) {
            $errors[] = 'Could not connect to MySQL: ' . $e->getMessage() . ' — check the database name, user and password (in cPanel they all start with your account prefix, e.g. lofanqa_shop) and that the user was added to the database with ALL PRIVILEGES.';
        }
    }
    if (!$errors) {
        try {
            $cfgText = "<?php\nreturn " . var_export(['driver' => 'mysql', 'host' => $v['host'], 'name' => $v['name'], 'user' => $v['user'], 'pass' => $pass], true) . ";\n";
            if (file_put_contents($cfgFile, $cfgText) === false) throw new Exception('Could not write private/config.php');
            @chmod($cfgFile, 0640);
            install_schema();
            $seed = is_file(__DIR__ . '/private/seed.json') ? (json_decode(file_get_contents(__DIR__ . '/private/seed.json'), true) ?: []) : [];
            seed_db($seed);
            foreach (['receipts', 'applepay', 'throttle'] as $d) writable_dir(__DIR__ . '/private/' . $d);
            if ($v['force']) @file_put_contents(__DIR__ . '/private/force_https.flag', "on\n");
            file_put_contents($lockFile, date('c') . "\n");
            $done = true;
            $selfDeleted = @unlink(__FILE__);
        } catch (Throwable $e) {
            @unlink($cfgFile);
            $errors[] = 'Installation failed: ' . $e->getMessage();
        }
    }
}
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Install Lofan website</title>
<style>
body{margin:0;background:#f4efe7;color:#3f3a2a;font:16px/1.6 Georgia,'Times New Roman',serif}
.wrap{max-width:720px;margin:40px auto;padding:0 20px}
h1{font-weight:400;font-size:40px;margin:0 0 4px}h1 em{color:#737a58}
.card{background:#fbf8f2;border:1px solid #e2dccb;padding:26px 28px;margin:20px 0}
label{display:block;font:12px/1.4 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8a8672;margin:16px 0 4px}
input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #b9b49c;background:#fff;font:16px Arial,sans-serif}
button{background:#737a58;color:#fff;border:0;padding:15px 34px;font:13px Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;margin-top:22px}
button:hover{background:#4b5030}
.ok{color:#3d6b2a}.bad{color:#b04a3a}.warn{color:#8a5a14}
ul{list-style:none;padding:0;margin:0}li{padding:4px 0;font:15px Arial,sans-serif}
.err{background:#f6e4e0;border-left:3px solid #b04a3a;padding:12px 16px;margin:14px 0;font:15px Arial,sans-serif}
.good{background:#e3ecd4;border-left:3px solid #5a8a3c;padding:14px 18px;margin:14px 0;font:15px Arial,sans-serif}
small{font:13px Arial,sans-serif;color:#8a8672}
a{color:#4b5030}code{background:#ebe4d7;padding:1px 6px}
</style></head><body><div class="wrap">
<h1>Lofan <em>installer</em></h1>
<p style="margin-top:0;color:#8a8672">Sets up the database for your website. Takes about a minute.</p>

<?php if ($locked): ?>
  <div class="good"><strong>Already installed.</strong> This website is set up. For safety please delete <code>install.php</code> from the server (cPanel &rarr; File Manager).</div>
  <p><a href="index.html">Open the website</a> &nbsp;·&nbsp; <a href="admin.html">Open the admin page</a></p>

<?php elseif ($done): ?>
  <div class="good"><strong>Installed successfully.</strong> The database tables and your shop items are ready.</div>
  <div class="card">
    <p style="margin-top:0"><strong>Self-test</strong> <small>(checks that the website can talk to its server)</small></p>
    <ul id="tests"><li>Running…</li></ul>
  </div>
  <div class="card">
    <strong>Next steps</strong>
    <ol style="font:15px/1.7 Arial,sans-serif">
      <li>Open <a href="admin.html"><b>admin.html</b></a> and create your <b>admin account</b> (the first visit shows "Create the admin account").</li>
      <li>Admin &rarr; Company &amp; Payments: enter your real bank / IBAN, Fawran and Ooredoo Money details.</li>
      <li>Open the <a href="index.html">website</a> and place a test order as a customer.</li>
      <?php if (!$selfDeleted): ?><li class="bad"><b>Delete <code>install.php</code></b> from the server now (cPanel &rarr; File Manager) – the installer could not delete itself.</li><?php else: ?><li class="ok">The installer deleted itself for safety.</li><?php endif; ?>
    </ol>
  </div>
<script>
(async function(){
  const ul=document.getElementById('tests'); ul.innerHTML='';
  const add=(ok,t)=>{const li=document.createElement('li');li.className=ok?'ok':'bad';li.textContent=(ok?'✔ ':'✘ ')+t;ul.appendChild(li);};
  try{ const r=await fetch('api/products'); const d=await r.json(); add(r.ok&&d.products,'Shop data loads from the database ('+(d.products?d.products.length:0)+' items)'); }
  catch(e){ add(false,'The API did not answer. Check that .htaccess was uploaded and mod_rewrite is on (see README-HOSTING.txt).'); }
  try{ const r=await fetch('api/config'); add(r.ok,'Configuration endpoint'); }catch(e){ add(false,'Configuration endpoint'); }
  add(location.protocol==='https:', location.protocol==='https:' ? 'Secure connection (https) is active' : 'You are on http – turn on SSL in cPanel (SSL/TLS Status → Run AutoSSL)');
})();
</script>

<?php else: ?>
  <div class="card">
    <strong>1. Server check</strong>
    <ul style="margin-top:8px">
      <?php foreach ($checks as $c): ?>
        <li class="<?= $c[1] ? 'ok' : ($c[2] ? 'bad' : 'warn') ?>"><?= $c[1] ? '✔' : ($c[2] ? '✘' : '⚠') ?> <?= h($c[0]) ?></li>
      <?php endforeach; ?>
    </ul>
    <?php if ($blocking): ?><div class="err">Fix the red items first (cPanel &rarr; Select PHP Version / MultiPHP Manager, and file permissions), then reload this page.</div><?php endif; ?>
  </div>
  <form method="post" class="card">
    <strong>2. Database</strong><br><small>Create these in cPanel &rarr; <b>MySQL® Database Wizard</b> first (step 1 database, step 2 user + password, step 3 ALL PRIVILEGES).</small>
    <?php foreach ($errors as $e): ?><div class="err"><?= h($e) ?></div><?php endforeach; ?>
    <label>Database host</label><input type="text" name="host" value="<?= h($v['host']) ?>">
    <label>Database name</label><input type="text" name="name" value="<?= h($v['name']) ?>" placeholder="e.g. lofanqa_shop" autocomplete="off">
    <label>Database user</label><input type="text" name="user" value="<?= h($v['user']) ?>" placeholder="e.g. lofanqa_shopuser" autocomplete="off">
    <label>Database password</label><input type="password" name="pass" autocomplete="new-password">
    <label style="display:flex;gap:10px;align-items:center;text-transform:none;letter-spacing:0;font-size:15px;color:#3f3a2a;margin-top:20px">
      <input type="checkbox" name="force" value="1" <?= $v['force'] ? 'checked' : '' ?>> Always redirect visitors to https:// (tick this only when SSL is already working)</label>
    <button type="submit" <?= $blocking ? 'disabled' : '' ?>>Install</button>
  </form>
<?php endif; ?>
</div></body></html>
