/* =====================================================================
   LOFAN – payment page
   Step 1  delivery details  ->  order is created (stock reserved)
   Step 2  choose IBAN / Fawran / Ooredoo Money, pay, enter reference
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
        ${items.map(i => `<div class="sum-row"><span>${esc(i.p.name)} × ${i.qty}</span><span>${money(i.p.price * i.qty)}</span></div>`).join('')}
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
    $('#locInfo').innerHTML = loc ? `<p class="loc-ok">✓ Location captured${loc.acc ? ` (accurate to about ${loc.acc} m)` : ''} ·
      <a class="ulink" target="_blank" rel="noopener" href="${mapsLink(loc.lat, loc.lng)}">check it on Google Maps</a> · <button type="button" class="ulink" id="locRemove">Remove</button></p>${mapEmbed(loc.lat, loc.lng, 170)}` : '';
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
const copyBtn = v => `<button type="button" class="copy" data-copy="${esc(v)}">Copy</button>`;
async function stepPay() {
  setStep(2);
  if (!info) info = await api('/payment-info');
  if (!info.methods.length) {
    view.innerHTML = `<div class="gate"><p>Online payment details are not available yet. Your order <strong>${order.id}</strong> is saved – please contact us on <strong>${esc(info.company.phone)}</strong> to arrange payment.</p><a class="btn" href="account.html#orders">My Orders</a></div>`;
    return;
  }
  view.innerHTML = `
  <div class="pay-head">
    <div><span class="muted small">Order</span><strong>${order.id}</strong></div>
    <div><span class="muted small">Amount to pay</span><strong class="amt">${money(order.total)}</strong></div>
    <div><span class="muted small">Pay to</span><strong>${esc(info.company.name)}</strong>${info.company.crNumber ? `<small class="muted"> CR ${esc(info.company.crNumber)}</small>` : ''}</div>
  </div>
  <form id="payForm" class="co-grid" novalidate>
    <div class="co-col">
      <h3>1. Choose how to pay</h3>
      <div class="pay-opts">${info.methods.map((m, i) => `<label class="pay-opt"><input type="radio" name="method" value="${m.id}" ${i ? '' : 'checked'}><span>${esc(m.label)}</span></label>`).join('')}</div>
      ${info.methods.map((m, i) => m.wallet ? `
        <div class="pay-panel" data-pay="${m.id}" ${i ? 'hidden' : ''}>
          <p class="muted small">${esc(m.hint)}</p>
          <div class="wallet-box">
            ${applePayOK()
              ? `<button type="button" class="apple-pay-btn" id="apBtn" aria-label="Pay with Apple Pay"></button>
                 <p class="muted small center">Total <strong>${money(order.total)}</strong> · you will confirm with Face ID / Touch ID.</p>`
              : `<p class="wallet-note">Apple Pay works on <strong>Safari</strong> on iPhone, iPad or Mac with a card in Apple Wallet. Please open this page there, or choose another payment method.</p>`}
            <p class="note" id="apNote"></p>
          </div>
        </div>` : `
        <div class="pay-panel" data-pay="${m.id}" ${i ? 'hidden' : ''}>
          <p class="muted small">${esc(m.hint)}</p>
          <div class="bank">
            ${m.details.map(([k, v]) => `<div class="bank-row"><span>${esc(k)}</span><strong>${esc(v)}</strong>${copyBtn(v)}</div>`).join('')}
            <div class="bank-row"><span>Amount</span><strong>${money(order.total)}</strong>${copyBtn(order.total)}</div>
            <div class="bank-row ref"><span>Payment reference</span><strong>${order.id}</strong>${copyBtn(order.id)}</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="co-col" id="manualPay" ${info.methods[0].wallet ? 'hidden' : ''}>
      <h3>2. Confirm your payment</h3>
      <p class="muted small">After sending the money, enter the transaction number shown on your bank / Ooredoo Money receipt so we can verify it quickly.</p>
      <label>Transaction / reference number<input name="txn" placeholder="e.g. FT26279XXXXX" required></label>
      <label>Upload receipt screenshot (optional – image or PDF, max 1.4 MB)<input type="file" name="receipt" accept="image/*,.pdf"></label>
      <button class="btn full" type="submit">I have paid – Submit <b>&rarr;</b></button>
      <p class="note" id="payNote"></p>
      <p class="muted small center"><button type="button" class="ulink" id="cancelOrder">Cancel this order</button></p>
    </div>
  </form>`;
  $('#payForm').addEventListener('change', e => {
    if (e.target.name !== 'method') return;
    $$('.pay-panel').forEach(p => { p.hidden = p.dataset.pay !== e.target.value; });
    $('#manualPay').hidden = !!(info.methods.find(m => m.id === e.target.value) || {}).wallet;   // wallets pay instantly – no receipt needed
  });
  const ap = $('#apBtn'); if (ap) ap.addEventListener('click', startApplePay);
  view.addEventListener('click', e => {
    const c = e.target.closest('.copy');
    if (c) navigator.clipboard?.writeText(c.dataset.copy).then(() => toast('Copied'), () => toast('Copy failed'));
  });
  $('#cancelOrder').addEventListener('click', async () => {
    if (!confirm('Cancel this order?')) return;
    try { await api(`/orders/${order.id}/cancel`, { method: 'POST' }); toast('Order cancelled'); location.href = 'account.html#orders'; } catch (err) { toast(err.message); }
  });
  $('#payForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, v = Object.fromEntries(new FormData(f)), note = $('#payNote'), btn = $('button[type=submit]', f);
    note.className = 'note';
    if (v.txn.trim().length < 4) return fail(note, 'Please enter the transaction / reference number.');
    let receipt = null; const file = f.elements.receipt.files[0];
    if (file) {
      if (file.size > 1_400_000) return fail(note, 'Receipt is too large (max 1.4 MB).');
      receipt = { name: file.name, data: await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); }) };
    }
    btn.disabled = true;
    try {
      const r = await api(`/orders/${order.id}/payment`, { method: 'POST', body: { method: v.method, txn: v.txn.trim(), receipt } });
      order = r.order; stepDone();
    } catch (err) { fail(note, err.message); btn.disabled = false; }
  });
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
function stepDone() {
  setStep(3);
  view.innerHTML = `<div class="done">
    <div class="tick">&#10003;</div>
    <h3>Thank you, ${esc(order.delivery.name)}!</h3>
    ${order.status === 'Payment confirmed'
      ? `<p>Your payment for order <strong>${order.id}</strong> (<strong>${money(order.total)}</strong> via ${esc(order.method || '')}) was received and <strong>confirmed</strong>. We are getting your order ready.</p>`
      : `<p>Your payment for order <strong>${order.id}</strong> (<strong>${money(order.total)}</strong> via ${esc(order.method || '')}) has been submitted. Our team has been notified and will verify it shortly.</p>`}
    <p class="muted small">You can follow every step of your order in <strong>My Account &rarr; My Orders</strong>.</p>
    <div class="done-btns"><a class="btn" href="account.html#orders">Track My Order</a><a class="btn ghost" href="index.html#shop">Continue Shopping</a></div></div>`;
}

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
