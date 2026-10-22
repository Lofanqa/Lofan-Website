/* =====================================================================
   LOFAN – home page: shop, cart, checkout pop-up, enquiries.
   (Accounts & payments live on the server – see server.py)
   ===================================================================== */
let PRODUCTS = [], CATS = {}, SHIPPING = { fee: 25, freeFrom: 300 };
let filter = 'all', query = '', OFFLINE = false;
/* Shown only when the server is not running, so the shop never looks empty. */
const FALLBACK = {
  cats: { napkins: 'Napkins', placemats: 'Placemats', coasters: 'Trays & Coasters', custom: 'Custom Pieces' },
  products: [
    ['Olive Leaf Napkin', 'napkins', 45, 'images/napkins.jpg'], ['Tassel Napkin Set', 'napkins', 120, 'images/custom.jpg'],
    ['Whipstitch Linen Napkin', 'napkins', 55, 'images/products/whipstitch-napkin.jpg'], ['Napkin Ring & Tassel Set', 'napkins', 65, 'images/products/napkin-ring-tassel.jpg'],
    ['Scalloped Sage Placemat', 'placemats', 85, 'images/placemat-1.jpg'], ['Sage & Linen Placemat Set', 'placemats', 160, 'images/placemat-2.jpg'],
    ['Embroidered Charger Mat', 'placemats', 95, 'images/placemat-3.jpg'], ['Scalloped Natural Placemat', 'placemats', 90, 'images/products/scalloped-natural.jpg'],
    ['Layered Table Setting', 'placemats', 210, 'images/products/table-set.jpg'],
    ['Leaf Coaster Set of 4', 'coasters', 70, 'images/coasters.jpg'], ['Leaf Coaster Trio', 'coasters', 55, 'images/products/coaster-trio.jpg'],
    ['Oak Serving Tray', 'coasters', 140, 'images/products/oak-tray.jpg'],
    ['Made-to-Order Napkin Set', 'custom', 150, 'images/products/ring-set.jpg'], ['Custom Table Collection', 'custom', 320, 'images/products/table-set.jpg']
  ].map(([name, cat, price, img], i) => ({ id: 9000 + i, name, cat, price, stock: 10, img, desc: '' }))
};
const product = id => PRODUCTS.find(p => p.id === id);
const photosOf = p => (p.images && p.images.length ? p.images : [p.img]);
const stockOf = p => (p ? p.stock : 0);

/* ---------- Smooth navigation ---------- */
function goTo(hash) {
  if (!hash || hash === '#top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const el = $(hash); if (!el) return;
  const sb = $('#searchbar'), bar = sb && sb.classList.contains('open') ? sb.offsetHeight : 0;   // the search bar is pinned under the header
  const y = el.getBoundingClientRect().top + window.scrollY - $('.header').offsetHeight - bar + 1;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]'); if (!a) return;
  e.preventDefault();
  $('.header').classList.remove('menu');
  goTo(a.getAttribute('href'));
});
const spyLinks = $$('.nav a');
function spy() {
  const line = $('.header').offsetHeight + 140;
  let current = '#top';
  if (window.scrollY > 200) ['#shop', '#about', '#custom', '#contact'].forEach(id => {
    const el = $(id); if (el && el.getBoundingClientRect().top <= line) current = id;
  });
  spyLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === current));
}
window.addEventListener('scroll', spy, { passive: true });

/* ---------- Shop ---------- */
function renderFilters() {
  const on = query ? 'all' : filter;   // while searching, every category is searched
  $('#filters').innerHTML = '<button class="' + (on === 'all' ? 'on' : '') + '" data-filter="all">All</button>' +
    Object.entries(CATS).map(([k, v]) => `<button class="${on === k ? 'on' : ''}" data-filter="${esc(k)}">${esc(v)}</button>`).join('');
}
/* Search: every word typed must appear in the name, category or description (any order, capitals and plurals ignored). */
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const stem = w => (w.length > 3 ? w.replace(/(ies|es|s)$/, m => (m === 'ies' ? 'y' : '')) : w);
function searchWords() { return norm(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
function productMatches(p, words) {
  const hay = norm(p.name + ' ' + tr(p.name) + ' ' + (CATS[p.cat] || '') + ' ' + tr(CATS[p.cat] || '') + ' ' + (p.desc || ''));   // in Arabic, the Arabic names are searched too
  return words.every(w => hay.includes(w) || hay.includes(stem(w)));
}
function renderProducts() {
  const words = searchWords();
  const list = PRODUCTS.filter(p => words.length ? productMatches(p, words) : (filter === 'all' || p.cat === filter));
  $('#productGrid').innerHTML = list.map(p => `
    <article class="card" data-id="${p.id}">
      <div class="pic ${p.stock > 0 ? '' : 'sold'}" title="View details">${sliderHTML(photosOf(p), p.name)}<span class="pic-view">View details</span></div>
      <p class="cat-name">${esc(CATS[p.cat] || '')}</p>
      <h3>${esc(p.name)}</h3>
      ${p.size ? `<p class="size-line">${esc(p.size)}${p.includes ? ' · ' + esc(tr('set of {n}', { n: p.includes.split(',').length })) : ''}</p>` : ''}
      ${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : ''}
      <p class="price">${money(p.price)}${p.stock > 0 && p.stock <= 5 ? `<small class="low"> · ${esc(tr('only {n} left', { n: p.stock }))}</small>` : ''}</p>
      ${p.stock > 0 ? `<button class="add" data-id="${p.id}">Add to Cart</button>` : '<button class="add" disabled>Sold out</button>'}
    </article>`).join('');
  $('#emptyMsg').hidden = list.length > 0;
  $('#emptyQuery').textContent = query ? '“' + query + '”' : tr('this category');
  $('#emptyClear').hidden = !query;
  const info = $('#searchInfo');
  if (info) info.textContent = !words.length ? '' : !list.length ? tr('No pieces found for “{q}”', { q: query })
    : list.length === 1 ? tr('1 piece found for “{q}”', { q: query }) : tr('{n} pieces found for “{q}”', { n: list.length, q: query });
  const clr = $('#searchClear'); if (clr) clr.hidden = !query;
}
function setFilter(f) { filter = f; if (query) clearSearch(false); else { renderFilters(); renderProducts(); } }
$('#filters').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setFilter(b.dataset.filter); });
$$('.cat[data-filter]').forEach(a => a.addEventListener('click', () => setFilter(a.dataset.filter)));
document.addEventListener('click', e => { if (e.target.closest('#modal')) sliderClick(e); });   // arrows inside the product pop-up
$('#productGrid').addEventListener('click', e => {
  if (sliderClick(e)) return;                                          // photo arrows / dots must not open the product
  const b = e.target.closest('.add');
  if (b) { if (!b.disabled) addToCart(+b.dataset.id); return; }
  const card = e.target.closest('.card'); if (card) showProduct(+card.dataset.id);   // click an item = see its details & availability
});

function addToCart(id, qty = 1) {
  if (OFFLINE) { toast(IS_LOCAL ? 'Start the server (python server.py) to place orders.' : 'The shop is temporarily unavailable – please try again in a moment.'); return false; }
  const p = product(id), cart = Cart.get(), row = cart.find(i => i.id === id), have = row ? row.qty : 0;
  if (!p || p.stock <= 0) { toast('Sorry, this item is sold out.'); return false; }
  if (have + qty > p.stock) { toast(`${tr('Only {n} available', { n: p.stock })}${have ? ' ' + tr('(you already have {have} in your cart)', { have }) : ''}.`); return false; }
  row ? row.qty += qty : cart.push({ id, qty });
  Cart.set(cart); renderCart(); toast('Added to your cart ✓');
  return true;
}

/* ---------- Product details pop-up (image, price, availability) ---------- */
function showProduct(id) {
  const p = product(id); if (!p) return;
  const inCart = (Cart.get().find(i => i.id === id) || { qty: 0 }).qty, left = Math.max(0, p.stock - inCart);
  const avail = p.stock <= 0 ? ['out', tr('Sold out')] : p.stock <= 5 ? ['low', tr('Only {n} left – order soon', { n: p.stock })] : ['in', tr('In stock – {n} available', { n: p.stock })];
  Modal.open(`
    <div class="pd">
      <div class="pd-img">${sliderHTML(photosOf(p), p.name, 'big')}</div>
      <div class="pd-info">
        <p class="cat-name">${esc(CATS[p.cat] || '')}</p>
        <h2>${esc(p.name)}</h2>
        <p class="price big">${money(p.price)}${p.includes ? ' <small class="muted">per set</small>' : ''}</p>
        ${p.size ? `<p class="pd-meta"><strong>Size:</strong> ${esc(p.size)}</p>` : ''}
        ${p.includes ? `<p class="pd-meta"><strong>Set includes:</strong> ${esc(p.includes)}</p>` : ''}
        <p class="avail ${avail[0]}"><i></i>${avail[1]}</p>
        ${p.desc ? `<p class="pd-desc">${esc(p.desc)}</p>` : ''}
        ${inCart ? `<p class="muted small">${esc(tr('You already have {n} in your cart.', { n: inCart }))}</p>` : ''}
        ${left > 0 ? `<div class="pd-buy">
            <div class="qty"><button type="button" id="pdMinus" aria-label="Less">&minus;</button><span id="pdQty">1</span><button type="button" id="pdPlus" aria-label="More">+</button></div>
            <button class="btn" id="pdAdd">Add to Cart</button></div>`
          : `<button class="btn" disabled>${p.stock <= 0 ? 'Sold out' : 'All available units are in your cart'}</button>`}
      </div>
    </div>`, 'wide');
  if (left > 0) {
    let q = 1; const set = n => { q = Math.max(1, Math.min(left, n)); $('#pdQty').textContent = q; };
    $('#pdMinus').addEventListener('click', () => set(q - 1));
    $('#pdPlus').addEventListener('click', () => { if (q >= left) toast(tr('Only {n} available', { n: left }) + '.'); set(q + 1); });
    $('#pdAdd').addEventListener('click', () => { if (addToCart(id, q)) Modal.close(); });
  }
}

/* ---------- Cart bar (bottom of the screen) and cart panel (slides in from the right) ---------- */
function ensureCartUI() {
  if ($('#cartBar')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="cart-bar" id="cartBar" hidden>
      <div class="cb-info"><strong id="cbCount">0 items</strong><span id="cbTotal"></span></div>
      <div class="cb-btns"><button class="btn ghost" id="cbView">View cart</button><button class="btn" id="cbCheckout">Check out</button></div>
    </div>
    <div class="overlay" id="cdOverlay"></div>
    <aside class="drawer cart-drawer" id="cartDrawer" aria-label="Your cart">
      <div class="drawer-head"><h3>Your cart</h3><button id="cdClose" aria-label="Close">&times;</button></div>
      <div class="drawer-body" id="cdList"></div>
      <div class="drawer-foot" id="cdSummary"></div>
    </aside>`);
  $('#cbView').addEventListener('click', openCartPanel);
  $('#cbCheckout').addEventListener('click', startCheckout);
  $('#cdClose').addEventListener('click', closeCartPanel);
  $('#cdOverlay').addEventListener('click', closeCartPanel);
  $('#cdList').addEventListener('click', onCartQty);
  $('#cartDrawer').addEventListener('click', e => { if (e.target.closest('[data-checkout]')) { closeCartPanel(); startCheckout(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCartPanel(); });
}
function openCartPanel() { ensureCartUI(); renderCart(); $('#cartDrawer').classList.add('open'); $('#cdOverlay').classList.add('open'); }
function closeCartPanel() { if (!$('#cartDrawer')) return; $('#cartDrawer').classList.remove('open'); $('#cdOverlay').classList.remove('open'); }
function onCartQty(e) {                                                // + / − / Remove buttons in the cart (panel or section)
  const b = e.target.closest('button'); if (!b || !b.dataset.a) return;
  const id = +b.dataset.id, cart = Cart.get(), row = cart.find(i => i.id === id); if (!row) return;
  if (b.dataset.a === 'inc') { if (row.qty >= stockOf(product(id))) return toast(tr('Only {n} in stock', { n: row.qty })); row.qty++; }
  if (b.dataset.a === 'dec') row.qty--;
  Cart.set(b.dataset.a === 'rm' || row.qty < 1 ? cart.filter(i => i.id !== id) : cart);
  renderCart();
}
/* ---------- Search: the bar stays under the header while you scroll; results show in the shop grid ---------- */
const setHeaderVar = () => document.documentElement.style.setProperty('--hdr', $('.header').offsetHeight + 'px');
setHeaderVar(); window.addEventListener('resize', setHeaderVar); window.addEventListener('load', setHeaderVar);
function openSearch() { $('#searchbar').classList.add('open'); $('#searchBtn').classList.add('on'); $('#searchInput').focus(); }
function closeSearch() { if (query) clearSearch(false); $('#searchbar').classList.remove('open'); $('#searchBtn').classList.remove('on'); }
function clearSearch(refocus) {
  query = ''; $('#searchInput').value = '';
  renderFilters(); renderProducts();
  if (refocus) $('#searchInput').focus();
}
function showResults() {   // bring the shop into view once, not on every key press
  const r = $('#shop').getBoundingClientRect();
  if (!(r.top < window.innerHeight * 0.5 && r.bottom > 220)) goTo('#shop');
}
function runSearch(jump) {
  query = $('#searchInput').value.trim();
  renderFilters(); renderProducts();
  if (query && jump) showResults();
}
let searchTimer;
$('#searchBtn').addEventListener('click', () => { $('#searchbar').classList.contains('open') ? closeSearch() : openSearch(); });
$('#searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(true), 150); });
$('#searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); runSearch(false); if (query) goTo('#shop'); e.target.blur(); }   // blur hides the phone keyboard
  if (e.key === 'Escape') { clearSearch(false); closeSearch(); }
});
$('#searchClear').addEventListener('click', () => clearSearch(true));
$('#emptyClear').addEventListener('click', () => clearSearch(false));

/* ---------- Cart ---------- */
function cleanCart() {   // drop items that no longer exist / exceed stock
  if (!PRODUCTS.length || OFFLINE) return [];   // products not loaded – don't touch the saved cart
  const cart = Cart.get().filter(i => product(i.id) && product(i.id).stock > 0);
  cart.forEach(i => { i.qty = Math.min(i.qty, product(i.id).stock); });
  Cart.set(cart); return cart;
}
function totals(cart) {
  const subtotal = cart.reduce((s, i) => s + product(i.id).price * i.qty, 0);
  const shipping = !cart.length || subtotal >= SHIPPING.freeFrom ? 0 : SHIPPING.fee;
  return { subtotal, shipping, total: subtotal + shipping };
}
function renderCart() {
  const cart = cleanCart(), t = totals(cart);
  const list = cart.length ? cart.map(i => {
    const p = product(i.id);
    return `<div class="cl-item">
      <img src="${esc(p.img)}" alt="">
      <div><h4>${esc(p.name)}</h4><p class="cat-name">${esc(CATS[p.cat] || '')}</p>
        <div class="qty"><button data-a="dec" data-id="${p.id}" aria-label="Decrease">&minus;</button><span>${i.qty}</span><button data-a="inc" data-id="${p.id}" aria-label="Increase">+</button></div></div>
      <div class="cl-right"><strong>${money(p.price * i.qty)}</strong><button class="rm" data-a="rm" data-id="${p.id}">Remove</button></div>
    </div>`;
  }).join('') : '<div class="cl-empty"><p>Your cart is empty.</p></div>';
  const summary = cart.length ? `
    <h3>Order summary</h3>
    <div class="sum-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
    <div class="sum-row"><span>Shipping</span><span>${t.shipping ? money(t.shipping) : 'Free'}</span></div>
    ${t.shipping ? `<p class="ship">${esc(tr('Add {amount} more for free shipping.', { amount: money(SHIPPING.freeFrom - t.subtotal) }))}</p>` : ''}
    <div class="sum-row total"><span>Total</span><strong>${money(t.total)}</strong></div>
    <button class="btn full" data-checkout>Checkout <b>&rarr;</b></button>
    <p class="ship">An account is required to place an order.</p>` : '';
  $('#cartList').innerHTML = list;
  $('#cartSummary').innerHTML = summary;
  $('#cartSummary').style.display = cart.length ? '' : 'none';
  ensureCartUI();
  $('#cdList').innerHTML = list;
  $('#cdSummary').innerHTML = summary;
  $('#cdSummary').style.display = cart.length ? '' : 'none';
  $('#cartBar').hidden = !cart.length;
  document.body.classList.toggle('has-cart-bar', cart.length > 0);
  const n = cart.reduce((s, i) => s + i.qty, 0);
  $('#cbCount').textContent = n === 1 ? tr('1 item') : tr('{n} items', { n });
  $('#cbTotal').textContent = cart.length ? money(t.total) : '';
}
$('#cartList').addEventListener('click', onCartQty);
$('#cartBtn').addEventListener('click', openCartPanel);

/* ---------- Checkout pop-up: account is mandatory before payment ---------- */
$('#cartSummary').addEventListener('click', e => { if (e.target.closest('[data-checkout]')) startCheckout(); });
function startCheckout() {
  if (!Cart.get().length) return toast('Your cart is empty');
  if (!state.user) {
    openAuth('register', { reason: 'Please create an account (or sign in) to continue to payment.', next: showCheckoutPopup });
  } else if (state.user.role === 'admin') {
    toast('Please use a customer account to place orders.');
  } else showCheckoutPopup();
}
function showCheckoutPopup() {
  const cart = cleanCart(); if (!cart.length) return;
  const t = totals(cart);
  Modal.open(`
    <h2>Ready to <em>pay</em>?</h2>
    <p class="gate-note">Signed in as <strong>${esc(state.user.name)}</strong> · ${esc(state.user.phone)}</p>
    <div class="pop-items">${cart.map(i => `<div class="sum-row"><span>${esc(tr(product(i.id).name))} × ${i.qty}</span><span>${money(product(i.id).price * i.qty)}</span></div>`).join('')}
      <div class="sum-row"><span>Shipping</span><span>${t.shipping ? money(t.shipping) : 'Free'}</span></div>
      <div class="sum-row total"><span>Total</span><strong>${money(t.total)}</strong></div></div>
    <a class="btn full" href="payment.html">Continue to Payment <b>&rarr;</b></a>
    <button class="btn ghost full" id="popKeep">Keep shopping</button>`);
  $('#popKeep').addEventListener('click', Modal.close);
}

/* ---------- Enquiry form (goes to the admin) ---------- */
/* Reference photos: shrunk in the browser (about 1400 px, JPEG) so they upload quickly */
const ENQ_MAX_PHOTOS = 5;
function shrinkPhoto(file, max = 1400) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('One of the photos could not be read. Please use JPG, PNG or WEBP.')); };
    img.src = url;
  });
}
$('#enqPhotos').addEventListener('change', e => {
  const n = e.target.files.length;
  $('#enqCount').textContent = n > ENQ_MAX_PHOTOS ? tr('Please choose up to {n} photos (you chose {m}).', { n: ENQ_MAX_PHOTOS, m: n })
    : n ? (n === 1 ? tr('{n} photo chosen', { n }) : tr('{n} photos chosen', { n })) : '';
});
$('#enquiryForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, note = $('#formNote'), btn = $('button[type=submit]', f);
  const v = { name: f.elements.name.value.trim(), company: f.elements.company.value.trim(), email: f.elements.email.value.trim(), phone: f.elements.phone.value.trim(),
    type: f.elements.type.value, qty: f.elements.qty.value.trim(), message: f.elements.message.value.trim() };
  const checks = {
    name: v.name.length >= 2, email: /^\S+@\S+\.\S+$/.test(v.email), phone: v.phone.replace(/\D/g, '').length >= 7, message: v.message.length >= 5
  };
  let ok = true;
  Object.keys(checks).forEach(k => { f.elements[k].classList.toggle('invalid', !checks[k]); if (!checks[k]) ok = false; });
  if (!ok) { note.className = 'note err'; note.textContent = 'Please complete the fields marked * (name, email, mobile number and message).'; return; }
  const files = [...f.elements.photos.files];
  if (files.length > ENQ_MAX_PHOTOS) { note.className = 'note err'; note.textContent = tr('Please choose up to {n} reference photos.', { n: ENQ_MAX_PHOTOS }); return; }
  btn.disabled = true; note.className = 'note'; note.textContent = files.length ? 'Sending your enquiry and photos…' : 'Sending…';
  try {
    v.images = [];
    for (const file of files) v.images.push({ data: await shrinkPhoto(file) });
    await api('/enquiries', { method: 'POST', body: v });
    note.className = 'note'; note.textContent = 'Thank you – our team will contact you shortly on WhatsApp or by phone.';
    f.reset(); $('#enqCount').textContent = '';
  } catch (err) {
    note.className = 'note err'; note.textContent = err.message;
    if (err.field && f.elements[err.field]) f.elements[err.field].classList.add('invalid');
  }
  btn.disabled = false;
});

/* ---------- Start ---------- */
$('#burger').addEventListener('click', () => $('.header').classList.toggle('menu'));
window.addEventListener('langchange', () => {   // the shop changes language without redrawing the cards, so they do not slide in again
  $$('#shipNoteTop').forEach(e => { e.textContent = shipNote(SHIPPING.freeFrom); });
  renderFilters(); refreshProductLines(); renderCart();
});
/* Only the words that contain numbers are redrawn (stock left, set size, search results); the cards stay as they are */
function refreshProductLines() {
  $$('#productGrid .card').forEach(card => {
    const p = product(+card.dataset.id); if (!p) return;
    const low = card.querySelector('.price .low');
    if (low) low.textContent = ' · ' + tr('only {n} left', { n: p.stock });
    const size = card.querySelector('.size-line');
    if (size) size.textContent = p.size + (p.includes ? ' · ' + tr('set of {n}', { n: p.includes.split(',').length }) : '');
  });
  const n = $$('#productGrid .card').length, words = searchWords(), info = $('#searchInfo');
  if (info) info.textContent = !words.length ? '' : !n ? tr('No pieces found for “{q}”', { q: query })
    : n === 1 ? tr('1 piece found for “{q}”', { q: query }) : tr('{n} pieces found for “{q}”', { n, q: query });
  $('#emptyQuery').textContent = query ? '“' + query + '”' : tr('this category');
}
$('#year').textContent = new Date().getFullYear();
(async function init() {
  const p = new URLSearchParams(location.search);
  await loadUser();
  try {
    const d = await api('/products');
    PRODUCTS = d.products; CATS = d.categories; SHIPPING = d.shipping;
    const c = d.company;
    if (c) {
      $('#cPhone').textContent = c.phone; $('#cPhone').href = 'tel:' + c.phone.replace(/\s/g, '');
      $('#cEmail').textContent = c.email; $('#cEmail').href = 'mailto:' + c.email;
      $('#cAddr').textContent = c.address;
      if (c.whatsapp) $('#cWa').href = 'https://wa.me/' + c.whatsapp + '?text=' + encodeURIComponent('Hello Lofan, I would like to ask about your products.'); else $('#cWa').hidden = true;
    }
    $$('#shipNoteTop').forEach(e => { e.textContent = shipNote(SHIPPING.freeFrom); });
  } catch {   // server not running: still show the whole catalogue (browse only)
    OFFLINE = true; PRODUCTS = FALLBACK.products; CATS = FALLBACK.cats; showServerDown();
  }
  renderFilters(); renderProducts(); renderCart(); spy();
  if (p.get('login') && !state.user) openAuth('login', { reason: 'Please sign in to continue.', next: () => { if (p.get('next') === 'payment') location.href = 'payment.html'; } });
  if (p.get('search')) openSearch();   // arrived from the "Search" link on another page
  if (location.hash && $(location.hash)) setTimeout(() => goTo(location.hash), 300);
})();


