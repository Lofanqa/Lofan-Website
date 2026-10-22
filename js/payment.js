/* =====================================================================
   LOFAN – payment page
   Step 1  delivery details  ->  order is created (stock reserved)
   Step 2  choose Apple Pay or SkipCash and pay on the secure page
   Step 3  confirmation (admin is notified instantly)
   ===================================================================== */
$('#year').textContent = new Date().getFullYear();
const view = $('#view');
let order = null, info = null;

function setStep(n) { $$('#steps li').forEach(li => li.classList.toggle('on', +li.dataset.s <= n)); }
const fail = (el, m) => { el.textContent = m; el.classList.add('err'); };

/* ---------- Step 1: delivery ---------- */
async function stepDelivery() {
  setStep(1);
  const cartRaw = Cart.get();
  if (!cartRaw.length) { view.innerHTML = '<div class="gate"><p>Your cart is empty.</p><a class="btn" href="index.html#shop">Browse the collection</a></div>'; return; }
  const d = await api('/products');
  const items = cartRaw.map(i => ({ ...i, p: d.products.find(p => p.id === i.id) })).filter(i => i.p && i.p.stock > 0).map(i => ({ ...i, qty: Math.min(i.qty, i.p.stock) }));
  if (!items.length) { Cart.clear(); view.innerHTML = '<div class="gate"><p>The items in your cart are no longer available.</p><a class="btn" href="index.html#shop">Back to shop</a></div>'; return; }
  const subtotal = items.reduce((s, i) => s + i.p.price * i.qty, 0);
  const shipping = subtotal >= d.shipping.freeFrom ? 0 : d.shipping.fee, total = subtotal + shipping;
  const u = state.user;
  view.innerHTML = `
  <form id="deliveryForm" class="co-grid" novalidate>
    <div class="co-col">
      <h3>Delivery details</h3>
      <label>Full name<input name="name" value="${esc(u.name)}" required></label>
      <div class="row">
        <label>Mobile number<input name="phone" value="${esc(u.phone)}" inputmode="tel" required></label>
        <label>Email<input type="email" name="email" value="${esc(u.email)}" required></label>
      </div>
      <label>Delivery address<textarea name="address" rows="3" placeholder="Zone, street, building / villa no., area, city" required>${esc(u.address || '')}</textarea></label>
      <div class="loc-box">
        <div class="loc-head"><span class="loc-pin">📍</span><div><strong>Share my current location</strong>
          <small class="muted">Optional – helps our delivery team find your exact spot on Google Maps. It is only sent with this order.</small></div></div>
        <button type="button" class="btn ghost" id="locBtn">Share my location</button>
        <div id="locInfo"></div>
      </div>
      <label>Order notes (optional)<input name="notes" placeholder="Gift message, delivery time…"></label>
    </div>
    <div class="co-col">
      <h3>Your order</h3>
      <div class="summary">
        ${items.map(i => `<div class="sum-row"><span><span>${esc(i.p.name)}</span> × ${i.qty}</span><span>${money(i.p.price * i.qty)}</span></div>`).join('')}
        <div class="sum-row"><span>Shipping</span><span>${shipping ? money(shipping) : 'Free'}</span></div>
        <div class="sum-row total"><span>Total</span><strong>${money(total)}</strong></div>
      </div>
      <button class="btn full" type="submit">Continue to Payment <b>&rarr;</b></button>
      <p class="note" id="deliveryNote"></p>
      <p class="muted small center"><a class="ulink" href="index.html#cart">&larr; Edit cart</a></p>
    </div>
  </form>`;
  let loc = null;   // set only when the customer presses "Share my location"
  const drawLoc = () => {
    $('#locInfo').innerHTML = loc ? `<p class="loc-ok"><span>✓</span> <span>${tr('Location captured')}</span>${loc.acc ? ` · <small>${tr('accurate to about')} ${loc.acc} m</small>` : ''} ·
      <a class="ulink" target="_blank" rel="noopener" href="${mapsLink(loc.lat, loc.lng)}">${tr('check it on Google Maps')}</a> · <button type="button" class="ulink" id="locRemove">${tr('Remove')}</button></p>${mapEmbed(loc.lat, loc.lng, 170)}` : '';
    $('#locBtn').textContent = loc ? 'Update my location' : 'Share my location';
    const rm = $('#locRemove'); if (rm) rm.addEventListener('click', () => { loc = null; drawLoc(); });
  };
  $('#locBtn').addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Finding you…';
    try { loc = await getLocation(); } catch (err) { toast(err.message); }
    b.disabled = false; drawLoc();
  });
  $('#deliveryForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, v = Object.fromEntries(new FormData(f)), note = $('#deliveryNote'), btn = $('button[type=submit]', f);
    note.className = 'note';
    if (!v.name.trim() || !v.phone.trim() || !/^\S+@\S+\.\S+$/.test(v.email) || v.address.trim().length < 5) return fail(note, 'Please complete all delivery details.');
    if (loc) Object.assign(v, { lat: loc.lat, lng: loc.lng, acc: loc.acc });
    btn.disabled = true;
    try {
      const r = await api('/orders', { method: 'POST', body: { items: items.map(i => ({ id: i.id, qty: i.qty })), delivery: v } });
      Cart.clear(); order = r.order;
      history.replaceState(null, '', 'payment.html?order=' + order.id);
      stepPay();
    } catch (err) { fail(note, err.message); btn.disabled = false; }
  });
}

/* ---------- Step 2: pay ---------- */
async function stepPay() {
  setStep(2);
  if (!info) info = await api('/payment-info');
  if (!info.methods.length) {
    view.innerHTML = `<div class="gate"><p>${tr('Online payment details are not available yet. Your order {id} is saved – please contact us on {phone} to arrange payment.', { id: `<strong>${order.id}</strong>`, phone: `<strong>${esc(info.company.phone)}</strong>` })}</p><a class="btn" href="account.html#orders">${tr('My Orders')}</a></div>`;
    return;
  }
  view.innerHTML = `
  <div class="pay-head">
    <div><span class="muted small">Order</span><strong>${order.id}</strong></div>
    <div><span class="muted small">Amount to pay</span><strong class="amt">${money(order.total)}</strong></div>
    <div><span class="muted small">Pay to</span><strong>${esc(info.company.name)}</strong></div>
  </div>
  <p class="gate-note">Your items are reserved for you. Choose how you would like to pay.</p>
  ${new URLSearchParams(location.search).get('failed') === '1' ? '<p class="gate-note err-note">The payment was not completed, so nothing was charged. Your items are still reserved for you – you can try again.</p>' : ''}
  <div class="pay-choice">
    ${info.methods.map(m => m.wallet ? `
      <div class="pay-card">
        <h3>${esc(m.label)}</h3>
        <p class="muted small">${esc(m.hint)}</p>
        ${applePayOK()
          ? `<button type="button" class="apple-pay-btn" id="apBtn" aria-label="Pay with Apple Pay"></button>
             <p class="muted small center">Total <strong>${money(order.total)}</strong> · you will confirm with Face ID / Touch ID.</p>`
          : `<p class="wallet-note">Apple Pay works on <strong>Safari</strong> on iPhone, iPad or Mac with a card in Apple Wallet. Please open this page there, or pay with SkipCash.</p>`}
        <p class="note" id="apNote"></p>
      </div>` : `
      <div class="pay-card">
        <h3>${esc(m.label)}</h3>
        <p class="muted small">${esc(m.hint)}</p>
        <button type="button" class="btn full" id="scBtn">${esc(tr('Pay {amount} with SkipCash', { amount: money(order.total) }))} <b>&rarr;</b></button>
        <p class="note" id="scNote"></p>
      </div>`).join('')}
  </div>
  <p class="muted small center"><button type="button" class="ulink" id="cancelOrder">Cancel this order</button></p>`;
  const ap = $('#apBtn'); if (ap) ap.addEventListener('click', startApplePay);
  const sc = $('#scBtn'); if (sc) sc.addEventListener('click', startSkipCash);
  $('#cancelOrder').addEventListener('click', async () => {
    if (!confirm(tr('Cancel this order?'))) return;
    try { await api(`/orders/${order.id}/cancel`, { method: 'POST' }); toast('Order cancelled'); location.href = 'account.html#orders'; } catch (err) { toast(err.message); }
  });
}
/* ---------- SkipCash: the server opens SkipCash's secure payment page; the customer pays there ---------- */
async function startSkipCash() {
  const note = $('#scNote'), b = $('#scBtn');
  note.className = 'note'; note.textContent = '';
  b.disabled = true; b.textContent = 'Opening the secure payment page…';
  try {
    const r = await api(`/orders/${order.id}/skipcash/start`, { method: 'POST' });
    location.href = r.url;                                     // leaves this website for SkipCash's page
  } catch (err) {
    note.className = 'note err'; note.textContent = err.message;
    b.disabled = false; b.innerHTML = `${esc(tr('Pay {amount} with SkipCash', { amount: money(order.total) }))} <b>&rarr;</b>`;
  }
}

/* ---------- Apple Pay (Safari on iPhone / iPad / Mac with a card in Wallet) ---------- */
function applePayOK() {
  try { return !!(window.ApplePaySession && ApplePaySession.canMakePayments()); } catch { return false; }
}
function startApplePay() {
  const m = info.methods.find(x => x.id === 'applepay'), note = $('#apNote');
  note.className = 'note'; note.textContent = '';
  const session = new ApplePaySession(3, {
    countryCode: m.applepay.countryCode, currencyCode: m.applepay.currencyCode,
    supportedNetworks: ['visa', 'masterCard', 'amex'], merchantCapabilities: ['supports3DS'],
    total: { label: m.applepay.displayName, amount: Number(order.total).toFixed(2) }
  });
  session.onvalidatemerchant = async ev => {       // our server proves to Apple that this shop owns the Merchant ID
    try {
      const ms = await api(`/orders/${order.id}/applepay/session`, { method: 'POST', body: { validationURL: ev.validationURL } });
      session.completeMerchantValidation(ms);
    } catch (err) { session.abort(); fail(note, err.message); }
  };
  session.onpaymentauthorized = async ev => {      // the encrypted card token is charged by the payment provider, server-side
    try {
      const r = await api(`/orders/${order.id}/applepay/pay`, { method: 'POST', body: { token: ev.payment.token.paymentData } });
      session.completePayment(ApplePaySession.STATUS_SUCCESS);
      order = r.order; stepDone();
    } catch (err) { session.completePayment(ApplePaySession.STATUS_FAILURE); fail(note, err.message); }
  };
  session.begin();
}

/* ---------- Step 3: done ---------- */
/* The values for the thank-you sentences (the order number, amount and method are shown in bold) */
const doneVars = () => ({ id: `<strong>${order.id}</strong>`, amount: `<strong>${money(order.total)}</strong>`, method: esc(order.method || '') });
function stepDone() {
  setStep(3);
  view.innerHTML = `<div class="done">
    <div class="tick">&#10003;</div>
    <h3>${esc(tr('Thank you, {name}!', { name: order.delivery.name }))}</h3>
    ${order.status === 'Payment confirmed'
      ? `<p>${tr('Your payment for order {id} ({amount} via {method}) was received and confirmed. We are getting your order ready.', doneVars())}</p>`
      : `<p>${tr('We received the payment details for order {id} ({amount} via {method}).', doneVars())}</p>
         <p><strong>${tr('Your order is not confirmed yet.')}</strong> ${tr('It becomes confirmed as soon as our team verifies the payment (usually within a few hours). You will see the status change in My Orders.')}</p>`}
    <p class="muted small">${tr('You can follow every step of your order in')} <strong>${tr('My Account → My Orders')}</strong>.</p>
    <div class="done-btns"><a class="btn" href="account.html#orders">Track My Order</a><a class="btn ghost" href="index.html#shop">Continue Shopping</a></div></div>`;
}

/* ---------- Language switch: the pay and thank-you steps are drawn again in the new language ---------- */
window.addEventListener('langchange', () => {
  if (!order) return;                        // the delivery step is translated in place
  if ($('.pay-choice')) stepPay();
  else if ($('.done')) stepDone();
});

/* ---------- Start ---------- */
(async function init() {
  await loadUser();
  if (!state.user) { location.replace('index.html?login=1&next=payment'); return; }
  if (state.user.role === 'admin') { view.innerHTML = '<div class="gate"><p>Please use a customer account to place orders.</p></div>'; return; }
  const id = new URLSearchParams(location.search).get('order');
  try {
    if (id) {
      order = (await api('/orders/' + encodeURIComponent(id))).order;
      if (order.status === 'Awaiting payment') return stepPay();
      if (order.status === 'Cancelled') { view.innerHTML = '<div class="gate"><p>This order was cancelled.</p><a class="btn" href="index.html#shop">Back to shop</a></div>'; return; }
      return stepDone();
    }
    await stepDelivery();
  } catch (err) { view.innerHTML = `<div class="gate"><p>${esc(err.message)}</p><a class="btn" href="index.html">Back to home</a></div>`; }
})();
