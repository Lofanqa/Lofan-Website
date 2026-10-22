/* =====================================================================
   LOFAN – English / Arabic (العربية) for the website.
   The English text in the pages is the source. AR below maps an English text (spaces trimmed) to its Arabic.
   Text that is not in AR stays English, so a missing word never breaks a page.
   Words that change with numbers or names use tr('Only {n} left', { n: 3 }).
   Headings where the Arabic word order differs use data-ar-html="…" on the element.
   Loaded before common.js on every page. The admin dashboard stays in English.
   ===================================================================== */
const LANG_KEY = 'lofan-lang';
const PAGE_TITLE = document.title;
let LANG = 'en';
try { if (!document.body.classList.contains('admin') && localStorage.getItem(LANG_KEY) === 'ar') LANG = 'ar'; } catch { /* private window */ }
const isAr = () => LANG === 'ar';
const LOCALE = () => (isAr() ? 'ar-QA' : undefined);   // undefined = the browser's own date format, as before
const TR_ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const ORIG_TEXT = new WeakMap(), ORIG_ATTR = new WeakMap(), ORIG_HTML = new WeakMap(), APPLIED_HTML = new WeakMap();

/* Translate a text with {placeholders}: tr('Only {n} available', { n: 5 }) */
function tr(s, vars) {
  let out = isAr() && AR[s] !== undefined ? AR[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return out;
}
function translateText(node) {
  if (!ORIG_TEXT.has(node)) ORIG_TEXT.set(node, node.nodeValue);
  let out = ORIG_TEXT.get(node);
  if (isAr()) {
    const key = out.trim();
    if (key && AR[key] !== undefined) out = out.replace(key, () => AR[key]);
    out = out.replace(/\bQAR\b/g, 'ر.ق');
  }
  if (node.nodeValue !== out) node.nodeValue = out;
}
/* Labels such as "Blue Blossom Collection – photo 2" or "Photo 2": the name is translated, the number kept */
const AR_PATTERNS = [
  [/^(.*) – photo (\d+)$/, (m, name, n) => `${AR[name.trim()] !== undefined ? AR[name.trim()] : name} – صورة ${n}`],
  [/^Photo (\d+)$/, (m, n) => `صورة ${n}`]
];
function translateAttrValue(src) {
  const key = src.trim();
  if (AR[key] !== undefined) return AR[key];
  for (const [re, fn] of AR_PATTERNS) { const m = key.match(re); if (m) return fn(...m); }
  return src;
}
function translateAttrs(el) {
  let orig = ORIG_ATTR.get(el);
  for (const a of TR_ATTRS) {
    if (!el.hasAttribute(a)) continue;
    if (!orig) ORIG_ATTR.set(el, orig = {});
    if (!(a in orig)) orig[a] = el.getAttribute(a);
    const out = isAr() ? translateAttrValue(orig[a]) : orig[a];
    if (el.getAttribute(a) !== out) el.setAttribute(a, out);
  }
}
function translateTree(node) {
  if (node.nodeType === 3) return translateText(node);
  if (node.nodeType !== 1 || node.hasAttribute('data-raw') || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.tagName)) return;
  if (node.tagName === 'TEXTAREA') return translateAttrs(node);   // its placeholder only; what the customer types is never changed
  if (node.hasAttribute('data-ar-html')) {                 // a heading with its own Arabic word order
    if (!ORIG_HTML.has(node)) ORIG_HTML.set(node, node.innerHTML);
    const want = isAr() ? node.getAttribute('data-ar-html') : ORIG_HTML.get(node);
    if (APPLIED_HTML.get(node) !== want) { APPLIED_HTML.set(node, want); node.innerHTML = want; }
    return;
  }
  translateAttrs(node);
  for (const child of node.childNodes) translateTree(child);
}
function syncLangButtons() {
  document.querySelectorAll('#langBtn').forEach(b => { const label = isAr() ? 'English' : 'العربية'; if (b.textContent !== label) b.textContent = label; });
}
function applyLang() {
  const html = document.documentElement;
  html.lang = LANG; html.dir = isAr() ? 'rtl' : 'ltr';
  document.title = isAr() && AR[PAGE_TITLE] ? AR[PAGE_TITLE] : PAGE_TITLE;
  syncLangButtons();
}
/* Switch language: pages re-draw their dynamic parts (langchange), then every static text is translated in place. */
/* A quick blink: the screen turns to the background colour for 0.2 s while the language changes underneath, then the new language shows */
function langBlink() {
  const f = document.createElement('div'); f.className = 'lang-blink';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 220);
}
function setLang(lang) {
  langBlink();
  LANG = lang === 'ar' ? 'ar' : 'en';
  try { localStorage.setItem(LANG_KEY, LANG); } catch { /* storage blocked */ }
  applyLang();
  window.dispatchEvent(new Event('langchange'));
  translateTree(document.body);
}
document.addEventListener('click', e => { if (e.target.closest('#langBtn')) setLang(isAr() ? 'en' : 'ar'); });
/* Anything added to the page later (cart, pop-ups, chat, results) is translated as it appears. */
new MutationObserver(records => {
  syncLangButtons();
  if (!isAr()) return;
  for (const r of records) r.addedNodes.forEach(n => translateTree(n));
}).observe(document.documentElement, { childList: true, subtree: true });
const AR = {
  /* ---------- top bar, header, search ---------- */
  'Home': 'الرئيسية', 'Shop': 'المتجر', 'About': 'من نحن', 'Custom Orders': 'الطلبات الخاصة', 'Contact': 'اتصل بنا',
  'Home Accessories': 'إكسسوارات المنزل', 'My Account': 'حسابي', 'Log out': 'تسجيل الخروج', 'Log Out': 'تسجيل الخروج',
  'Search': 'بحث', 'Cart (': 'السلة (', 'Cart': 'السلة', 'Menu': 'القائمة', 'Close': 'إغلاق',
  'Search napkins, placemats, coasters…': 'ابحث عن مناديل وسفرات وأكواب…', 'Search the shop': 'ابحث في المتجر', 'Clear search': 'مسح البحث',
  'Free shipping on larger orders': 'شحن مجاني للطلبات الكبيرة', 'Free shipping on all orders': 'شحن مجاني على جميع الطلبات',
  'Free shipping on orders above {n} QAR or more': 'شحن مجاني للطلبات أعلى من {n} ر.ق أو أكثر',
  'Hi, {name}': 'مرحباً، {name}', 'Admin': 'الإدارة',
  'Lofan Development & Trading. All rights reserved.': 'شركة لوفان للتطوير والتجارة. جميع الحقوق محفوظة.',
  'Timeless details for a more beautiful home.': 'تفاصيل خالدة لمنزل أجمل.',
  'Lofan Home Accessories | Embroidered Pieces for Every Occasion': 'لوفان لإكسسوارات المنزل | قطع مطرزة لكل مناسبة',
  'My Account | Lofan Home Accessories': 'حسابي | لوفان لإكسسوارات المنزل',
  'Payment | Lofan Home Accessories': 'الدفع | لوفان لإكسسوارات المنزل',

  /* ---------- home page ---------- */
  'Timeless Details': 'تفاصيل خالدة', 'Embroidered pieces': 'قطع مطرزة', 'for every occasion': 'لكل مناسبة', 'Shop Now': 'تسوّق الآن',
  'Embroidered placemats and napkin on a travertine table': 'سفرات ومنديل مطرز على طاولة من الحجر الجيري',
  'Napkins': 'مناديل', 'Placemats': 'سفرات', 'Trays & Coasters': 'صواني وحاملات الأكواب', 'Custom Pieces': 'قطع مخصصة',
  'Trays and coasters': 'صواني وحاملات الأكواب', 'Custom pieces': 'قطع مخصصة',
  'The Curated Collection': 'مجموعتنا المختارة', 'All': 'الكل',
  'No pieces match': 'لا توجد قطع تطابق', 'Try another word, for example': 'جرّب كلمة أخرى، مثل', 'napkin': 'منديل', 'placemat': 'سفرة',
  'tray': 'صينية', 'coaster': 'حامل كوب', ',': '،', 'or': 'أو', 'this category': 'هذه الفئة',
  'Your Selection': 'اختيارك', 'Shopping': 'سلة', 'cart': 'المشتريات',
  'About Lofan': 'عن لوفان', 'Crafted with': 'صُنع بـ', 'quiet detail': 'تفاصيل هادئة',
  'Lofan Development & Trading is a Qatar-based company bringing refined home accessories to homes, hospitality venues and businesses. Every napkin, placemat and coaster carries hand-finished embroidery in a calm, natural palette of linen and sage.':
    'شركة لوفان للتطوير والتجارة شركة قطرية تقدم إكسسوارات منزلية راقية للبيوت والفنادق والمطاعم والشركات. كل منديل وسفرة وحامل كوب يحمل تطريزاً يُنجز يدوياً بألوان طبيعية هادئة من الكتان والمريمية.',
  'Beyond our curated collection, we supply commercial and bulk orders, and create custom pieces – from monogrammed napkins to tassel-finished table sets – tailored to your occasion.':
    'إلى جانب مجموعتنا المختارة، نوفر الطلبات التجارية والكميات الكبيرة، ونصمم قطعاً مخصصة – من المناديل المطرزة بالأحرف إلى أطقم الطاولات بالشراشيب – تناسب مناسبتك.',
  'Embroidered': 'تطريز', 'by detail': 'بدقة متناهية', 'Commercial': 'تجاري', '& wholesale supply': 'وتوريد بالجملة',
  'Custom': 'مخصص', 'colours & designs': 'ألوان وتصاميم', 'Delivery': 'التوصيل', 'across Qatar': 'في جميع أنحاء قطر',
  'Custom & Commercial Orders': 'طلبات مخصصة وتجارية', 'order': 'مخصص',
  'Hotels, restaurants, gifting and events – tell us what you need and our team will respond with a tailored proposal.':
    'الفنادق والمطاعم والهدايا والمناسبات – أخبرنا باحتياجك، وسيرد فريقنا بعرض مخصص لك.',
  'Company': 'الشركة', '(optional)': '(اختياري)', 'Full name': 'الاسم الكامل', 'Email': 'البريد الإلكتروني',
  'Phone / WhatsApp': 'الجوال / واتساب', 'e.g. 5555 1234': 'مثال: 5555 1234', 'Enquiry type': 'نوع الطلب',
  'Commercial / bulk order': 'طلب تجاري / بالجملة', 'Custom embroidery': 'تطريز مخصص', 'Gifting & events': 'الهدايا والمناسبات',
  'General question': 'استفسار عام', 'Estimated quantity': 'الكمية التقريبية', 'e.g. 200 pieces': 'مثال: 200 قطعة',
  'Message': 'الرسالة', 'Describe the pieces, colours, logo or embroidery you need…': 'صف القطع أو الألوان أو الشعار أو التطريز الذي تحتاجه…',
  'Reference photos': 'صور مرجعية', '(optional – up to 5, for example a picture of the item you like)': '(اختياري – حتى 5 صور، مثل صورة القطعة التي تعجبك)',
  'Send Enquiry': 'إرسال الطلب',
  'Visit or': 'زرنا أو', 'reach out': 'راسلنا', 'Location': 'الموقع', 'Doha, State of Qatar': 'الدوحة، دولة قطر',
  'Hours': 'ساعات العمل', 'Sat – Thu, 9am – 9pm': 'السبت – الخميس، 9 ص – 9 م', 'Chat with us on WhatsApp': 'راسلنا على واتساب',

  /* ---------- shop, search results, product pop-up ---------- */
  'View details': 'عرض التفاصيل', 'Add to Cart': 'أضف إلى السلة', 'Sold out': 'نفدت الكمية',
  'only {n} left': 'متبقي {n} فقط', 'Only {n} left – order soon': 'متبقي {n} فقط – اطلب قريباً', 'In stock – {n} available': 'متوفر – {n} قطعة',
  'Only {n} available': 'المتوفر {n} قطعة فقط', '(you already have {have} in your cart)': '(لديك {have} في سلتك بالفعل)',
  'You already have {n} in your cart.': 'لديك {n} في سلتك بالفعل.', 'per set': 'للطقم', 'Size:': 'المقاس:', 'Set includes:': 'يتضمن الطقم:',
  'All available units are in your cart': 'كل الوحدات المتوفرة في سلتك', 'Less': 'أقل', 'More': 'أكثر',
  '{n} pieces found for “{q}”': 'تم العثور على {n} قطعة لـ “{q}”', '1 piece found for “{q}”': 'تم العثور على قطعة واحدة لـ “{q}”',
  'No pieces found for “{q}”': 'لم نجد قطعاً لـ “{q}”',
  'Sorry, this item is sold out.': 'عذراً، هذه القطعة نفدت.', 'Added to your cart ✓': 'تمت الإضافة إلى سلتك ✓',
  'The shop is temporarily unavailable – please try again in a moment.': 'المتجر غير متاح مؤقتاً – يرجى المحاولة بعد لحظات.',
  'Please use a customer account to place orders.': 'يرجى استخدام حساب عميل لإتمام الطلبات.',
  'Your cart is empty': 'سلتك فارغة',

  /* ---------- cart panel and cart section ---------- */
  'Your cart': 'سلتك', 'Your cart is empty.': 'سلتك فارغة.', 'View cart': 'عرض السلة', 'Check out': 'إتمام الشراء',
  'Checkout': 'إتمام الشراء', 'Remove': 'إزالة', 'Decrease': 'تقليل', 'Increase': 'زيادة', 'Order summary': 'ملخص الطلب',
  'Subtotal': 'المجموع الفرعي', 'Shipping': 'الشحن', 'Free': 'مجاناً', 'Total': 'الإجمالي',
  'Add {amount} more for free shipping.': 'أضف {amount} للحصول على شحن مجاني.',
  'An account is required to place an order.': 'يلزم إنشاء حساب لإتمام الطلب.',
  '{n} items': '{n} عناصر', '1 item': 'عنصر واحد',

  /* ---------- checkout pop-up ---------- */
  'Ready to': 'هل أنت مستعد', 'pay': 'للدفع', '?': '؟', 'Signed in as': 'مسجّل الدخول باسم',
  'Continue to Payment': 'المتابعة إلى الدفع', 'Keep shopping': 'متابعة التسوق', 'Continue Shopping': 'متابعة التسوق',
  'Please create an account (or sign in) to continue to payment.': 'يرجى إنشاء حساب (أو تسجيل الدخول) للمتابعة إلى الدفع.',
  'Please sign in to continue.': 'يرجى تسجيل الدخول للمتابعة.',

  /* ---------- enquiry form messages ---------- */
  'Please complete the fields marked * (name, email, mobile number and message).': 'يرجى إكمال الحقول المعلّمة بـ * (الاسم والبريد الإلكتروني ورقم الجوال والرسالة).',
  'Please choose up to {n} reference photos.': 'يرجى اختيار {n} صور مرجعية كحد أقصى.',
  'Please choose up to {n} photos (you chose {m}).': 'يرجى اختيار {n} صور كحد أقصى (اخترت {m}).',
  '{n} photo chosen': 'تم اختيار صورة واحدة', '{n} photos chosen': 'تم اختيار {n} صور',
  'One of the photos could not be read. Please use JPG, PNG or WEBP.': 'تعذّرت قراءة إحدى الصور. يرجى استخدام JPG أو PNG أو WEBP.',
  'Sending your enquiry and photos…': 'جارٍ إرسال طلبك والصور…', 'Sending…': 'جارٍ الإرسال…',
  'Thank you – our team will contact you shortly on WhatsApp or by phone.': 'شكراً لك – سيتواصل معك فريقنا قريباً عبر واتساب أو الهاتف.',

  /* ---------- sign in, create account, reset password ---------- */
  'Welcome': 'مرحباً', 'back': 'بعودتك', 'account': 'حساب', 'Create your': 'إنشاء', 'Sign In': 'تسجيل الدخول', 'Sign in': 'تسجيل الدخول',
  'Create Account': 'إنشاء حساب', 'Create account': 'إنشاء حساب', 'Mobile number (Qatar)': 'رقم الجوال (قطر)', 'Mobile number': 'رقم الجوال',
  'Password': 'كلمة المرور', 'password': 'كلمة المرور', 'Confirm password': 'تأكيد كلمة المرور', 'New password': 'كلمة المرور الجديدة',
  'Current password': 'كلمة المرور الحالية', 'Email or mobile number': 'البريد الإلكتروني أو رقم الجوال', 'Forgot password?': 'نسيت كلمة المرور؟',
  'Reset your': 'إعادة تعيين', 'Enter the': 'أدخل', 'code': 'الرمز',
  'Enter the e-mail address of your account. We will send a 6-digit code to it.': 'أدخل البريد الإلكتروني لحسابك. سنرسل إليه رمزاً مكوناً من 6 أرقام.',
  'Send me a code': 'أرسل لي رمزاً', 'Back to sign in': 'العودة لتسجيل الدخول',
  'We sent a 6-digit code to your e-mail.': 'أرسلنا رمزاً مكوناً من 6 أرقام إلى بريدك الإلكتروني.',
  'Test mode – your code is': 'وضع التجربة – رمزك هو', '6-digit code': 'الرمز المكون من 6 أرقام',
  'New password (8+ characters, letters and numbers)': 'كلمة المرور الجديدة (8 أحرف أو أكثر، حروف وأرقام)',
  'Confirm new password': 'تأكيد كلمة المرور الجديدة', 'Set new password': 'تعيين كلمة مرور جديدة',
  'Password must be at least 8 characters and include both letters and numbers.': 'يجب أن تكون كلمة المرور 8 أحرف على الأقل وتشمل حروفاً وأرقاماً.',
  '8 or more characters': '8 أحرف أو أكثر', 'a letter': 'حرف', 'a number': 'رقم',
  'Save & Continue': 'حفظ والمتابعة', 'One last': 'خطوة', 'step': 'أخيرة',
  'Welcome, {name}! Please add your mobile number so we can reach you about deliveries.': 'أهلاً {name}! أضف رقم جوالك حتى نتواصل معك بشأن التوصيل.',
  'This email is already registered to an existing account. Please sign in, or use a different email.': 'هذا البريد الإلكتروني مسجّل لحساب موجود. يرجى تسجيل الدخول أو استخدام بريد آخر.',
  'This mobile number is already registered to an existing account. Please sign in, or use a different number.': 'رقم الجوال هذا مسجّل لحساب موجود. يرجى تسجيل الدخول أو استخدام رقم آخر.',
  'Account created with Google': 'تم إنشاء الحساب باستخدام Google', 'Signed in with Google': 'تم تسجيل الدخول باستخدام Google',
  'Google could not load. Check your internet connection.': 'تعذّر تحميل Google. تحقّق من اتصال الإنترنت.',
  'Passwords do not match.': 'كلمتا المرور غير متطابقتين.',
  'Password changed – please sign in with your new password': 'تم تغيير كلمة المرور – يرجى تسجيل الدخول بكلمة المرور الجديدة',
  'Account created – welcome!': 'تم إنشاء الحساب – أهلاً بك!', 'Signed in': 'تم تسجيل الدخول',
  'Create an account and chat with us.': 'أنشئ حساباً وتحدث معنا.', 'Sign in to chat with us.': 'سجّل الدخول للتحدث معنا.',

  /* ---------- location sharing ---------- */
  'Your browser cannot share a location.': 'متصفحك لا يدعم مشاركة الموقع.',
  'Location permission was blocked. Click the padlock in the address bar, allow Location, then try again.': 'تم منع إذن الموقع. اضغط على القفل في شريط العنوان، واسمح بالموقع، ثم حاول مرة أخرى.',
  'Location needs a secure (https) address.': 'مشاركة الموقع تتطلب عنواناً آمناً (https).',
  'Finding your location took too long. Please try again.': 'استغرق تحديد موقعك وقتاً طويلاً. يرجى المحاولة مرة أخرى.',
  'Your location is not available right now.': 'موقعك غير متاح حالياً.', 'Finding your location…': 'جارٍ تحديد موقعك…',
  'Location saved and shared with Lofan': 'تم حفظ موقعك ومشاركته مع لوفان', 'Location removed': 'تمت إزالة الموقع',
  'Share my current location': 'شارك موقعي الحالي', 'Share my location': 'شارك موقعي', 'Update my location': 'تحديث موقعي',
  'Remove my location': 'إزالة موقعي', 'My location': 'موقعي', 'Saved': 'تم الحفظ', 'No location shared yet.': 'لم تتم مشاركة موقع بعد.',
  'open in Google Maps': 'فتح في خرائط جوجل', 'Open in Google Maps': 'فتح في خرائط جوجل',
  'Share your current location so our delivery team can find you on Google Maps. We only receive it when you press the button, and you can remove it any time.':
    'شارك موقعك الحالي حتى يتمكن فريق التوصيل من الوصول إليك عبر خرائط جوجل. لا نستلمه إلا عند الضغط على الزر، ويمكنك إزالته في أي وقت.',
  'Location captured': 'تم تحديد موقعك', '(accurate to about {m} m)': '(بدقة حوالي {m} متر)', 'check it on Google Maps': 'تحقق منه في خرائط جوجل',
  'Optional – helps our delivery team find your exact spot on Google Maps. It is only sent with this order.':
    'اختياري – يساعد فريق التوصيل على الوصول إلى مكانك بدقة عبر خرائط جوجل. يُرسل مع هذا الطلب فقط.',
  'Finding you…': 'جارٍ تحديد موقعك…',
  '📍 My location': '📍 موقعي', '📍 Location': '📍 الموقع',

  /* ---------- chat ---------- */
  'Chat with us': 'تحدث معنا', 'Chat with Lofan': 'تحدث مع لوفان', 'We usually reply within a few hours': 'نرد عادةً خلال ساعات قليلة',
  'Prefer WhatsApp? Message us there →': 'تفضّل واتساب؟ راسلنا هناك ←', 'Type your message…': 'اكتب رسالتك…', 'Send': 'إرسال',
  'Hello! 👋 How can we help you today? Ask about products, custom orders or your delivery.':
    'أهلاً! 👋 كيف يمكننا مساعدتك اليوم؟ اسأل عن المنتجات أو الطلبات الخاصة أو التوصيل.',
  'Hi, welcome to Lofan! 👋 Please': 'أهلاً بك في لوفان! 👋 يرجى',
  'create an account and chat with us': 'إنشاء حساب والتحدث معنا',
  '– it only takes a minute, then we can answer you and help with your orders.': '– يستغرق الأمر دقيقة واحدة فقط، ثم نجيب على استفسارك ونساعدك في طلباتك.',
  'Please': 'يرجى', 'create an account': 'إنشاء حساب',
  'to send your message – then we can reply to you and follow your orders. 💚': 'لإرسال رسالتك – وبعدها نرد عليك ونتابع طلباتك. 💚',

  /* ---------- payment page ---------- */
  'Delivery & payment': 'التوصيل والدفع', 'Secure Checkout': 'دفع آمن', 'Payment': 'الدفع', 'Confirmation': 'التأكيد',
  'Delivery details': 'تفاصيل التوصيل', 'Delivery address': 'عنوان التوصيل',
  'Zone, street, building / villa no., area, city': 'المنطقة، الشارع، رقم المبنى أو الفيلا، الحي، المدينة',
  'Order notes (optional)': 'ملاحظات الطلب (اختياري)', 'Gift message, delivery time…': 'رسالة هدية، موعد التوصيل…',
  'Your order': 'طلبك', 'Edit cart': 'تعديل السلة', '← Edit cart': '→ تعديل السلة',
  'Your items are reserved for you. Choose how you would like to pay.': 'قطعك محجوزة لك. اختر طريقة الدفع المناسبة لك.',
  'The payment was not completed, so nothing was charged. Your items are still reserved for you – you can try again.':
    'لم يكتمل الدفع، ولم يُخصم أي مبلغ. قطعك ما زالت محجوزة لك – يمكنك المحاولة مرة أخرى.',
  'Order': 'الطلب', 'Amount to pay': 'المبلغ المطلوب', 'Pay to': 'الدفع إلى',
  'Apple Pay works on': 'يعمل Apple Pay على', 'Safari': 'Safari',
  'on iPhone, iPad or Mac with a card in Apple Wallet. Please open this page there, or pay with SkipCash.':
    'على iPhone أو iPad أو Mac ببطاقة في محفظة Apple. يرجى فتح هذه الصفحة هناك، أو الدفع عبر SkipCash.',
  '· you will confirm with Face ID / Touch ID.': '· ستؤكد بواسطة Face ID أو Touch ID.',
  'Pay securely with Face ID / Touch ID using a card in your Apple Wallet. Your order is confirmed instantly.':
    'ادفع بأمان عبر Face ID أو Touch ID باستخدام بطاقة في محفظة Apple. يتأكد طلبك فوراً.',
  'You will be taken to the secure SkipCash payment page to pay with your debit or credit card or SkipCash wallet. Your order is confirmed as soon as the payment is approved.':
    'ستنتقل إلى صفحة الدفع الآمنة لدى SkipCash للدفع ببطاقتك المدينة أو الائتمانية أو محفظة SkipCash. يتأكد طلبك فور الموافقة على الدفع.',
  'set of {n}': 'طقم من {n}', 'Only {n} in stock': 'المتوفر {n} قطعة فقط', 'accurate to about': 'بدقة حوالي',
  'We are having a short technical problem. Please refresh the page in a minute – your cart is safe.':
    'نواجه مشكلة فنية قصيرة. يرجى تحديث الصفحة خلال دقيقة – سلتك محفوظة.',
  'You can also reach us on WhatsApp / phone shown in the Contact section.': 'يمكنك أيضاً التواصل معنا عبر واتساب أو الهاتف المذكورين في قسم اتصل بنا.',
  'If this e-mail belongs to an account, a 6-digit code has been sent to it. The code is valid for 10 minutes.':
    'إذا كان هذا البريد الإلكتروني يخص حساباً، فقد أُرسل إليه رمز مكوّن من 6 أرقام. الرمز صالح لمدة 10 دقائق.',
  'My Account → My Orders': 'حسابي ← طلباتي',
  'Chat': 'الدردشة', 'Collections': 'المجموعات', 'Change language': 'تغيير اللغة',
  'Online payment details are not available yet. Your order {id} is saved – please contact us on {phone} to arrange payment.':
    'لم تتوفر تفاصيل الدفع الإلكتروني بعد. طلبك {id} محفوظ – يرجى التواصل معنا على {phone} لترتيب الدفع.',
  'My Orders': 'طلباتي',
  /* invoice */
  'INVOICE': 'فاتورة', 'Billed to:': 'بيانات العميل:', 'Invoice no.:': 'رقم الفاتورة:', 'Date:': 'التاريخ:',
  'Item': 'البند', 'Quantity': 'الكمية', 'Unit Price': 'سعر الوحدة', 'Thank you!': 'شكراً لك!',
  'Payment information': 'معلومات الدفع', 'Method:': 'الطريقة:', 'Status:': 'الحالة:', 'Not yet paid': 'لم يُدفع بعد',
  'Print or save as PDF': 'طباعة أو حفظ كملف PDF', 'CR No.': 'رقم السجل التجاري', 'ref': 'المرجع',
  'Payment confirmed': 'تم تأكيد الدفع', 'Payment submitted': 'تم إرسال الدفع', 'Download invoice': 'تنزيل الفاتورة',
  'Please allow pop-ups to print the invoice.': 'يرجى السماح بالنوافذ المنبثقة لطباعة الفاتورة.', 'Order not found': 'الطلب غير موجود',
  'Pay {amount} with SkipCash': 'ادفع {amount} عبر SkipCash', 'Opening the secure payment page…': 'جارٍ فتح صفحة الدفع الآمنة…',
  'Cancel this order': 'إلغاء هذا الطلب', 'Cancel this order?': 'هل تريد إلغاء هذا الطلب؟', 'Order cancelled': 'تم إلغاء الطلب',
  'Browse the collection': 'تصفح المجموعة', 'The items in your cart are no longer available.': 'القطع في سلتك لم تعد متوفرة.',
  'Back to shop': 'العودة إلى المتجر', 'Back to home': 'العودة إلى الرئيسية', 'This order was cancelled.': 'تم إلغاء هذا الطلب.',
  'Please complete all delivery details.': 'يرجى إكمال جميع بيانات التوصيل.',
  'Location captured (accurate to about {m} m)': 'تم تحديد موقعك (بدقة حوالي {m} متر)',
  'Thank you, {name}!': 'شكراً لك، {name}!',
  'Your payment for order {id} ({amount} via {method}) was received and confirmed. We are getting your order ready.':
    'تم استلام دفعتك للطلب {id} ({amount} عبر {method}) وتأكيدها. نحن نجهّز طلبك الآن.',
  'We received the payment details for order {id} ({amount} via {method}).': 'استلمنا بيانات الدفع للطلب {id} ({amount} عبر {method}).',
  'Your order is not confirmed yet.': 'طلبك غير مؤكد بعد.',
  'It becomes confirmed as soon as our team verifies the payment (usually within a few hours). You will see the status change in My Orders.':
    'يتأكد طلبك فور تحقق فريقنا من الدفع (عادةً خلال ساعات قليلة). ستشاهد تغيّر الحالة في طلباتي.',
  'You can follow every step of your order in': 'يمكنك متابعة كل خطوة من طلبك في',
  'Track My Order': 'تتبع طلبي',

  /* ---------- account page ---------- */
  'My': 'حسابي', 'My Orders': 'طلباتي', 'My Details': 'بياناتي', 'Loading…': 'جارٍ التحميل…', 'Hello,': 'مرحباً،',
  'Personal details': 'البيانات الشخصية', 'Save Details': 'حفظ البيانات', 'Change password': 'تغيير كلمة المرور',
  'Update Password': 'تحديث كلمة المرور', 'Details saved.': 'تم حفظ البيانات.', 'Password updated.': 'تم تحديث كلمة المرور.',
  'Complete Payment': 'إتمام الدفع', 'Message us about this order': 'راسلنا بخصوص هذا الطلب', 'Order history': 'سجل الطلب',
  'Deliver to:': 'التوصيل إلى:', 'You have not placed any orders yet.': 'لم تقم بأي طلب بعد.', 'Start shopping': 'ابدأ التسوق',
  'Not confirmed – awaiting payment': 'غير مؤكد – بانتظار الدفع', 'Verifying your payment': 'جارٍ التحقق من دفعتك',
  'Order confirmed': 'تم تأكيد الطلب', 'Awaiting payment': 'بانتظار الدفع', 'Verifying payment': 'جارٍ التحقق من الدفع',
  'Preparing': 'قيد التجهيز', 'Out for delivery': 'في الطريق إليك', 'Delivered': 'تم التوصيل', 'Cancelled': 'ملغى',
  'Your order is NOT confirmed yet. Please complete the payment – the items are only reserved for you for a limited time.':
    'طلبك غير مؤكد بعد. يرجى إتمام الدفع – القطع محجوزة لك لفترة محدودة فقط.',
  'We received your payment details and are verifying them. Your order will be confirmed as soon as the payment is verified.':
    'استلمنا بيانات دفعك ونتحقق منها. سيُؤكد طلبك فور التحقق من الدفع.',
  'Order confirmed – your payment was verified. Thank you!': 'تم تأكيد الطلب – تم التحقق من دفعتك. شكراً لك!',
  'Your order is being prepared.': 'جارٍ تجهيز طلبك.', 'Your order is on its way.': 'طلبك في الطريق إليك.', 'Delivered. Enjoy!': 'تم التوصيل. نتمنى لك وقتاً ممتعاً!',
  'Pay to:': 'الدفع إلى:',

  /* ---------- product names (the catalogue) ---------- */
  'Olive Leaf Napkin': 'منديل بورق الزيتون', 'Tassel Napkin Set': 'طقم مناديل بالشراشيب',
  'Whipstitch Linen Napkin': 'منديل كتان بغرزة التطريز', 'Napkin Ring & Tassel Set': 'طقم حلقة منديل وشراشيب',
  'Scalloped Sage Placemat': 'سفرة مريمية مزخرفة الأطراف', 'Sage & Linen Placemat Set': 'طقم سفرات مريمية وكتان',
  'Embroidered Charger Mat': 'سفرة مطرزة للصحون الكبيرة', 'Scalloped Natural Placemat': 'سفرة طبيعية مزخرفة الأطراف',
  'Layered Table Setting': 'طقم طاولة متعدد الطبقات', 'Leaf Coaster Set of 4': 'طقم 4 حوامل أكواب بأوراق',
  'Leaf Coaster Trio': 'ثلاثية حوامل أكواب بأوراق', 'Oak Serving Tray': 'صينية تقديم من خشب البلوط',
  'Made-to-Order Napkin Set': 'طقم مناديل حسب الطلب', 'Custom Table Collection': 'مجموعة طاولات مخصصة',
  'Blue Blossom Collection': 'مجموعة الزهور الزرقاء', 'Butterfly Bliss Collection': 'مجموعة نشوة الفراشة',
  'Grape Collection': 'مجموعة العنب', 'Spring Garden Collection': 'مجموعة حديقة الربيع',
  'Blue Crane Collection': 'مجموعة الكركي الأزرق', 'Silver Grace Collection': 'مجموعة النعمة الفضية',

  /* ---------- shared words ---------- */
  'QAR': 'ر.ق'
};
applyLang();
translateTree(document.body);
