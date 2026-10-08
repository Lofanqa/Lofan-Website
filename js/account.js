/* LOFAN – customer account: orders with live status tracking + profile */
$('#year').textContent = new Date().getFullYear();
const FLOW = ['Awaiting payment', 'Payment submitted', 'Payment confirmed', 'Preparing', 'Out for delivery', 'Delivered'];
// What the customer sees: an order is only "confirmed" after the payment has been verified
const LABEL = { 'Awaiting payment': 'Not confirmed – awaiting payment', 'Payment submitted': 'Verifying your payment', 'Payment confirmed': 'Order confirmed' };
const STEP = { 'Awaiting payment': 'Awaiting payment', 'Payment submitted': 'Verifying payment', 'Payment confirmed': 'Order confirmed' };
const BLURB = {
  'Awaiting payment': 'Your order is NOT confirmed yet. Please complete the payment – the items are only reserved for you for a limited time.',
  'Payment submitted': 'We received your payment details and are verifying them. Your order will be confirmed as soon as the payment is verified.',
  'Payment confirmed': 'Order confirmed – your payment was verified. Thank you!',
  'Preparing': 'Your order is being prepared.',
  'Out for delivery': 'Your order is on its way.',
  'Delivered': 'Delivered. Enjoy!',
  'Cancelled': 'This order was cancelled.'
};
const tagClass = s => s === 'Awaiting payment' || s === 'Payment submitted' ? 'wait' : s === 'Cancelled' ? 'bad' : 'ok';

function showTab(t) {
  $$('#acctTabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#tab-orders').hidden = t !== 'orders'; $('#tab-profile').hidden = t !== 'profile';
  if (location.hash !== '#' + t) history.replaceState(null, '', '#' + t);
}
$('#acctTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
$('#logoutBtn').addEventListener('click', logout);

function progress(o) {
  if (o.status === 'Cancelled') return '';
  const idx = FLOW.indexOf(o.status);
  return `<ol class="track">${FLOW.map((s, i) => `<li class="${i <= idx ? 'done' : ''} ${i === idx ? 'now' : ''}"><i></i><span>${STEP[s] || s}</span></li>`).join('')}</ol>`;
}
async function loadOrders() {
  const { orders } = await api('/orders');
  $('#orderList').innerHTML = orders.length ? orders.map(o => `
    <article class="ord big">
      <div class="ord-top"><strong>${o.id}</strong><span class="tag ${tagClass(o.status)}">${esc(LABEL[o.status] || o.status)}</span></div>
      <p class="muted small">${fmtDate(o.created)} · ${o.items.reduce((s, i) => s + i.qty, 0)} items · <strong>${money(o.total)}</strong>${o.method ? ' · ' + esc(o.method) : ''}</p>
      <p class="small">${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join(', ')}</p>
      <p class="blurb">${BLURB[o.status] || ''}</p>
      ${progress(o)}
      ${o.status === 'Awaiting payment' ? `<div class="ord-actions"><a class="btn" href="payment.html?order=${o.id}">Complete Payment</a></div>` : ''}
      <div class="ord-actions"><button class="btn ghost" data-open-chat="Hi, about my order ${o.id}: ">Message us about this order</button></div>
      <details><summary>Order history</summary>
        <ul class="events">${o.events.slice().reverse().map(ev => `<li><strong>${esc(ev.status)}</strong>${ev.note ? ' – ' + esc(ev.note) : ''}<small>${fmtDate(ev.created)}</small></li>`).join('')}</ul>
        <p class="muted small">Deliver to: ${esc(o.delivery.name)}, ${esc(o.delivery.phone)}<br>${esc(o.delivery.address)}</p>
      </details>
    </article>`).join('') : '<div class="gate"><p>You have not placed any orders yet.</p><a class="btn" href="index.html#shop">Start shopping</a></div>';
}

$('#profileForm').addEventListener('submit', async e => {
  e.preventDefault();
  const note = $('#profileNote'); note.className = 'note';
  try {
    const r = await api('/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    state.user = r.user; updateAccountBtn(); fillProfile(); note.textContent = 'Details saved.';
  } catch (err) { note.textContent = err.message; note.classList.add('err'); }
});
$('#pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  const note = $('#pwNote'); note.className = 'note';
  try { await api('/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); note.textContent = 'Password updated.'; }
  catch (err) { note.textContent = err.message; note.classList.add('err'); }
});
function fillProfile() {
  const f = $('#profileForm'), u = state.user;
  ['name', 'phone', 'email', 'address'].forEach(k => { f.elements[k].value = u[k] || ''; });
  $('#hello').innerHTML = `Hello, <em>${esc(u.name.split(' ')[0])}</em>`;
  drawLocCard();
}

/* ---------- My location (shared with the Lofan team only when I press the button) ---------- */
function drawLocCard() {
  const u = state.user, l = u.location, card = $('#locCard');
  card.innerHTML = `
    <div class="loc-head"><span class="loc-pin">📍</span><div><h3>My location</h3>
      <small class="muted">Share your current location so our delivery team can find you on Google Maps. We only receive it when you press the button, and you can remove it any time.</small></div></div>
    ${l ? `<p class="loc-ok">✓ Saved ${fmtDate(l.at)} · <a class="ulink" target="_blank" rel="noopener" href="${mapsLink(l.lat, l.lng)}">open in Google Maps</a></p>${mapEmbed(l.lat, l.lng, 220)}` : '<p class="muted small">No location shared yet.</p>'}
    <div class="loc-btns"><button class="btn" id="locShare">${l ? 'Update my location' : 'Share my current location'}</button>${l ? '<button class="btn ghost" id="locDel">Remove my location</button>' : ''}</div>`;
  $('#locShare').addEventListener('click', async e => {
    e.currentTarget.disabled = true; toast('Finding your location…');
    try {
      const loc = await getLocation();
      state.user = (await api('/me/location', { method: 'PUT', body: { lat: loc.lat, lng: loc.lng } })).user;
      toast('Location saved and shared with Lofan');
    } catch (err) { toast(err.message); }
    drawLocCard();
  });
  const del = $('#locDel');
  if (del) del.addEventListener('click', async () => { state.user = (await api('/me/location', { method: 'DELETE' })).user; toast('Location removed'); drawLocCard(); });
}

(async function init() {
  await loadUser();
  if (!state.user) { location.replace('index.html?login=1'); return; }
  if (state.user.role === 'admin') { location.replace('admin.html'); return; }
  fillProfile();
  showTab(location.hash === '#profile' ? 'profile' : 'orders');
  try { await loadOrders(); } catch (err) { $('#orderList').innerHTML = `<p class="center muted">${esc(err.message)}</p>`; }
  setInterval(() => { if (!document.hidden && !$('#tab-orders').hidden) loadOrders().catch(() => {}); }, 15000);   // live status updates
})();

