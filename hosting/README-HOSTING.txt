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
  -> upload dist/lofan-update.zip -> Extract and choose "overwrite".  (see "UPDATING THE LIVE SITE" just below.)
  IMPORTANT: do NOT delete the folder  private  on the server and do NOT re-run install.php.


================= UPDATING THE LIVE SITE (the database already exists) =================

  The build makes TWO zips in the dist folder:
     lofan-cpanel.zip  = FIRST install only (it contains the installer).
     lofan-update.zip  = every later update. It has NO installer, NO database, NO private/config.php and NO secrets.
  Steps (about 2 minutes):
     1. On your PC: double-click Build-Hosting-Zip.bat  -> wait for "DONE".
     2. cPanel > File Manager > public_html > Upload > dist/lofan-update.zip.
     3. Right-click the zip > Extract (into public_html) > if asked, overwrite existing files > then delete the zip.
     4. Open the website once and press Ctrl+F5.  Done.
  What is kept: customers, orders, chats, products, prices, stock, settings, admin accounts, payment receipts, the photos
  you uploaded in Admin, your bank details, WhatsApp / Telegram keys. They live in the MySQL database and in the private folder,
  and the update zip never contains them.
  New database fields are added automatically the first time the new version runs (no data is lost, nothing to click).
  Your product photos from Admin are in images/products; the update zip only adds the default photos, so yours stay.
  Rolling back: re-upload the previous update zip (keep one copy of each version on your PC).
  Tip: take a backup before a big update (cPanel > Backup, or phpMyAdmin > Export).
  Alternative with GitHub: Part 3 below (Publish-To-GitHub.bat, then "Deploy HEAD Commit" in cPanel).


================= RESET THE TEST DATA (before you start selling) =================

  You made test customers and test orders in the live database. To clear them:
     Admin > Security > scroll down to "Reset test data"
     tick what to delete (Orders + receipts, Customers, Chat messages, Enquiries, Notifications, the activity log),
     tick "Put the items of deleted orders back into stock", type  RESET  and press "Delete the selected data".
  It NEVER deletes your products, prices, categories, company / bank / alert settings or admin accounts.
  Only an Owner admin can do this. It is written to the activity log (unless you tick "this activity log" as well).
  To remove only ONE test customer: Admin > Customers > Delete customer (choose whether to delete their orders too).
  Do this once, right before you announce the website. Never do it later by mistake: real orders would be deleted too.


================= HOW AN ORDER IS CONFIRMED (payment authentication) =================

  An order is only CONFIRMED after the payment is verified:
     Awaiting payment  -> the customer sees "Not confirmed - awaiting payment" and a Complete Payment button.
     Payment submitted -> the customer sent the transaction number and a receipt (screenshot). You get a pop-up, an
                          WhatsApp / Telegram alert and the order shows in Orders with the receipt.
     Payment confirmed -> YOU press "Confirm payment" after checking your bank / Fawran / Ooredoo statement. Only now the
                          customer sees "Order confirmed".  (Apple Pay / card payments confirm by themselves.)
     Then: Preparing > Out for delivery > Delivered.   Cancelled orders put the items back in stock.
  Rules you can change in Admin > Company & Payments > "Order rules":
     - Customers must upload a payment receipt (default ON).
     - Unpaid orders are released after N hours (default 24): the order is cancelled, the stock is returned and the customer
       is told "Not paid within N hours". Set 0 to never release.

  Which Qatar bank / payment method is free?  Bank transfer to your IBAN, Fawran (instant bank transfer) and Ooredoo Money
  cost the customer and you nothing extra from this website; you confirm each payment yourself (steps above).
  Fully automatic CARD payment (customer pays on a card page, order confirms by itself) needs a payment gateway / merchant
  account from a Qatar bank or a provider - that always has fees and a sign-up with documents. Ask your bank which gateway
  they offer for online shops in Qatar; once you pick one, the website can be connected to it (a small change in
  psp_charge() in hosting/private/lib.php). Keep the gateway's secret keys private: enter them only in Admin or on the server,
  never in a chat, e-mail or GitHub.  Fees and approval rules differ per bank - confirm them with the bank before you decide.


================= ADMIN ACCOUNTS, SIGN-INS AND ACTIVITY LOG =================

  Admin > Security (Owner):
     - Admin accounts: up to 10. Level OWNER = everything. Level STAFF = orders, chat, products, enquiries, customers,
       but NOT payment settings, alert settings, admin accounts, the activity log, resetting data or erasing customers.
       Add / disable / delete an admin, change the level, reset a password. You cannot delete, disable or demote yourself,
       and at least one active Owner must always exist.
     - Who is signed in: every admin sign-in (device, IP address, time, last active) with "Sign out" for each one and
       "Sign out all other devices". Staff sign-ins expire after 7 days. Changing a password signs out the other devices.
     - Access & activity log: every sign-in, failed / blocked sign-in and important change (order status, products,
       settings, deletions, resets, WhatsApp alerts sent...) with admin name, time, IP and device. Search, filter by admin, Export CSV.
  Admin sign-ins end when the browser is closed and after 12 hours; customers stay signed in for 30 days (Log out button
  in the top bar). New passwords (customers and admins) need 8+ characters with letters AND numbers.
  Deleting an order: the owner deletes directly; staff press "Request deletion", the owner approves in Admin > Orders, and
  then the staff member can delete that one order (approval valid 24 hours). All steps appear in the activity log.
  Admin passwords are stored encrypted (bcrypt). After 10 wrong attempts within 10 minutes the sign-in pauses for a few
  minutes (and the attempt is logged).
  Give each person their own account (for example chairman = Owner, two staff). Never share one password.


================= ORDER ALERTS ON YOUR WHATSAPP =================

  (SMS / Twilio alerts were removed. Alerts now go to your WhatsApp.)
  Admin > Company & Payments > "Order alerts to your phone".  Every alert contains: order number, date and time,
  each item with its price, delivery fee, total, the customer's name, phone and address, and a Google Maps link when the
  customer shared their location.  Example:
        NEW ORDER - waiting for payment
        Order: LF-AB12CD     Time: 10 Oct 2026, 11:40
        Items:  • 2 x Olive Leaf Napkin - 90 QAR (45 each)   • 1 x Embroidered Charger Mat - 95 QAR
        Delivery: 10 QAR     Total: 195 QAR
        Customer: Sara Ali, +97455551234, Address: Zone 61, Street 12, West Bay, Doha
  Choose WHEN to send:  order placed (not paid yet) / payment submitted / order confirmed (all three are on by default).

  How it works with a PERSONAL WhatsApp: the free service CallMeBot (https://www.callmebot.com) sends a WhatsApp message
  to your own number. One-time activation, from the WhatsApp that should receive the alerts:
     1. Save the number +34 644 91 07 79 in your phone contacts (check callmebot.com if it has changed).
     2. In WhatsApp send that contact exactly:   I allow callmebot to send me messages
     3. It replies with your API key (within ~2 minutes; if not, try again after 24 hours).
     4. Admin > Company & Payments: paste the API key, leave the number empty to use your company WhatsApp number (or type
        another), tick "Send WhatsApp alerts", press Save, then press "Send test WhatsApp".
  Good to know:
     - CallMeBot is free, unofficial and "for personal use": no guarantee, and the order details (customer name, address,
       items) pass through its servers. If you need a guaranteed service, use a paid WhatsApp gateway: choose
       "Another WhatsApp service (web address)" - the website then sends {to, message} as JSON to that https address.
     - The alerts go to ONE WhatsApp number (the one that activated CallMeBot). To alert several people, use a WhatsApp group
       with a paid gateway, or add Telegram (below).
  Telegram is also free and optional: in Telegram open @BotFather > /newbot > copy the token; open your new bot and press
  Start; find your chat id with @userinfobot; paste token + chat id in Admin, tick "Send Telegram alerts", Save, "Send test".
  The API key / tokens are stored on the server only, never shown again and never put into the zip or GitHub.
  Alerts are sent after the customer already got their answer, so a failing alert service never blocks an order.
  Every alert (sent or failed, with the reason) appears in the activity log.


================= PHONE VIEW =================

  All pages (shop, cart, payment, My Account, admin) adapt automatically to phones and tablets: bigger touch buttons,
  two-column shop grid, pop-ups that slide up from the bottom, a vertical order-tracking timeline, and admin tables that
  turn into cards. Nothing to set up. Test it: in Chrome press F12 > the phone icon, or just open lofan.qa on your phone.


================= PART 3 – EASY EDITING: VS Code -> GitHub -> cPanel (recommended) =================

  After the first publish (Part 1) you never need to make a zip again.
  Daily routine:
     1. Edit files in VS Code (text, images in images/, video in videos/, colours in css/, ...).
     2. Double-click  Publish-To-GitHub.bat  (type a short note).     [or VS Code: Source Control > Commit > Sync]
     3. cPanel > Git Version Control > Manage (next to "lofan") > "Update from Remote" > "Deploy HEAD Commit".
  Your edits are live on lofan.qa within seconds. Products/prices/stock are still edited in Admin (no Git needed).

  ONE-TIME SETUP
  A) GitHub (you do this yourself - GitHub needs you to sign in):
       1. github.com > sign in / create the account with your email.  Turn on 2-step verification (Settings > Password and authentication).
       2. New repository: name  lofan   > choose Public (simplest) or Private > do NOT add README / .gitignore > Create.
       3. In VS Code open the Terminal (Ctrl+`) and run (replace YOUR-USERNAME):
              git remote add origin https://github.com/YOUR-USERNAME/lofan.git
              git push -u origin main
          A browser window opens: sign in to GitHub and press "Authorize". (Windows stores the sign-in safely; you will not
          type a password into VS Code.)
  B) cPanel (after the first push):
       1. cPanel > "Git Version Control" > Create.
       2. Clone URL:  https://github.com/YOUR-USERNAME/lofan.git   (Public repository: nothing else needed)
          Repository path: lofan      > Create.
       3. Manage > "Deploy HEAD Commit". (The file .cpanel.yml in the project tells cPanel what to copy into public_html.)
       4. Open  https://lofan.qa/install.php  and finish the installer (Part 1, step 4) if you have not installed yet.
     Private repository instead of public:  cPanel > "SSH Access" > Manage SSH Keys > Generate a New Key (no passphrase) >
       View/Download the PUBLIC key > GitHub repo > Settings > Deploy keys > Add deploy key (read-only is enough).
       Then use the clone URL  git@github.com:YOUR-USERNAME/lofan.git  and "Authorize" the key in cPanel.
  Notes
     - "Deploy HEAD Commit" only works when the server copy of the repository has no uncommitted changes: do not edit website
       files directly on the server any more - always edit on your PC, then Publish.
     - If the domain is not the main domain of this cPanel account, change the folder name /home/lofanqa/public_html in
       .cpanel.yml to that domain's folder.
     - After you change the shop in Admin and want those items in the repository too, run  python build_hosting_package.py --seed-only
       (only matters for a brand-new install; the live shop keeps its own database).


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
  WhatsApp alert does not arrive
     -> Admin > Security > Access & activity log: the line "WhatsApp alert" says why it failed (wrong API key, number not
        activated). Press "Send test WhatsApp" in Company & Payments to see the service's answer. The number must be the same
        WhatsApp that sent "I allow callmebot to send me messages". If the key never arrived, repeat the activation after 24 h.
        Telegram alerts are a free way to confirm the alert system itself works.
  After an update the page looks old
     -> press Ctrl+F5 (phone: close the tab and open it again). CSS / JS are cached by the browser for a short time.
  "Reset test data" button is grey
     -> type  RESET  (capital letters) in the box first.

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
