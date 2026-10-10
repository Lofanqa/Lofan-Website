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
  const hay = norm(p.name + ' ' + (CATS[p.cat] || '') + ' ' + (p.desc || ''));
  return words.every(w => hay.includes(w) || hay.includes(stem(w)));
}
function renderProducts() {
  const words = searchWords();
  const list = PRODUCTS.filter(p => words.length ? productMatches(p, words) : (filter === 'all' || p.cat === filter));
  $('#productGrid').innerHTML = list.map(p => `
    <article class="card" data-id="${p.id}">
      <div class="pic ${p.stock > 0 ? '' : 'sold'}" title="View details"><img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy"><span class="pic-view">View details</span></div>
      <p class="cat-name">${esc(CATS[p.cat] || '')}</p>
      <h3>${esc(p.name)}</h3>
      ${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : ''}
      <p class="price">${money(p.price)}${p.stock > 0 && p.stock <= 5 ? `<small class="low"> · only ${p.stock} left</small>` : ''}</p>
      ${p.stock > 0 ? `<button class="add" data-id="${p.id}">Add to Cart</button>` : '<button class="add" disabled>Sold out</button>'}
    </article>`).join('');
  $('#emptyMsg').hidden = list.length > 0;
  $('#emptyQuery').textContent = query ? '“' + query + '”' : 'this category';
  $('#emptyClear').hidden = !query;
  const info = $('#searchInfo');
  if (info) info.textContent = !words.length ? '' : list.length ? `${list.length} piece${list.length === 1 ? '' : 's'} found for “${query}”` : `No pieces found for “${query}”`;
  const clr = $('#searchClear'); if (clr) clr.hidden = !query;
}
function setFilter(f) { filter = f; if (query) clearSearch(false); else { renderFilters(); renderProducts(); } }
$('#filters').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setFilter(b.dataset.filter); });
$$('.cat[data-filter]').forEach(a => a.addEventListener('click', () => setFilter(a.dataset.filter)));
$('#productGrid').addEventListener('click', e => {
  const b = e.target.closest('.add');
  if (b) { if (!b.disabled) addToCart(+b.dataset.id); return; }
  const card = e.target.closest('.card'); if (card) showProduct(+card.dataset.id);   // click an item = see its details & availability
});

function addToCart(id, qty = 1) {
  if (OFFLINE) { toast(IS_LOCAL ? 'Start the server (python server.py) to place orders.' : 'The shop is temporarily unavailable – please try again in a moment.'); return false; }
  const p = product(id), cart = Cart.get(), row = cart.find(i => i.id === id), have = row ? row.qty : 0;
  if (!p || p.stock <= 0) { toast('Sorry, this item is sold out.'); return false; }
  if (have + qty > p.stock) { toast(`Only ${p.stock} available${have ? ` (you already have ${have} in your cart)` : ''}.`); return false; }
  row ? row.qty += qty : cart.push({ id, qty });
  Cart.set(cart); renderCart(); openMini(id);
  return true;
}

/* ---------- Product details pop-up (image, price, availability) ---------- */
function showProduct(id) {
  const p = product(id); if (!p) return;
  const inCart = (Cart.get().find(i => i.id === id) || { qty: 0 }).qty, left = Math.max(0, p.stock - inCart);
  const avail = p.stock <= 0 ? ['out', 'Sold out'] : p.stock <= 5 ? ['low', `Only ${p.stock} left – order soon`] : ['in', `In stock – ${p.stock} available`];
  Modal.open(`
    <div class="pd">
      <div class="pd-img"><img src="${esc(p.img)}" alt="${esc(p.name)}"></div>
      <div class="pd-info">
        <p class="cat-name">${esc(CATS[p.cat] || '')}</p>
        <h2>${esc(p.name)}</h2>
        <p class="price big">${money(p.price)}</p>
        <p class="avail ${avail[0]}"><i></i>${avail[1]}</p>
        ${p.desc ? `<p class="pd-desc">${esc(p.desc)}</p>` : ''}
        ${inCart ? `<p class="muted small">You already have ${inCart} in your cart.</p>` : ''}
        ${left > 0 ? `<div class="pd-buy">
            <div class="qty"><button type="button" id="pdMinus" aria-label="Less">&minus;</button><span id="pdQty">1</span><button type="button" id="pdPlus" aria-label="More">+</button></div>
            <button class="btn" id="pdAdd">Add to Cart</button></div>`
          : `<button class="btn" disabled>${p.stock <= 0 ? 'Sold out' : 'All available units are in your cart'}</button>`}
      </div>
    </div>`, 'wide');
  if (left > 0) {
    let q = 1; const set = n => { q = Math.max(1, Math.min(left, n)); $('#pdQty').textContent = q; };
    $('#pdMinus').addEventListener('click', () => set(q - 1));
    $('#pdPlus').addEventListener('click', () => { if (q >= left) toast(`Only ${left} available.`); set(q + 1); });
    $('#pdAdd').addEventListener('click', () => { if (addToCart(id, q)) Modal.close(); });
  }
}

/* ---------- Mini cart: slides in on the right whenever something is added ---------- */
let miniTimer, miniJust = null;
function ensureMini() {
  if ($('#miniCart')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <aside class="mini" id="miniCart" aria-label="Your cart" hidden>
      <header><strong id="miniTitle">Added to your cart</strong><button id="miniClose" aria-label="Close">&times;</button></header>
      <div class="mini-body" id="miniBody"></div>
      <footer id="miniFoot"></footer>
    </aside>`);
  const el = $('#miniCart');
  $('#miniClose').addEventListener('click', closeMini);
  el.addEventListener('mouseenter', () => clearTimeout(miniTimer));
  el.addEventListener('mouseleave', () => { clearTimeout(miniTimer); miniTimer = setTimeout(closeMini, 6000); });
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    if (b) {
      const id = +b.dataset.id, cart = Cart.get(), row = cart.find(i => i.id === id); if (!row) return;
      if (b.dataset.a === 'inc') { if (row.qty >= stockOf(product(id))) return toast('Only ' + row.qty + ' available'); row.qty++; }
      if (b.dataset.a === 'dec') row.qty--;
      miniJust = null; clearTimeout(miniTimer);
      Cart.set(b.dataset.a === 'rm' || row.qty < 1 ? cart.filter(i => i.id !== id) : cart); renderCart(); return;
    }
    if (e.target.closest('#miniView')) { closeMini(); goTo('#cart'); }
    if (e.target.closest('#miniCheckout')) { closeMini(); startCheckout(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMini(); });
}
function openMini(justId) {
  ensureMini(); miniJust = justId ?? null; renderMini();
  const el = $('#miniCart'); el.hidden = false; void el.offsetWidth; el.classList.add('open');   // reflow first so the slide-in animates
  clearTimeout(miniTimer); miniTimer = setTimeout(closeMini, 12000);
}
function closeMini() {
  const el = $('#miniCart'); if (!el) return;
  el.classList.remove('open'); setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 300);
}
function renderMini() {
  const body = $('#miniBody'); if (!body) return;
  const cart = Cart.get().filter(i => product(i.id)), t = cart.length ? totals(cart) : null;
  $('#miniTitle').textContent = miniJust ? 'Added to your cart ✓' : 'Your cart';
  body.innerHTML = cart.length ? cart.map(i => {
    const p = product(i.id);
    return `<div class="mc-item ${i.id === miniJust ? 'just' : ''}">
      <img src="${esc(p.img)}" alt="">
      <div><strong>${esc(p.name)}</strong><small>${money(p.price)} each</small>
        <div class="qty"><button data-a="dec" data-id="${p.id}" aria-label="Decrease">&minus;</button><span>${i.qty}</span><button data-a="inc" data-id="${p.id}" aria-label="Increase">+</button></div></div>
      <div class="mc-right"><strong>${money(p.price * i.qty)}</strong><button class="rm" data-a="rm" data-id="${p.id}">Remove</button></div>
    </div>`;
  }).join('') : '<p class="muted center" style="padding:30px 0">Your cart is empty.</p>';
  $('#miniFoot').innerHTML = cart.length ? `
    <div class="sum-row"><span>Subtotal (${cart.reduce((s, i) => s + i.qty, 0)} items)</span><strong>${money(t.subtotal)}</strong></div>
    <p class="ship">${t.shipping ? `Add ${money(SHIPPING.freeFrom - t.subtotal)} more for free shipping.` : 'You get free shipping!'}</p>
    <div class="mc-btns"><button class="btn ghost" id="miniView">View cart</button><button class="btn" id="miniCheckout">Checkout</button></div>` : '';
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
  $('#cartList').innerHTML = cart.length ? cart.map(i => {
    const p = product(i.id);
    return `<div class="cl-item">
      <img src="${esc(p.img)}" alt="">
      <div><h4>${esc(p.name)}</h4><p class="cat-name">${esc(CATS[p.cat] || '')}</p>
        <div class="qty"><button data-a="dec" data-id="${p.id}" aria-label="Decrease">&minus;</button><span>${i.qty}</span><button data-a="inc" data-id="${p.id}" aria-label="Increase">+</button></div></div>
      <div class="cl-right"><strong>${money(p.price * i.qty)}</strong><button class="rm" data-a="rm" data-id="${p.id}">Remove</button></div>
    </div>`;
  }).join('') : '<div class="cl-empty"><p>Your cart is empty.</p></div>';
  $('#cartSummary').innerHTML = cart.length ? `
    <h3>Order summary</h3>
    <div class="sum-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
    <div class="sum-row"><span>Shipping</span><span>${t.shipping ? money(t.shipping) : 'Free'}</span></div>
    ${t.shipping ? `<p class="ship">Add ${money(SHIPPING.freeFrom - t.subtotal)} more for free shipping.</p>` : ''}
    <div class="sum-row total"><span>Total</span><strong>${money(t.total)}</strong></div>
    <button class="btn full" id="checkoutBtn">Checkout <b>&rarr;</b></button>
    <p class="ship">An account is required to place an order.</p>` : '';
  $('#cartSummary').style.display = cart.length ? '' : 'none';
  if ($('#miniCart') && !$('#miniCart').hidden) renderMini();   // keep the pop-up in sync
}
$('#cartList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = +b.dataset.id, cart = Cart.get(), row = cart.find(i => i.id === id); if (!row) return;
  if (b.dataset.a === 'inc') { if (row.qty >= stockOf(product(id))) return toast('Only ' + row.qty + ' in stock'); row.qty++; }
  if (b.dataset.a === 'dec') row.qty--;
  Cart.set(b.dataset.a === 'rm' || row.qty < 1 ? cart.filter(i => i.id !== id) : cart);
  renderCart();
});
$('#cartBtn').addEventListener('click', () => goTo('#cart'));

/* ---------- Checkout pop-up: account is mandatory before payment ---------- */
$('#cartSummary').addEventListener('click', e => { if (e.target.closest('#checkoutBtn')) startCheckout(); });
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
    <div class="pop-items">${cart.map(i => `<div class="sum-row"><span>${esc(product(i.id).name)} × ${i.qty}</span><span>${money(product(i.id).price * i.qty)}</span></div>`).join('')}
      <div class="sum-row"><span>Shipping</span><span>${t.shipping ? money(t.shipping) : 'Free'}</span></div>
      <div class="sum-row total"><span>Total</span><strong>${money(t.total)}</strong></div></div>
    <a class="btn full" href="payment.html">Continue to Payment <b>&rarr;</b></a>
    <button class="btn ghost full" id="popKeep">Keep shopping</button>`);
  $('#popKeep').addEventListener('click', Modal.close);
}

/* ---------- Enquiry form (goes to the admin) ---------- */
$('#enquiryForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f)), note = $('#formNote');
  let ok = true;
  ['name', 'email', 'phone', 'message'].forEach(k => {
    const bad = !d[k].trim() || (k === 'email' && !/^\S+@\S+\.\S+$/.test(d[k]));
    f.elements[k].classList.toggle('invalid', bad); if (bad) ok = false;
  });
  if (!ok) { note.className = 'note err'; note.textContent = 'Please complete the highlighted fields.'; return; }
  try {
    await api('/enquiries', { method: 'POST', body: d });
    note.className = 'note'; note.textContent = 'Thank you – our team will contact you shortly.'; f.reset();
  } catch (err) { note.className = 'note err'; note.textContent = err.message; }
});

/* ---------- Start ---------- */
$('#burger').addEventListener('click', () => $('.header').classList.toggle('menu'));
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
    $$('#shipNoteTop').forEach(e => { e.textContent = `Free shipping on orders above ${SHIPPING.freeFrom} QAR`; });
  } catch {   // server not running: still show the whole catalogue (browse only)
    OFFLINE = true; PRODUCTS = FALLBACK.products; CATS = FALLBACK.cats; showServerDown();
  }
  renderFilters(); renderProducts(); renderCart(); spy();
  if (p.get('login') && !state.user) openAuth('login', { reason: 'Please sign in to continue.', next: () => { if (p.get('next') === 'payment') location.href = 'payment.html'; } });
  if (p.get('search')) openSearch();   // arrived from the "Search" link on another page
  if (location.hash && $(location.hash)) setTimeout(() => goTo(location.hash), 300);
})();


