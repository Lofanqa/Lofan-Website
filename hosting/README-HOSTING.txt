LOFAN – PUBLISHING THE WEBSITE ON cPANEL  (lofan.qa)
====================================================

What you are uploading
  lofan-cpanel.zip contains the website pages (the same ones you see on your PC) and a PHP + MySQL server
  that does exactly what your local Python server does: accounts, cart, orders, payments, chat, locations, admin.
  Nothing else needs to be installed on the hosting.

Server requirements (all normal on cPanel)
  PHP 7.4 or newer (8.1 - 8.3 recommended)   MySQL 5.7+ / MariaDB 10.3+   Apache or LiteSpeed with .htaccess
  PHP extensions: pdo_mysql, json, curl, mbstring (fileinfo recommended)     A free SSL certificate (AutoSSL)


================= PART 1 – ONE-TIME SETUP IN cPANEL =================

STEP 0  Make sure lofan.qa points to this hosting
  The domain must be added to this cPanel account (Domains / Addon Domains) and its DNS must point to the hosting
  (either nameservers set to your host's, or an A record to the IP shown on the right side of the cPanel home page).
  .qa domains are managed at your registrar; DNS changes can take a few hours. SSL cannot be issued until this works.

STEP 1  PHP version
  cPanel > "MultiPHP Manager" (or "Select PHP Version") > pick lofan.qa > choose PHP 8.1, 8.2 or 8.3.
  In "Select PHP Version > Extensions" tick:  pdo_mysql (or nd_mysqli+pdo_mysql), curl, mbstring, json, fileinfo, opcache.

STEP 2  Create the database  (cPanel > "MySQL Database Wizard")
  1) Create database:   e.g.  shop      -> real name becomes  lofanqa_shop
  2) Create user + password:  e.g. shopuser -> lofanqa_shopuser   (use "Password Generator", copy it somewhere safe)
  3) Add user to database: tick ALL PRIVILEGES.
  Write down: database name, user name, password.

STEP 3  Upload the website
  cPanel > "File Manager" > open  public_html  (for lofan.qa this is the website's main folder)
  > Upload > choose lofan-cpanel.zip > when finished, right-click the zip > Extract (extract into public_html itself,
  so that index.html sits directly in public_html) > then delete the zip.
  Tip: in File Manager > Settings tick "Show Hidden Files (dotfiles)" - you should see .htaccess.

STEP 4  Run the installer (one time)
  Open  http://lofan.qa/install.php   (use https:// once SSL is on)
  - Check the list is all green. - Enter the database name, user and password from step 2.
  - Press Install. It creates the tables, loads your shop items and settings, and deletes install.php.
  - The "Self-test" box must show green ticks. If a line is red, see TROUBLESHOOTING below.

STEP 5  Turn on SSL (https)
  cPanel > "SSL/TLS Status" > tick lofan.qa and www.lofan.qa > "Run AutoSSL". Wait 2-10 minutes and refresh.
  When https://lofan.qa opens with a padlock, force https for all visitors:
     File Manager > public_html/private > New File named   force_https.flag   (content can be empty).
  (If you ticked "Always redirect to https" in the installer this file already exists.)
  Check:  http://lofan.qa  should jump to  https://lofan.qa     and     https://www.lofan.qa  should also open.

STEP 6  Create the admin account and company details
  Open  https://lofan.qa/admin.html  -> "Create the admin account" (choose a strong password, 10+ characters).
  Admin > Company & Payments: your CR number, address, WhatsApp, your REAL bank / IBAN, Fawran and Ooredoo Money.
  Admin > Products & Stock: check prices and stock.   Place a test order as a customer, then confirm it in Admin.
  After the test you can delete the test customer in Admin > Customers.

STEP 7  Share it
  Type  lofan.qa  in Chrome. Send the link to customers / use it as your demo.
  The site is set to "noindex" for admin/payment pages; to keep the whole demo out of Google for now, edit robots.txt
  and change the first line below User-agent to:  Disallow: /


================= PART 2 – EDITING YOUR WEBSITE LATER =================

  Products, prices, stock, categories ....... Admin > Products & Stock   (live immediately, photos are uploaded there)
  Company details, bank / payment methods ... Admin > Company & Payments
  Texts on the pages ......................... edit index.html (headings, about text, contact) in File Manager > Edit
                                               or edit the file on your PC and upload it again (overwrite)
  Images ..................................... upload a new file over the old one in  images/  (same file name).
                                               Visitors may see the old picture for up to 7 days because browsers keep a copy;
                                               to force an update, use a NEW file name and change it in index.html.
  Video ...................................... replace  videos/lofan.mp4  (keep it small: under 2-3 MB loads fast)
  Colours / fonts ............................ css/style.css

  Best workflow: edit on your PC (VS Code) -> run  Build-Hosting-Zip.bat  (or: python build_hosting_package.py)
  -> upload dist/lofan-cpanel.zip -> Extract and choose "overwrite".  This NEVER touches your database, your uploaded
  product photos in images/products, or private/ (customers, orders, receipts) because those are not in the zip
  except the default product photos. If you added photos in Admin, they stay on the server.
  IMPORTANT: do NOT delete the folder  private  on the server and do NOT re-run install.php.


================= TROUBLESHOOTING =================

  "Self-test: the API did not answer" / shop empty / admin page says cannot reach server
     -> .htaccess missing or mod_rewrite off. Show hidden files; .htaccess must be in public_html. Ask the host to enable
        mod_rewrite (it is on by default). Check that the folder  api  and file  api/index.php exist.
  White page or "Server error"
     -> open public_html/private/error.log in File Manager: the last lines say what failed (database password, PHP version...).
  "The website is not installed yet"
     -> private/config.php is missing: run install.php again (only possible if you did not delete private/installed.lock - delete
        that lock file first if you really want to re-run the installer).
  "Could not connect to MySQL"
     -> The database name and user must include the prefix (lofanqa_...). The user must be added to the database (ALL PRIVILEGES).
  Login works on http but not on https (or the other way round)
     -> clear cookies for the site once; always use https:// after SSL is on.
  Pictures or video do not show
     -> upload the images/ and videos/ folders again; file names are case-sensitive on Linux (Logo.jpg is not logo.jpg).
  Shows "Index of /" or 403
     -> index.html must be directly inside public_html (not in a sub-folder).
  Product photo upload fails in Admin
     -> folder images/products must be writable (permission 755). In File Manager > right-click > Change Permissions.
  Google sign-in / Apple Pay
     -> see README.txt (Google Client ID and Apple Pay setup). Add https://lofan.qa as an authorised JavaScript origin in Google.
  Customer location "share" does nothing
     -> it needs https:// (padlock). Run AutoSSL (step 5).

BACKUPS  (do this weekly)
  cPanel > "Backup" > download a Full Backup, or at least:  phpMyAdmin > your database > Export (SQL)  AND download the
  folders  public_html/private/receipts  and  public_html/images/products .

SECURITY CHECKLIST
  [ ] change the cPanel password (it was shared in a chat) and use a strong, unique one
  [ ] strong admin password for the website;  never share it
  [ ] install.php deleted;  README-HOSTING.txt deleted from the server
  [ ] https padlock shown and force_https.flag present
  [ ] the folder "private" shows "Forbidden" when you open https://lofan.qa/private/ (it must)


PERFORMANCE NOTES
  - Pages are static HTML + small JS/CSS; only product/cart/order data is loaded from PHP + MySQL, so a normal shared plan
    handles a small shop comfortably. .htaccess already turns on compression and browser caching.
  - Use PHP 8.1+ with OPcache enabled (default on most cPanel hosts).
  - Keep photos about 1200 px wide (JPG, 100-250 KB). Photos uploaded through Admin are resized automatically.
  - If traffic grows, put the domain behind Cloudflare (free) for faster loading worldwide.
