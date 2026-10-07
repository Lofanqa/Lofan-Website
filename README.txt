LOFAN WEBSITE – QUICK GUIDE
===========================

START IT (VS Code)
  1. File > Open Folder > Desktop\Lofan-Website
  2. The server starts by itself when the folder opens (click "Allow" the first time VS Code asks
     about automatic tasks) and opens http://localhost:8000 in your browser.
     If it did not start: press Ctrl+Shift+B, or double-click Start-Lofan.bat,
     or open Terminal (Ctrl+`) and type:   python server.py
  3. Always use  http://localhost:8000  (Start-Lofan.bat = the same thing, one double-click).
  Stop with Ctrl+C in the terminal / close the black window.
  Live Server (Go Live, port 5500) cannot run the shop or accounts by itself, but if you open it
  while the server is running, the page now jumps to http://localhost:8000 automatically.
  The red "server is not running" banner only appears when the Python server is switched off.

PAGES
  index.html    Home, shop, cart, enquiry form
  payment.html  Delivery details -> choose IBAN / Fawran / Ooredoo Money -> confirm payment
  account.html  Customer profile + order tracking
  admin.html    Your dashboard

FIRST TIME: CREATE THE ADMIN ACCOUNT
  Open http://localhost:8000/admin.html -> the first visit shows "Create the admin account".
  Enter your name, email and a password (min. 8 characters). That is your admin login.
  Customers can never become admins. Only one admin can be created this way.

THEN: ADD COMPANY & BANK DETAILS  (Admin -> Company & Payments)
  - Company name, CR number, address, phone, email
  - Bank transfer: bank name, account holder, account number, Qatar IBAN (29 characters,
    starts with QA – checked automatically), SWIFT/BIC
  - Fawran alias (Qatar mobile number or IBAN)
  - Ooredoo Money number
  - Delivery fee and free-delivery limit
  Click Save. Customers see these details immediately on the payment page.
  A method only shows to customers when its details are filled in.

HOW A CUSTOMER ORDERS
  1. Adds items to the cart and clicks Checkout.
  2. If not signed in, a pop-up makes them create an account (name, mobile, email, password).
  3. payment.html: delivery details -> order is created (stock reserved) -> they pick
     IBAN / Fawran / Ooredoo Money, see your details and a payment reference (e.g. LF-AB12CD),
     pay from their bank app, then enter the transaction number (receipt optional).
  4. They track the order in My Account > My Orders (updates every 15 seconds).

HOW YOU GET NOTIFIED (keep admin.html open in a tab)
  - Pop-up + sound when a customer places an order, when they submit a payment, and when
    someone sends an enquiry. Red badges on the tabs, and the browser tab title shows (n).
  - Allow browser notifications when asked, to also get alerts when the tab is in the background.

AFTER A PAYMENT IS SUBMITTED
  Admin > Orders: check your bank / Fawran / Ooredoo Money statement for the reference and
  amount, then click "Confirm payment". Later set: Preparing > Out for delivery > Delivered.
  Add an optional note – the customer sees it in their order history.
  Cancelling an order puts the stock back automatically.

ADD / UPDATE STOCK  (Admin > Products & Stock)
  - "Add a new item": name, category, price, stock, photo -> Add item (live immediately).
  - Change price / stock directly in the table; stock 0 shows "Sold out".
  - Untick "Visible" to hide an item. Stock drops automatically when orders are placed.

CHATTING WITH CUSTOMERS (website chat + WhatsApp)
  Customers: a "Chat with us" button sits bottom-right on every page (they must be signed in).
  They can also tap "Message us about this order" inside My Account, or use the WhatsApp
  button in the Contact section.
  You (admin): new messages pop up with a sound, and the "Chat" tab shows a red badge.
  Open Admin > Chat, pick the customer on the left and reply - they see it instantly in
  their chat window. Every order card and customer card has "Chat on website" and
  "WhatsApp" buttons; WhatsApp opens a chat with that customer's number, pre-filled.
  Customers only ever see their own conversation. You can start a chat with any customer.
  (Set your WhatsApp number in Admin > Company & Payments.)

APPLE PAY SETUP  (what you need before customers can pay with Apple Pay)
  Apple Pay cannot be switched on from code alone - Apple and a payment provider must approve your shop.
  1. Business side: a company bank account in Qatar and a payment provider ("acquirer") that supports
     Apple Pay for Qatar merchants / QAR. The code has a ready adapter for Checkout.com; others
     (MyFatoorah, Tap, PayTabs, ...) need a small change in psp_charge() in server.py.
     Open a merchant account with the provider and get its PUBLIC key and SECRET key (start with the sandbox keys).
  2. Apple Developer account (99 USD / year) at developer.apple.com.
  3. In Certificates, Identifiers & Profiles > Identifiers > Merchant IDs: create a Merchant ID (e.g. merchant.com.lofan).
  4. Create the "Apple Pay Payment Processing Certificate": your provider gives you a CSR file; upload it to Apple,
     download the .cer and upload it back in the provider's dashboard.
  5. Create the "Apple Pay Merchant Identity Certificate": make a CSR + private key on your computer (OpenSSL), upload
     the CSR to Apple, download the .cer, convert it to PEM, and paste certificate + private key together in
     Admin > Company & Payments > Apple Pay. (Keep the private key secret.)
  6. Domain verification: in the Merchant ID page add your live domain (e.g. lofan.qa). Apple gives you a file
     "apple-developer-merchantid-domain-association.txt". Paste its text into the Admin > Apple Pay
     "Domain verification file" box - the site publishes it at
     https://YOUR-DOMAIN/.well-known/apple-developer-merchantid-domain-association.txt - then click Verify at Apple.
  7. The site must be on a real https:// domain (see SELLING TO REAL CUSTOMERS). Apple Pay does not work on localhost
     merchant validation.
  8. Admin > Company & Payments > Apple Pay: fill Merchant ID, display name, domain, provider keys; tick
     "Offer Apple Pay" and Save. The page tells you exactly what is still missing.
  9. Test in SANDBOX mode on an iPhone / iPad / Mac in Safari with a test card in Wallet. When it works, untick
     "Test (sandbox) mode" and use the live provider keys.
  How it works for customers: they pick Apple Pay on the payment page, confirm with Face ID / Touch ID, and the order
  becomes "Payment confirmed" automatically; you get a notification. Other devices see a note to use another method.
  Note: the Apple Pay code was tested with simulated Apple/provider responses only - always do the sandbox test (step 9).

DELETING SOLD-OUT ITEMS AND CUSTOMER CONTACTS  (Admin dashboard)
  Products & Stock:
  - "Delete forever" on any item removes it from the shop and the list for good (past orders keep their own record).
  - "Delete all sold-out items (N)" removes every item with 0 stock in one click, after a confirmation list.
  - Tick "Delete sold-out items automatically" and an item disappears the moment its stock reaches 0.
    (If an unpaid order is still holding the last units, the item stays until that order is paid or cancelled.)
  - Search, and filter by "Running low" / "Sold out".  Default is OFF, so nothing is deleted unless you choose it.
  Customers:
  - "Delete customer" erases the account, mobile, email, address, saved location, chat history and login sessions.
    You choose what happens to their orders: keep the records for your accounts (unlinked from the customer) or delete the
    orders and receipts too (unpaid orders put their items back in stock). Their email/mobile can then be used again.
  Enquiries: each one has a Delete button (removes the contact details inside it).

CUSTOMER LOCATION -> GOOGLE MAPS
  - Customers choose to share their location: at checkout ("Share my current location"), in My Account > My Details >
    My location, or with the pin button in the chat window. Nothing is sent unless they press the button, and they can
    remove it any time. Their browser asks for permission first.
  - You see it on the order card, in Customers, and in Chat: "Open in Google Maps", "Get directions" (turn-by-turn from where
    you are) and a small map. Uses normal Google Maps links, no API key needed.
  - Location sharing only works on https:// (or localhost), so your live site needs HTTPS.

ADMIN EXTRAS
  - Overview tab: payments to verify, orders today, revenue, new customers, unread chats, sold-out items, 7-day chart,
    low-stock list. Click a tile to jump to that list.
  - Orders: search by number / name / phone / reference, Print invoice (uses your company name, CR no. and address),
    Export CSV. Customers: search and Export CSV.

CART POP-UP, PRODUCT DETAILS, ACCOUNT CHECKS
  - Adding an item slides a cart panel in on the right (items, quantities, subtotal, View cart / Checkout).
  - Clicking a product opens its details: photo, price, description and availability (In stock / Only N left / Sold out).
  - Sign-up refuses an email or mobile number that already has an account and says which one is taken
    (+974 / spaces / 00974 are treated as the same number; email ignores capital letters).

GOOGLE SIGN-IN / SIGN-UP  (needs your own free Google Client ID – about 5 minutes)
  1. Go to https://console.cloud.google.com and create/select a project.
  2. APIs & Services > OAuth consent screen: choose External, fill app name "Lofan",
     your support email, save. (Publish the app when you go live.)
  3. APIs & Services > Credentials > Create credentials > OAuth client ID
     Application type: Web application
     Authorised JavaScript origins:  http://localhost:8000
       (when the site goes live also add your real https:// domain)
     Create, then copy the Client ID (ends with .apps.googleusercontent.com).
  4. Admin page > Company & Payments > "Google sign-in" > paste the Client ID > Save.
  5. Customers now see "Continue with Google" in the sign-in / create-account pop-up.
  - A Google customer is asked once for a mobile number (needed for delivery).
  - Google sign-in is for customers only; the admin always uses email + password.
  - Without a Client ID the Google button is simply hidden – everything else still works.
  - You can also set it with the environment variable GOOGLE_CLIENT_ID.

SHOP ITEMS
  The shop starts with 14 items in 4 categories (Napkins, Placemats, Trays & Coasters,
  Custom Pieces). Nothing is ever removed by updates; manage items in Admin > Products & Stock.
  If you open the site without the server running, the shop still displays the catalogue
  (browse only) with a red banner telling you to start the server.
WHERE DATA LIVES
  data/lofan.db        accounts, orders, products, settings (back this file up!)
  data/receipts/       uploaded payment receipts
  images/products/     photos of items you add
  Do not share the data folder. The server never serves it to visitors.

PUBLISH ON lofan.qa (cPanel hosting)  <- the easy way
  1. Double-click Build-Hosting-Zip.bat  -> creates dist\lofan-cpanel.zip (website + PHP/MySQL server).
  2. Follow hosting\README-HOSTING.txt (also inside the zip): create a MySQL database, upload + extract the zip in
     public_html, open /install.php, run AutoSSL for https, create the admin account.
  3. To preview the exact hosting version on this PC first:  python build_hosting_package.py --preview  (http://localhost:8020)
  4. To also copy today's customers/orders from this PC to the hosting:  python build_hosting_package.py --full
  Your local Python server (Start-Lofan.bat) is only for working on the site on this PC; the live site uses PHP + MySQL.

SELLING TO REAL CUSTOMERS (alternative: your own server / VPS)
  Right now the site only runs on YOUR computer (localhost). To sell to customers it must run
  on an always-on server with a web address:
  1. Rent a small cloud server (VPS) - e.g. DigitalOcean, Hetzner, Vultr, AWS Lightsail
     (about 5 USD/month, Ubuntu, 1 GB RAM is enough). Python 3 is already included.
  2. Buy a domain (e.g. lofan.qa or lofan.com) and point it (A record) to the server's IP.
  3. Copy the whole Lofan-Website folder to the server, then run:  python3 server.py
     Keep it running with a service (systemd) so it restarts by itself.
  4. Put HTTPS in front of it (Caddy is simplest: one line "lofan.qa { reverse_proxy localhost:8000 }"
     and it gets a free certificate). Customers must use https:// for security and for Google sign-in.
  5. In Google Cloud add your https://lofan.qa address under Authorised JavaScript origins.
  6. Open https://lofan.qa/admin.html, create the admin account, enter bank/Fawran/Ooredoo
     details, check prices and stock - then share the link / QR code with customers.
  7. Back up data/lofan.db and data/receipts/ regularly (daily copy).
  Payments: customers pay by IBAN / Fawran / Ooredoo Money and you confirm each payment in admin.
  Taking card payments needs a payment gateway (e.g. MyFatoorah, Stripe, Checkout.com).
  Tip: ask us to prepare the ready-to-upload server setup (systemd + Caddy files) when you pick a host.
IMPORTANT
  The IBAN in examples (QA58 DOHB 0000 1234 5678 90AB CDEF G) is a public sample, not real.
  Enter your real company IBAN before accepting payments.



