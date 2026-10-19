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
  Admin > Company & Payments: your CR number, address, WhatsApp, the SkipCash keys (test keys first), and the mailbox
  used for the password-reset e-mails.
  Admin > Products & Stock: check prices and stock.   Place a test order as a customer, then confirm it in Admin.
  After the test you can delete the test customer in Admin > Customers.

STEP 7  Share it
  Type  lofan.qa  in Chrome. Send the link to customers / use it as your demo.
  The site is set to "noindex" for admin/payment pages; to keep the whole demo out of Google for now, edit robots.txt
  and change the first line below User-agent to:  Disallow: /


================= PART 2 – EDITING YOUR WEBSITE LATER =================

  Products, prices, stock, categories ....... Admin > Products & Stock   (live immediately, photos are uploaded there)
  Company details, online payments, e-mail .. Admin > Company & Payments
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
  What is kept: customers, orders, chats, products, prices, stock, settings, admin accounts, old payment receipts, the photos
  you uploaded in Admin, your SkipCash keys, mailbox password, WhatsApp / Telegram keys. They live in the MySQL database and in the private folder,
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


================= HOW AN ORDER IS CONFIRMED (online payment) =================

  Customers pay online only: SkipCash or Apple Pay. An order is confirmed by the payment provider, not by a screenshot:
     Awaiting payment  -> the customer sees "Not confirmed - awaiting payment" and can pay again from the payment page.
     Payment confirmed -> the server checks the payment with the provider (SkipCash status check) and then confirms the
                          order. The customer sees "Order confirmed" and you get a notification.
     Then: Preparing > Out for delivery > Delivered.   Cancelled orders put the items back in stock.
  The old bank transfer, Fawran, Ooredoo Money and manual receipt options were removed.
  Rule you can change in Admin > Company & Payments > "Unpaid orders":
     - Unpaid orders are released after N hours (default 24): the order is cancelled, the stock is returned and the customer
       is told "Not paid within N hours". Set 0 to never release.
  Never store the SkipCash keys in a chat, e-mail or GitHub. Enter them only in Admin > Company & Payments.


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


================= CUSTOM ORDER ENQUIRIES (INBOX) =================

  The website form is called "Custom Order". Name, email, mobile number and message are required; company is optional.
  The customer may attach up to 5 reference photos (for example a picture of an item they like).
  Admin > Enquiries is an inbox: the left side lists every enquiry (new ones are marked New); the right side shows the
  whole conversation: the customer's message, their photos (click to open) and every reply you sent.
  To answer: the reply text is already written (Admin > Company & Payments > "Enquiry reply text" – the owner can change
  it; {name} = the customer's first name, {topic} = what they asked about). Edit it if you like, then press:
     - Send on WhatsApp  -> WhatsApp opens with the text filled in; press send in WhatsApp.
     - Send by SMS       -> the phone's messages app opens with the text (works on a phone).
     - Save as internal note -> a note only the team sees (not sent to the customer).
  Each reply is saved in the conversation and the enquiry is marked "Replied". Delete an enquiry = its photos and
  conversation are removed for good.

================= ONLINE PAYMENTS: SKIPCASH (AND APPLE PAY) =================

  SkipCash: the customer chooses SkipCash on the payment page and is taken to SkipCash's own secure payment page. They
  pay there by card or SkipCash wallet. Card details never reach lofan.qa. When SkipCash reports the payment, the order is
  confirmed automatically (the server asks SkipCash for the status itself before confirming).

  Setup (you do this, it needs your own SkipCash merchant account; the keys come from the SkipCash merchant portal):
     1. Admin > Company & Payments > "Online payments for customers" > SkipCash.
     2. Paste the Key ID, Key Secret, Client ID and Webhook Key. Start with the TEST keys and leave "Test mode" ticked.
     3. Give SkipCash this webhook address (it is also shown on the page):
            https://lofan.qa/api/skipcash/notify
     4. Tick "Offer SkipCash at checkout" and press Save. (It cannot be switched on until the keys are saved.)
     5. Place a test order and pay it in SkipCash test mode. Then switch to the live keys, untick "Test mode", and save.
  Keys are never shown again on the page: a saved key shows "saved – leave blank to keep".

  Apple Pay: a separate setup with Apple and your payment provider. See README.txt, section "APPLE PAY SETUP". It appears
  on the payment page only after it is switched on in Admin.

================= PASSWORD RESET BY E-MAIL CODE (ADMINS AND STAFF) =================

  On the admin sign-in page press "Forgot password?", enter your login e-mail, and a 6-digit code is sent to it. Enter the
  code and a new password (8+ characters, letters and numbers). The code is valid for 10 minutes and can be used once.
  Signed-in staff can do the same from Admin > Security > "Forgot your password?".
  Customers get the same code on the website: "Forgot password?" in the sign-in pop-up > enter the code > new password.
  The codes are sent through the mailbox you set in Admin > Company & Payments > "E-mail sending":
     - Mail server (for example mail.lofan.qa), port 465 with SSL (or 587 with TLS), the mailbox user (info@lofan.qa),
       its password and the "From" address. Press "Send a test e-mail to me" to check it.
     - Create the mailbox in cPanel > Email Accounts first. The password is kept on the server and is never shown again.
  If a code does not arrive, check the spam folder, then the settings above; the page shows the reason when sending fails.
  The admin's login e-mail and each customer's e-mail must be a real mailbox you can read.

================= WHO SEES WHAT (OWNER AND STAFF) =================

  Owner: everything – Company & Payments (SkipCash, Apple Pay, e-mail, reply text, alerts), Security (who is signed in, admin accounts,
  activity log, reset of test data), approvals, and all orders, products, chat and enquiries.
  Staff: Orders, Products & Stock (stock and "show in shop" directly; prices and details need the owner's approval),
  Notifications, Chat, Enquiries and Customers. Security shows only THEIR OWN page: sign out of this device, sign out
  other devices, change their password and reset it by e-mail code. Company & Payments is hidden.
  Approvals: when staff ask for something (delete an order, change an item, add a new item), the owner sees it in
  Notifications > Approvals with who asked. The owner's answer is sent only to the person who asked. Once decided,
  every admin can see the approval in the list, with the name of who asked and who decided. An approved order deletion
  can be carried out only by the staff member who asked, within 24 hours.

================= PHONE VIEW =================

  All pages (shop, cart, payment, My Account, admin) adapt automatically to phones and tablets: bigger touch buttons,
  two-column shop grid, pop-ups that slide up from the bottom, a vertical order-tracking timeline, and admin tables that
  turn into cards. Nothing to set up. Test it: in Chrome press F12 > the phone icon, or just open lofan.qa on your phone.


================= PART 3 – EASY EDITING: VS Code -> GitHub -> cPanel (recommended) =================

  STEP BY STEP – what you do (about 20 minutes, once). Never send your passwords in chat or e-mail; type them only in the
  sign-in windows that GitHub, Windows or cPanel open.
   1. GitHub account: go to github.com and sign up (or sign in) with the e-mail you use for the business. Turn on 2-step
      verification in Settings.
   2. New empty repository: github.com > "+" > New repository > name  lofan  > Private (recommended) > do NOT tick
      "Add a README" or ".gitignore" > Create repository. Copy its address, it looks like  https://github.com/YOUR-NAME/lofan.git
   3. Connect your folder: in VS Code open the Terminal (Ctrl+`) and type these, one line at a time:
          git remote add origin https://github.com/YOUR-NAME/lofan.git
          git push -u origin main
      A GitHub sign-in window opens: sign in and press "Authorize". Windows remembers it afterwards.
   4. cPanel: Git Version Control > Create. Clone URL: the same https://github.com/YOUR-NAME/lofan.git ; repository path:
      lofan > Create. (For a Private repository cPanel needs a deploy key – see "Private repository" below.)
   5. In cPanel open the repository > Manage > "Update from Remote" > "Deploy HEAD Commit". The website files are copied
      into public_html (the database and customer data are never touched). Then open https://lofan.qa and press Ctrl+F5.
   6. From now on: edit files in VS Code > double-click Publish-To-GitHub.bat and type a short note > then in cPanel
      press "Update from Remote" and "Deploy HEAD Commit" again. Your changes are live.
   Tip: if the deploy shows an error, do not edit anything on the server – open the cPanel error text and send it to us.

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
  folders  public_html/private/enquiry-images  (enquiry photos), public_html/private/receipts  (old receipts) and
  public_html/images/products .

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
