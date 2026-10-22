/* =====================================================================
   LOFAN – shared code for every page (API helper, account pop-up, cart)
   ===================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => `${n} QAR`;
const fmtDate = t => new Date(t * 1000).toLocaleString(LOCALE(), { dateStyle: 'medium', timeStyle: 'short' });

/* ---------- Location sharing + Google Maps (no API key needed) ---------- */
const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
const dirLink = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
const mapEmbed = (lat, lng, h = 200) => `<iframe class="map-embed" style="height:${h}px" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed" title="Map"></iframe>`;
function getLocation() {   // asks the customer's browser for their position – only ever called after they press a "share" button
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Your browser cannot share a location.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy || 0) }),
      e => reject(new Error(e.code === 1
        ? (window.isSecureContext ? 'Location permission was blocked. Click the padlock in the address bar, allow Location, then try again.' : 'Location needs a secure (https) address.')
        : e.code === 3 ? 'Finding your location took too long. Please try again.' : 'Your location is not available right now.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });f
}

async function api(path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch('/api/' + path.replace(/^\//, ''), {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { await serverMissing(); throw Object.assign(new Error('Cannot reach the Lofan server.'), { network: true }); }
  let d = {}, isJson = true; try { d = await r.json(); } catch { isJson = false; }
  // Live Server / a plain file server answers /api calls with an HTML page or 404/405 – that is NOT our server
  if (!isJson && (r.ok || r.status >= 500 || [404, 405, 501].includes(r.status))) {
    await serverMissing();
    throw Object.assign(new Error(IS_LOCAL ? 'This page was opened without the Lofan server. Open http://localhost:8000' : 'The website is temporarily unavailable. Please try again in a moment.'), { network: true });
  }
  if (!r.ok) throw Object.assign(new Error(d.error || 'Something went wrong'), { status: r.status, field: d.field });
  return d;
}
const SERVER_URL = 'http://localhost:8000';
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);   // on the live site (lofan.qa) the messages below are different
async function serverMissing() {
  showServerDown();
  const here = location.origin;
  if (!IS_LOCAL || here === SERVER_URL || here === 'http://127.0.0.1:8000' || location.protocol === 'https:') return;
  try {   // is the real server running? if yes, move to it automatically
    await fetch(SERVER_URL + '/api/config', { mode: 'no-cors' });
    const page = location.pathname.split('/').pop() || 'index.html';
    location.replace(`${SERVER_URL}/${page}${location.search}${location.hash}`);
  } catch { /* server really is off – banner explains how to start it */ }
}
function showServerDown() {
  if ($('#serverDown')) return;
  document.body.insertAdjacentHTML('afterbegin', IS_LOCAL
    ? `<div id="serverDown" class="server-down">
    The Lofan server is not running. <strong>Double-click <code>Start-Lofan.bat</code></strong> in the Lofan-Website folder
    (or in VS Code press <code>Ctrl+Shift+B</code>), then open <a href="${SERVER_URL}"><strong>${SERVER_URL}</strong></a>.</div>`
    : `<div id="serverDown" class="server-down">${esc(tr('We are having a short technical problem. Please refresh the page in a minute – your cart is safe.'))}
    ${esc(tr('You can also reach us on WhatsApp / phone shown in the Contact section.'))}</div>`);
}

function toast(msg) {
  let t = $('#toast'); if (!t) { document.body.insertAdjacentHTML('beforeend', '<div class="toast" id="toast"></div>'); t = $('#toast'); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Cart (kept in this browser until the order is placed) ---------- */
const Cart = {
  key: 'lofan-cart',
  get() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  set(v) { try { localStorage.setItem(this.key, JSON.stringify(v)); } catch { /* storage full */ } updateCartCount(); },
  clear() { this.set([]); }
};
function updateCartCount() { const n = Cart.get().reduce((s, i) => s + i.qty, 0); $$('#cartCount').forEach(e => { e.textContent = n; }); }

/* ---------- Modal ---------- */
function ensureModal() {
  if ($('#modal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="overlay" id="overlay"></div>
    <div class="modal" id="modal" role="dialog" aria-modal="true"><button class="modal-x" id="modalClose" aria-label="Close">&times;</button><div id="modalBody"></div></div>`);
  $('#overlay').addEventListener('click', () => Modal.close());
  $('#modalClose').addEventListener('click', () => Modal.close());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') Modal.close(); });
  $('#modalBody').addEventListener('click', e => {
    const v = e.target.closest('button[data-auth-view]'); if (v) renderAuth(v.dataset.authView);
    if (e.target.closest('[data-forgot]')) {                   // "Forgot password?" – keep the e-mail that was typed, if any
      const typed = (($('input[name=id]', $('#modalBody'))) || {}).value || '';
      forgotView(/@/.test(typed) ? typed : '');
    }
  });
  $('#modalBody').addEventListener('submit', onAuthSubmit);
}
const Modal = {
  open(html, cls = '') {
    ensureModal(); $('#modalBody').innerHTML = html;
    $('#modal').classList.toggle('wide', cls === 'wide');
    $('#overlay').classList.add('open'); $('#modal').classList.add('open');
  },
  close() { if (!$('#modal')) return; $('#overlay').classList.remove('open'); $('#modal').classList.remove('open'); }
};

/* ---------- Account (login / register) ---------- */
const state = { user: null };
let authOpts = {};

async function loadUser() {
  try { state.user = (await api('/me')).user; } catch { state.user = null; }
  updateAccountBtn();
  return state.user;
}
function updateAccountBtn() {
  const b = $('#accountBtn'); if (!b) return;
  b.textContent = state.user ? (state.user.role === 'admin' ? 'Admin' : tr('Hi, {name}', { name: state.user.name.split(' ')[0] })) : 'My Account';
  const out = $('#topLogout'), sep = $('#topLogoutSep');       // a Log out button is always there while somebody is signed in
  if (out) out.hidden = !state.user;
  if (sep) sep.hidden = !state.user;
}
/* Makes "My Account" in the top bar blink so the visitor sees where to create an account. */
function blinkAccount() {
  const b = $('#accountBtn'); if (!b) return;
  if (window.scrollY > 40) window.scrollTo({ top: 0, behavior: 'smooth' });
  b.classList.remove('blink'); void b.offsetWidth; b.classList.add('blink');
  clearTimeout(blinkAccount.t); blinkAccount.t = setTimeout(() => b.classList.remove('blink'), 7000);
}
const shipNote = n => (n > 0 ? tr('Free shipping on orders above {n} QAR or more', { n }) : tr('Free shipping on all orders'));
function bindAccountBtn() {
  const lo = $('#topLogout'); if (lo) lo.addEventListener('click', logout);
  const b = $('#accountBtn'); if (!b) return;
  b.addEventListener('click', () => {
    if (state.user) location.href = state.user.role === 'admin' ? 'admin.html' : 'account.html';
    else openAuth('login');
  });
}
/* Password rule for new passwords: at least 8 characters with letters AND numbers (the server enforces it too). */
const PW_RULE = 'Password must be at least 8 characters and include both letters and numbers.';
const pwChecks = v => ({ len: String(v).length >= 8, letter: /\p{L}/u.test(v), num: /[0-9]/.test(v) });
const pwProblem = v => { const c = pwChecks(v || ''); return c.len && c.letter && c.num ? '' : PW_RULE; };
const PW_RULES_HTML = '<ul class="pw-rules" data-pw-rules aria-live="polite"><li data-r="len">8 or more characters</li><li data-r="letter">a letter</li><li data-r="num">a number</li></ul>';
function bindPwRules(form, field = 'password') {   // live tick-list under the password box
  const input = form && form.elements[field], box = form && $('[data-pw-rules]', form); if (!input || !box) return;
  const paint = () => { const c = pwChecks(input.value); $$('li', box).forEach(li => li.classList.toggle('ok', !!c[li.dataset.r])); };
  input.addEventListener('input', paint); paint();
}
function openAuth(view = 'login', opts = {}) { authOpts = opts; renderAuth(view); }
/* Forgot password: step 1 asks for the account's e-mail; step 2 (forgotCode) asks for the code and a new password. */
function forgotView(prefill = '') {
  Modal.open(`<h2>Reset your <em>password</em></h2>
    <p class="gate-note">Enter the e-mail address of your account. We will send a 6-digit code to it.</p>
    <form data-auth-form="forgot" novalidate>
      <label>Email<input type="email" name="email" value="${esc(prefill)}" autocomplete="email" required></label>
      <button class="btn full" type="submit">Send me a code</button><p class="note" data-note></p>
    </form>
    <button type="button" class="btn ghost full" data-auth-view="login">Back to sign in</button>`);
  setTimeout(() => { const f = $('#modalBody input'); if (f) f.focus(); }, 60);
}
function forgotCode(email, message, devCode) {
  Modal.open(`<h2>Enter the <em>code</em></h2>
    <p class="gate-note">${esc(message || 'We sent a 6-digit code to your e-mail.')}</p>
    ${devCode ? `<p class="note">Test mode – your code is <strong>${esc(devCode)}</strong></p>` : ''}
    <form data-auth-form="resetcode" novalidate>
      <input type="hidden" name="email" value="${esc(email)}">
      <label>6-digit code<input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></label>
      <label>New password (8+ characters, letters and numbers)<input type="password" name="password" autocomplete="new-password" required></label>
      <label>Confirm new password<input type="password" name="confirm" autocomplete="new-password" required></label>
      <button class="btn full" type="submit">Set new password</button><p class="note" data-note></p>
    </form>
    <button type="button" class="btn ghost full" data-auth-view="login">Back to sign in</button>`);
  setTimeout(() => { const f = $('#modalBody input[name=code]'); if (f) f.focus(); }, 60);
}
function renderAuth(view) {
  const reg = view === 'register';
  Modal.open(`
    ${authOpts.reason ? `<p class="gate-note">${esc(authOpts.reason)}</p>` : ''}
    <h2>${reg ? 'Create your <em>account</em>' : 'Welcome <em>back</em>'}</h2>
    <div class="tabs"><button class="${reg ? '' : 'on'}" data-auth-view="login">Sign In</button><button class="${reg ? 'on' : ''}" data-auth-view="register">Create Account</button></div>
    ${reg ? `
    <form data-auth-form="register" novalidate>
      <label>Full name<input name="name" autocomplete="name" required></label>
      <label>Mobile number (Qatar)<input name="phone" inputmode="tel" autocomplete="tel" placeholder="e.g. 5555 1234" required><small class="field-hint" data-hint="phone"></small></label>
      <label>Email<input type="email" name="email" autocomplete="email" required><small class="field-hint" data-hint="email"></small></label>
      <label>Password<input type="password" name="password" autocomplete="new-password" required>${PW_RULES_HTML}</label>
      <label>Confirm password<input type="password" name="confirm" autocomplete="new-password" required></label>
      <button class="btn full" type="submit">Create Account</button><p class="note" data-note></p>
    </form>` : `
    <form data-auth-form="login" novalidate>
      <label>Email or mobile number<input name="id" autocomplete="username" required></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn full" type="submit">Sign In</button><p class="note" data-note></p>
      <p class="small center forgot-line"><button type="button" class="ulink" data-forgot>Forgot password?</button></p>
    </form>`}
    ${state.googleId ? '<div class="or"><span>or</span></div><div id="gBtn" class="gbtn"></div>' : ''}`);
  setTimeout(() => { const f = $('#modalBody input'); if (f) f.focus(); }, 60);
  if (reg) { watchDuplicates(); bindPwRules($('form[data-auth-form="register"]')); }
  mountGoogle();
}

/* Tell the customer straight away if the email / mobile number already has an account */
function watchDuplicates() {
  const form = $('form[data-auth-form="register"]'); if (!form) return;
  const MSG = {
    email: 'This email is already registered to an existing account. Please sign in, or use a different email.',
    phone: 'This mobile number is already registered to an existing account. Please sign in, or use a different number.'
  };
  ['email', 'phone'].forEach(name => {
    const input = form.elements[name], hint = $(`[data-hint="${name}"]`, form);
    input.addEventListener('input', () => { hint.textContent = ''; hint.className = 'field-hint'; input.classList.remove('invalid'); });
    input.addEventListener('blur', async () => {
      const v = input.value.trim(); if (!v) return;
      try {
        const r = await api(`/check?${name}=${encodeURIComponent(v)}`);
        if (r[name + 'Taken']) { hint.textContent = MSG[name]; hint.className = 'field-hint bad'; input.classList.add('invalid'); }
      } catch { /* the submit will report any problem */ }
    });
  });
}

/* ---------- Sign in / sign up with Google ---------- */
let gisPromise;
const loadGis = () => gisPromise || (gisPromise = new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = res; s.onerror = rej; document.head.appendChild(s);
}));
async function loadConfig() {
  try {
    const c = await api('/config');
    state.googleId = c.googleClientId || ''; state.whatsapp = c.whatsapp || ''; state.companyPhone = c.phone || '';
    if (c.shipping) { const n = $('#shipNoteTop'); if (n) n.textContent = shipNote(c.shipping.freeFrom); }   // same number on every page
  } catch { state.googleId = ''; }
}
async function mountGoogle() {
  const el = $('#gBtn'); if (!el || !state.googleId) return;
  try {
    await loadGis();
    google.accounts.id.initialize({ client_id: state.googleId, callback: onGoogle });
    google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: 300 });
  } catch { el.innerHTML = '<p class="muted small center">Google could not load. Check your internet connection.</p>'; }
}
async function onGoogle(resp) {
  try {
    const r = await api('/google', { method: 'POST', body: { credential: resp.credential } });
    state.user = r.user; updateAccountBtn();
    toast(r.created ? 'Account created with Google' : 'Signed in with Google');
    const next = authOpts.next; authOpts = {};
    if (!r.user.phone) askPhone(next); else { Modal.close(); if (next) next(r.user); }
  } catch (err) {
    const n = $('[data-note]'); if (n) { n.textContent = err.message; n.classList.add('err'); } else toast(err.message);
  }
}
function askPhone(next) {   // Google does not share a phone number, and we need one for delivery
  authOpts = { next };
  Modal.open(`<h2>One last <em>step</em></h2>
    <p class="gate-note">${esc(tr('Welcome, {name}! Please add your mobile number so we can reach you about deliveries.', { name: state.user.name }))}</p>
    <form data-auth-form="phone" novalidate>
      <label>Mobile number (Qatar)<input name="phone" inputmode="tel" autocomplete="tel" placeholder="e.g. 5555 1234" required></label>
      <button class="btn full" type="submit">Save &amp; Continue</button><p class="note" data-note></p>
    </form>`);
  setTimeout(() => { const f = $('#modalBody input'); if (f) f.focus(); }, 60);
}
async function onAuthSubmit(e) {
  const f = e.target.closest('form[data-auth-form]'); if (!f) return;
  e.preventDefault();
  const kind = f.dataset.authForm, d = Object.fromEntries(new FormData(f)), note = $('[data-note]', f);
  const fail = (m, field) => {
    note.textContent = m; note.classList.add('err');
    $$('.invalid', f).forEach(x => x.classList.remove('invalid'));
    if (field && f.elements[field]) { f.elements[field].classList.add('invalid'); f.elements[field].focus(); }
  };
  if (kind === 'register') {
    if (pwProblem(d.password)) return fail(PW_RULE, 'password');
    if (d.password !== d.confirm) return fail('Passwords do not match.', 'confirm');
  }
  const btn = $('button[type=submit]', f); btn.disabled = true;
  try {
    if (kind === 'forgot') {                                   // step 1: a 6-digit code goes to the account's e-mail
      const r = await api('/auth/otp/request', { method: 'POST', body: { email: d.email } });
      forgotCode(d.email, r.message, r.devCode); return;
    }
    if (kind === 'resetcode') {                                // step 2: the code and the new password
      if (d.password !== d.confirm) return fail('Passwords do not match.', 'confirm');
      await api('/auth/otp/confirm', { method: 'POST', body: { email: d.email, code: d.code, password: d.password } });
      toast('Password changed – please sign in with your new password'); openAuth('login'); return;
    }
    if (kind === 'phone') {
      const u = state.user;
      const r = await api('/me', { method: 'PUT', body: { name: u.name, email: u.email, address: u.address, phone: d.phone } });
      state.user = r.user; Modal.close();
      const next = authOpts.next; authOpts = {}; if (next) next(r.user);
      return;
    }
    const r = await api(kind === 'register' ? '/register' : '/login', { method: 'POST', body: d });
    state.user = r.user; updateAccountBtn(); Modal.close();
    if (r.user.role === 'admin') { location.href = 'admin.html'; return; }   // staff land on the dashboard
    toast(kind === 'register' ? 'Account created – welcome!' : 'Signed in');
    const next = authOpts.next; authOpts = {};
    if (next) next(r.user);
  } catch (err) { fail(err.message, err.field); btn.disabled = false; }
}
async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.user = null; Cart.clear(); location.href = 'index.html';
}

/* ---------- Shared header for inner pages ---------- */
function renderChrome() {
  const el = $('#chrome'); if (!el) return;
  el.innerHTML = `
  <div class="topbar"><span></span><p id="shipNoteTop">Free shipping on larger orders</p>
    <nav><button id="accountBtn">My Account</button><i id="topLogoutSep" hidden>|</i><button id="topLogout" hidden>Log out</button><i>|</i><a href="index.html?search=1">Search</a><i>|</i><a href="index.html#cart">Cart (<span id="cartCount">0</span>)</a><i>|</i><button id="langBtn" type="button" aria-label="Change language">العربية</button></nav></div>
  <header class="header">
    <button class="burger" id="burger" aria-label="Menu"><span></span><span></span><span></span></button>
    <nav class="nav nav-left"><a href="index.html">Home</a><a href="index.html#shop">Shop</a><a href="index.html#about">About</a></nav>
    <a href="index.html" class="brand"><span class="logo-wrap"><img src="images/logo.jpg" alt="Lofan"><i class="glint"></i><b class="spark s1"></b><b class="spark s2"></b><b class="spark s3"></b></span><small>Home Accessories</small></a>
    <nav class="nav nav-right"><a href="index.html#custom">Custom Orders</a><a href="index.html#contact">Contact</a></nav>
  </header>`;
  $('#burger').addEventListener('click', () => $('.header').classList.toggle('menu'));
}
/* ---------- Photo slider: product cards and the product pop-up. Arrows, dots, swipe, and automatic every 3 seconds ---------- */
const SLIDE_MS = 3000;
function sliderHTML(images, alt, cls = '') {
  const list = (images || []).filter(Boolean);
  if (list.length <= 1) return `<div class="slider single ${cls}"><div class="slides"><img class="on" src="${esc(list[0] || '')}" alt="${esc(alt)}" loading="lazy"></div></div>`;
  return `<div class="slider ${cls}" data-slider data-i="0" data-n="${list.length}">
    <div class="slides">${list.map((src, i) => `<img class="${i ? '' : 'on'}" src="${esc(src)}" alt="${esc(alt)} – photo ${i + 1}" loading="${i ? 'lazy' : 'eager'}">`).join('')}</div>
    <button type="button" class="s-btn prev" data-slide="-1" aria-label="Previous photo">&#8249;</button>
    <button type="button" class="s-btn next" data-slide="1" aria-label="Next photo">&#8250;</button>
    <span class="dots">${list.map((_, i) => `<i class="${i ? '' : 'on'}" data-dot="${i}" aria-label="Photo ${i + 1}"></i>`).join('')}</span></div>`;
}
function slideTo(s, i) {
  const n = +s.dataset.n; i = ((i % n) + n) % n; s.dataset.i = i;
  $$('.slides img', s).forEach((im, k) => im.classList.toggle('on', k === i));
  $$('.dots i', s).forEach((d, k) => d.classList.toggle('on', k === i));
}
function sliderClick(e) {   // true when the click was an arrow / dot (so the product card must not open)
  const b = e.target.closest('[data-slide]'), dot = e.target.closest('[data-dot]'), ctl = b || dot;
  if (!ctl) return false;
  const s = ctl.closest('[data-slider]'); if (!s) return false;
  e.preventDefault(); e.stopPropagation();
  slideTo(s, b ? +s.dataset.i + (+b.dataset.slide) : +dot.dataset.dot);
  s.dataset.hold = Date.now();                       // after a manual click wait a full 3 seconds before sliding again
  return true;
}
setInterval(() => {
  const canHover = window.matchMedia && matchMedia('(hover:hover)').matches;
  $$('[data-slider]').forEach(s => {
    if ((canHover && s.matches(':hover')) || Date.now() - (+s.dataset.hold || 0) < SLIDE_MS - 200) return;   // paused while the mouse is on it
    slideTo(s, +s.dataset.i + 1);
  });
}, SLIDE_MS);
let swipeX = null;                                    // swipe left / right on phones
document.addEventListener('touchstart', e => { swipeX = e.target.closest('[data-slider]') ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (swipeX === null) return;
  const s = e.target.closest('[data-slider]'), dx = e.changedTouches[0].clientX - swipeX; swipeX = null;
  if (s && Math.abs(dx) > 40) { slideTo(s, +s.dataset.i + (dx < 0 ? 1 : -1)); s.dataset.hold = Date.now(); }
}, { passive: true });

/* ---------- Live chat with the Lofan team (customers) ---------- */
const Chat = { last: 0, timer: null, shown: false };
const hhmm = t => new Date(t * 1000).toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' });
function initChat() {
  if (document.body.classList.contains('admin') || $('#chatFab')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <button class="chat-fab" id="chatFab" aria-label="Chat with us">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12z"/></svg>
      <span>Chat with us</span><b class="badge" id="chatBadge" hidden>0</b></button>
    <section class="chat-panel" id="chatPanel" hidden aria-label="Chat">
      <header><div><strong>Chat with Lofan</strong><small>We usually reply within a few hours</small></div><button id="chatClose" aria-label="Close">&times;</button></header>
      <div class="chat-body" id="chatBody"></div>
      <a class="chat-wa" id="chatWa" target="_blank" rel="noopener" hidden>Prefer WhatsApp? Message us there &rarr;</a>
      <form id="chatForm"><button type="button" class="chat-loc" id="chatLoc" title="Share my current location" aria-label="Share my current location">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg></button>
        <input id="chatInput" placeholder="Type your message…" autocomplete="off" maxlength="1000"><button class="btn" type="submit">Send</button></form>
    </section>`);
  $('#chatFab').addEventListener('click', () => openChat());
  $('#chatClose').addEventListener('click', closeChat);
  $('#chatForm').addEventListener('submit', sendChat);
  $('#chatLoc').addEventListener('click', shareLocationInChat);
  setInterval(pollUnread, 6000); setTimeout(pollUnread, 1200);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollUnread(); });
}
function chatBubble(m) {
  const mine = m.sender === 'customer';
  if (m.loc) return `<div class="msg ${mine ? 'me' : 'them'} loc"><p>📍 ${mine ? 'My location' : 'Location'}</p><a href="${mapsLink(m.loc.lat, m.loc.lng)}" target="_blank" rel="noopener">Open in Google Maps</a><small>${hhmm(m.created)}</small></div>`;
  return `<div class="msg ${mine ? 'me' : 'them'}" data-raw><p>${esc(m.body)}</p><small>${hhmm(m.created)}</small></div>`;
}
async function shareLocationInChat() {
  if (!state.user) { guestSend('📍 My current location'); return; }
  const b = $('#chatLoc'); b.disabled = true; toast('Finding your location…');
  try {
    const loc = await getLocation();
    const r = await api('/chat', { method: 'POST', body: { location: { lat: loc.lat, lng: loc.lng } } });
    addMessages([r.message]); toast('Location sent to the Lofan team');
  } catch (err) { toast(err.message); }
  b.disabled = false;
}
function addMessages(list) {
  if (!list.length) return;
  const body = $('#chatBody'), stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40 || !Chat.last;
  const hint = $('.chat-empty', body); if (hint) hint.remove();
  body.insertAdjacentHTML('beforeend', list.map(chatBubble).join(''));
  Chat.last = list[list.length - 1].id;
  if (stick) body.scrollTop = body.scrollHeight;
}
async function openChat(prefill = '') {
  if (state.user && state.user.role === 'admin') { toast('Use the admin dashboard to chat with customers.'); return; }
  const guest = !state.user;
  $('#chatPanel').hidden = false; $('#chatFab').hidden = true; Chat.shown = true; Chat.last = 0;
  $('#chatPanel').classList.toggle('guest', guest);
  const wa = $('#chatWa'); if (state.whatsapp) { wa.hidden = false; wa.href = `https://wa.me/${state.whatsapp}?text=${encodeURIComponent('Hello Lofan, I have a question.')}`; }
  if (prefill) $('#chatInput').value = prefill;
  if (guest) { showGuestChat(); return; }
  $('#chatBody').innerHTML = '<p class="chat-empty">Hello! 👋 How can we help you today? Ask about products, custom orders or your delivery.</p>';
  await loadChat(); $('#chatInput').focus();
  clearInterval(Chat.timer); Chat.timer = setInterval(loadChat, 4000);
}
function closeChat() { $('#chatPanel').hidden = true; $('#chatFab').hidden = false; Chat.shown = false; clearInterval(Chat.timer); setTimeout(pollUnread, 300); }

/* Visitors without an account: invite them to create one (the chat needs an account so we can reply and follow their orders). */
function showGuestChat() {
  $('#chatBody').innerHTML = `
    <div class="msg them"><p>Hi, welcome to Lofan! 👋 Please <strong>create an account and chat with us</strong> – it only takes a minute, then we can answer you and help with your orders.</p></div>
    <div class="chat-cta"><button class="btn" id="chatCreate" type="button">Create account</button><button class="btn ghost" id="chatSignin" type="button">Sign in</button></div>`;
  const after = () => { closeChat(); openChat(Chat.pending || ''); Chat.pending = ''; };
  $('#chatCreate').addEventListener('click', () => { blinkAccount(); openAuth('register', { reason: 'Create an account and chat with us.', next: after }); });
  $('#chatSignin').addEventListener('click', () => openAuth('login', { reason: 'Sign in to chat with us.', next: after }));
}
function guestSend(text) {
  const b = $('#chatBody');
  b.insertAdjacentHTML('beforeend', `<div class="msg me"><p>${esc(text)}</p></div>
    <div class="msg them"><p>Please <strong>create an account</strong> to send your message – then we can reply to you and follow your orders. 💚</p></div>`);
  b.scrollTop = b.scrollHeight; Chat.pending = text; blinkAccount();   // the words the customer typed stay as they wrote them
  const c = $('#chatCreate'); if (c) c.classList.add('attention');
}
async function loadChat() {
  try { const d = await api(`/chat?after=${Chat.last}&open=1`); addMessages(d.messages); $('#chatBadge').hidden = true; } catch { /* offline */ }
}
async function sendChat(e) {
  e.preventDefault();
  const input = $('#chatInput'), body = input.value.trim(); if (!body) return;
  input.value = '';
  if (!state.user) { guestSend(body); return; }
  try { const r = await api('/chat', { method: 'POST', body: { body } }); addMessages([r.message]); }
  catch (err) { input.value = body; toast(err.message); }
}
const BASE_TITLE = () => (isAr() && AR[PAGE_TITLE] ? AR[PAGE_TITLE] : PAGE_TITLE);
async function pollUnread() {   // red number on the chat button when the Lofan team has written to this customer
  const b = $('#chatBadge'), fab = $('#chatFab'); if (!b || !fab) return;
  const paint = n => {
    b.hidden = !n; b.textContent = n > 9 ? '9+' : n; fab.classList.toggle('has-unread', n > 0);
    document.title = (n ? `(${n}) ` : '') + BASE_TITLE();
  };
  if (!state.user || state.user.role === 'admin' || Chat.shown) { paint(0); return; }
  try { const { unread } = await api('/chat/unread'); paint(unread); } catch { /* ignore */ }
}
document.addEventListener('click', e => {   // "Message us about this order" style buttons anywhere
  const b = e.target.closest('[data-open-chat]'); if (b) openChat(b.dataset.openChat);
});

document.addEventListener('DOMContentLoaded', () => { renderChrome(); ensureModal(); bindAccountBtn(); updateAccountBtn(); updateCartCount(); loadConfig(); initChat(); });
window.addEventListener('langchange', () => { Modal.close(); updateAccountBtn(); });   // pop-ups are closed on a language switch so they never show mixed languages

/* Printable invoice (A4). Follows the Lofan invoice template: logo top-left, INVOICE top-right, billed-to and
   invoice no. / date, item table (Item, Quantity, Unit Price, Total), total, "Thank you!" and payment information. */
function invoiceHTML(o, co) {
  const dl = o.delivery || {};
  const date = new Date(o.created * 1000).toLocaleDateString(LOCALE() || 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const rows = o.items.map(i => `<tr><td class="it">${esc(tr(i.name))}</td><td class="n">${i.qty}</td><td class="n">${i.price}</td><td class="n">${i.price * i.qty}</td><td class="sp"></td></tr>`);
  rows.push(`<tr><td class="it">${tr('Delivery')}</td><td class="n"></td><td class="n"></td><td class="n">${o.shipping ? o.shipping : tr('Free')}</td><td class="sp"></td></tr>`);
  while (rows.length < 3) rows.push('<tr><td class="it"></td><td class="n"></td><td class="n"></td><td class="n"></td><td class="sp"></td></tr>');
  const paid = o.method ? `${esc(o.method)}${o.txn ? ' · ' + esc(tr('ref')) + ' ' + esc(o.txn) : ''}` : tr('Not yet paid');
  const many = rows.length > 3 ? ' many' : '';
  return `<!doctype html><html lang="${LANG}" dir="${isAr() ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${tr('INVOICE')} ${esc(o.id)}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Jost:wght@300;400;500;600&family=Cairo:wght@400;600;700&display=swap">
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #e6e6e0; }
    body { font: 11pt/1.45 Jost, Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 210mm; min-height: 297mm; margin: 0 auto; background: #f5f5f0; padding: 21mm 20.6mm 0 21.8mm; }
    .head { display: flex; justify-content: space-between; align-items: center; height: 22.3mm; }
    .logo { width: 51mm; height: 22.3mm; background: #fff; }
    .logo img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .title { margin: 0; font: 700 50pt/1 'Cormorant Garamond', Georgia, serif; letter-spacing: .3mm; }
    .meta { display: grid; grid-template-columns: 60.4% 1fr; margin-top: 16.5mm; min-height: 41mm; }
    .meta h4 { margin: 0 0 1mm; font-size: 13pt; font-weight: 600; }
    .meta p { margin: 0; }
    .meta .inv { font-size: 13pt; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { height: 13.2mm; padding: 0; vertical-align: middle; border-bottom: .3mm solid #111; font-size: 12pt; }
    thead th { border-top: .3mm solid #111; font-size: 13pt; font-weight: 600; }
    .it { text-align: left; padding-left: 3.1mm; }
    .n { text-align: right; }
    .w1 { width: 51.4%; } .w2 { width: 15.2%; } .w3 { width: 16.2%; } .w4 { width: 12.9%; } .w5 { width: 4.3%; }
    .sum { display: flex; align-items: center; gap: 4mm; margin: 26mm 0 0 69.3%; padding: 2.5mm 0 0 5.6mm; border-top: .3mm solid #111; font-size: 18pt; font-weight: 600; }
    .sum .sv { margin-left: auto; }
    .thanks { margin: 5mm 0 0; font: 300 22pt/1.2 Jost, Arial, sans-serif; }
    .pay { margin-top: 22mm; }
    .many td { height: 10.5mm; }
    .many .sum { margin-top: 16mm; }
    .many .pay { margin-top: 16mm; }
    .pay h4 { margin: 0 0 2mm; font-size: 13pt; font-weight: 600; text-transform: uppercase; }
    .pay p { margin: 0 0 1mm; }
    .noprint { text-align: center; padding: 12px; }
    @media print { .noprint { display: none; } html, body { background: #f5f5f0; } }
    html[lang="ar"] body { font-family: 'Cairo', Arial, sans-serif; }
    html[lang="ar"] .title { font-family: 'Cairo', sans-serif; font-weight: 700; font-size: 40pt; }
    html[dir="rtl"] .it { text-align: right; padding-left: 0; padding-right: 3.1mm; }
    html[dir="rtl"] .sum { margin-left: 0; margin-right: 69.3%; padding: 2.5mm 5.6mm 0 0; }
    html[dir="rtl"] .sum .sv { margin-left: 0; margin-right: auto; }
  </style></head><body>
  <div class="noprint"><button onclick="print()">${tr('Print or save as PDF')}</button></div>
  <div class="page${many}">
    <div class="head">
      <div class="logo"><img src="${location.origin}/images/logo.jpg" alt="Lofan"></div>
      <h1 class="title">${tr('INVOICE')}</h1>
    </div>
    <div class="meta">
      <div><h4>${tr('Billed to:')}</h4><p>${esc(dl.name)}</p><p>+${esc(dl.phone)}</p><p>${esc(dl.email)}</p><p>${esc(dl.address)}</p></div>
      <div class="inv"><p>${tr('Invoice no.:')} ${esc(o.id)}</p><p>${tr('Date:')} ${date}</p></div>
    </div>
    <table>
      <thead><tr><th class="it w1">${tr('Item')}</th><th class="n w2">${tr('Quantity')}</th><th class="n w3">${tr('Unit Price')}</th><th class="n w4">${tr('Total')}</th><th class="w5"></th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <div class="sum"><span class="sl">${tr('Total')}</span><span>${tr('QAR')}</span><span class="sv">${o.total}</span></div>
    <p class="thanks">${tr('Thank you!')}</p>
    <div class="pay">
      <h4>${tr('Payment information')}</h4>
      <p>${tr('Method:')} ${paid}</p>
      <p>${tr('Status:')} ${esc(tr(o.status))}</p>
      <p>${tr('Pay to:')} ${esc(co.name)}${co.crNumber ? ' · ' + esc(tr('CR No.')) + ' ' + esc(co.crNumber) : ''}</p>
      <p>${esc(co.address)} · ${esc(co.phone)} · ${esc(co.email)}</p>
    </div>
  </div>
  <script>window.onload=function(){setTimeout(function(){print()},400)}<\/script></body></html>`;
}
