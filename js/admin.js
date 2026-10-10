/* =====================================================================
   LOFAN – admin dashboard
   Orders, notifications (pop-up + sound), products & stock, enquiries,
   customers, company details & payment accounts (Qatar IBAN / Fawran / Ooredoo Money)
   ===================================================================== */
let tab = 'overview', lastNotif = 0, orderFilter = '';
const STATUS_ORDER = ['Awaiting payment', 'Payment submitted', 'Payment confirmed', 'Preparing', 'Out for delivery', 'Delivered', 'Cancelled'];
const tagClass = s => s === 'Awaiting payment' || s === 'Payment submitted' ? 'wait' : s === 'Cancelled' ? 'bad' : 'ok';
const ibanOk = s => {
  s = String(s || '').replace(/\s/g, '').toUpperCase();
  if (!/^QA\d{2}[A-Z]{4}[A-Z0-9]{21}$/.test(s)) return false;
  const n = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, c => c.charCodeAt(0) - 55);
  let r = 0; for (const ch of n) r = (r * 10 + +ch) % 97; return r === 1;
};

/* ---------- login / first-time setup ---------- */
async function gate() {
  await loadUser();
  if (state.user && state.user.role === 'admin') return start();
  const { hasAdmin } = await api('/admin/status');
  $('#gateBody').innerHTML = hasAdmin ? `
    <h2>Admin <em>sign in</em></h2>
    <form id="loginForm" novalidate>
      <label>Admin email<input name="id" type="email" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn full" type="submit">Sign In</button><p class="note" id="gateNote"></p>
    </form>` : `
    <h2>Create the <em>admin account</em></h2>
    <p class="muted small">First-time setup. This account manages orders, stock and company payment details. Keep the password safe.</p>
    <form id="setupForm" novalidate>
      <label>Your name<input name="name" required></label>
      <label>Admin email<input name="email" type="email" required></label>
      <label>Password (8+ characters, letters and numbers)<input name="password" type="password" autocomplete="new-password" required></label>
      <button class="btn full" type="submit">Create Admin Account</button><p class="note" id="gateNote"></p>
    </form>`;
  const note = $('#gateNote');
  const submit = (path, after) => async e => {
    e.preventDefault(); note.className = 'note';
    try {
      const r = await api(path, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      if (r.user.role !== 'admin') { await api('/logout', { method: 'POST' }); throw new Error('This account is not an admin.'); }
      state.user = r.user; start();
    } catch (err) { note.textContent = err.message; note.classList.add('err'); }
  };
  if (hasAdmin) $('#loginForm').addEventListener('submit', submit('/login'));
  else $('#setupForm').addEventListener('submit', submit('/admin/setup'));
}

function start() {
  $('#gate').hidden = true; $('#app').hidden = false;
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  $('#logout').addEventListener('click', logout);
  $('#who').textContent = `${state.user.name} · ${isOwner() ? 'Owner' : 'Staff'}`;
  $('[data-tab=settings]').hidden = !isOwner();          // company, payments and alert settings are for owners only
  poll(true); setInterval(poll, 5000);
  const first = location.hash.slice(1);
  showTab(first === 'settings' && !isOwner() ? 'overview' : (first || 'overview'));
}
const isOwner = () => state.user && state.user.adminLevel === 'owner';
function showTab(t) {
  tab = t; history.replaceState(null, '', '#' + t);
  $$('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  ({ overview: renderOverview, orders: renderOrders, notifs: renderNotifs, chats: renderChats, products: renderProducts, enquiries: renderEnquiries, customers: renderCustomers, settings: renderSettings, security: renderSecurity }[t] || renderOverview)();
}
const panel = html => { $('#panel').innerHTML = html; };

/* ---------- notifications: pop-up + sound + browser alert ---------- */
let audioCtx;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    });
  } catch { /* audio blocked */ }
}
function popup(n) {
  const el = document.createElement('div');
  el.className = 'pop ' + n.kind;
  el.innerHTML = `<button class="pop-x" aria-label="Dismiss">&times;</button><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p>
    ${n.kind === 'enquiry' ? '<button class="btn" data-enq>View enquiries</button>' : n.kind === 'chat' ? `<button class="btn" data-chatpop="${esc(n.ref)}">Open chat</button>` : `<button class="btn" data-view="${esc(n.ref)}">View order</button>`}`;
  el.addEventListener('click', e => {
    if (e.target.closest('.pop-x')) return el.remove();
    if (e.target.closest('[data-chatpop]')) { showTab('chats'); openThread(+n.ref); el.remove(); return; }
    if (e.target.closest('[data-view]')) { orderFilter = ''; showTab('orders'); setTimeout(() => { const c = $(`[data-order="${n.ref}"]`); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); } }, 400); el.remove(); }
    if (e.target.closest('[data-enq]')) { showTab('enquiries'); el.remove(); }
  });
  $('#popups').appendChild(el);
  setTimeout(() => el.remove(), 30000);
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(n.title, { body: n.body });
}
async function poll(first) {
  try {
    const d = await api('/admin/notifications?after=' + (first ? 0 : lastNotif));
    if (first) lastNotif = d.latest;
    else if (d.items.length) {
      lastNotif = d.latest;
      d.items.slice().reverse().forEach(popup); beep();
      if (tab === 'orders') renderOrders(true);
      if (tab === 'notifs') renderNotifs();
      if (tab === 'enquiries') renderEnquiries();
    }
    const b = $('#badgeNotifs'); b.hidden = !d.unread; b.textContent = d.unread;
    const cb = $('#badgeChats'); cb.hidden = !d.chatUnread; cb.textContent = d.chatUnread;
    if (tab === 'chats' && !first) refreshChat();
    document.title = (d.unread ? `(${d.unread}) ` : '') + 'Lofan Admin';
    if (first || d.items.length) updateOrderBadge();
  } catch (e) { if (e.status === 401 || e.status === 403) location.reload(); }
}
async function updateOrderBadge() {
  try {
    const { orders } = await api('/admin/orders');
    const n = orders.filter(o => o.status === 'Payment submitted').length;
    const b = $('#badgeOrders'); b.hidden = !n; b.textContent = n;
  } catch { /* ignore */ }
}

async function renderNotifs() {
  const d = await api('/admin/notifications?after=0');
  panel(`<div class="adm-save"><div><strong>${d.unread ? d.unread + ' unread' : 'All caught up'}</strong><p class="muted small">New orders, payment submissions and enquiries appear here and pop up instantly while this page is open. Remove the ones you don't need.</p></div>
    <div class="adm-btns"><button class="btn ghost" id="markRead">Mark all as read</button>
      <button class="btn ghost danger-text" id="delRead">Delete read</button><button class="btn danger" id="delAll">Delete all</button></div></div>
    ${d.recent.length ? d.recent.map(n => `<div class="ord ${n.read ? '' : 'unread'}"><div class="ord-top"><strong>${esc(n.title)}</strong>
      <span class="ord-right"><small class="muted">${fmtDate(n.created)}</small><button class="rm danger-text" data-delnotif="${n.id}" title="Delete this notification">Delete</button></span></div><p class="small">${esc(n.body)}</p></div>`).join('') : '<p class="muted">No notifications.</p>'}`);
  $('#markRead').addEventListener('click', async () => { await api('/admin/notifications/read', { method: 'POST' }); poll(); renderNotifs(); });
  const bulk = (mode, text) => async () => {
    if (!confirm(text)) return;
    const r = await api('/admin/notifications/delete', { method: 'POST', body: { mode } }); toast(`${r.deleted} notification(s) deleted`); poll(); renderNotifs();
  };
  $('#delRead').addEventListener('click', bulk('read', 'Delete all notifications you have already read?'));
  $('#delAll').addEventListener('click', bulk('all', 'Delete ALL notifications? This cannot be undone.'));
  $('#panel').onclick = async e => {
    const id = e.target.dataset.delnotif; if (!id) return;
    await api('/admin/notifications/' + id, { method: 'DELETE' }); poll(); renderNotifs();
  };
}

/* ---------- overview (dashboard summary) ---------- */
async function renderOverview() {
  const s = await api('/admin/stats');
  const max = Math.max(1, ...s.days.map(d => d.orders));
  const stat = (n, label, hint, go) => `<button class="stat ${go ? 'link' : ''}" ${go ? `data-go="${go}"` : 'disabled'}><b>${n}</b><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</button>`;
  panel(`
    <div class="stats">
      ${stat(s.toVerify, 'Payments to verify', 'customers say they have paid', 'orders|Payment submitted')}
      ${stat(s.awaitingPayment, 'Waiting for payment', 'order placed, not paid yet', 'orders|Awaiting payment')}
      ${stat(s.toDeliver, 'To prepare / deliver', 'paid orders in progress', 'orders|')}
      ${stat(s.ordersToday, 'Orders today', '', 'orders|')}
      ${stat(money(s.revenueMonth), 'Revenue this month', 'confirmed payments only', '')}
      ${stat(money(s.revenueAll), 'Revenue all time', 'confirmed payments only', '')}
      ${stat(s.customers, 'Customers', `${s.newCustomers7} new in the last 7 days`, 'customers|')}
      ${stat(s.chatUnread, 'Unread chats', '', 'chats|')}
      ${stat(s.newEnquiries, 'New enquiries', '', 'enquiries|')}
      ${stat(s.soldOut, 'Sold-out items', 'remove them under Products', 'products|')}
    </div>
    <h3>Orders – last 7 days</h3>
    <div class="bars">${s.days.map(d => `<div class="bar"><i style="height:${Math.max(4, d.orders / max * 100)}%"></i><b>${d.orders}</b><span>${d.label}</span><small>${d.revenue ? money(d.revenue) : ''}</small></div>`).join('')}</div>
    <h3>Running low on stock</h3>
    ${s.lowStock.length ? s.lowStock.map(p => `<div class="ord"><div class="ord-top"><strong>${esc(p.name)}</strong><span class="tag wait">${p.stock} left</span></div></div>`).join('') : '<p class="muted">Nothing is running low. 👍</p>'}`);
  $('#panel').onclick = e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    const [t, f] = b.dataset.go.split('|'); if (t === 'orders') orderFilter = f || '';
    showTab(t);
  };
}

/* ---------- orders ---------- */
let orderSearch = '', ordersData = null, companyInfo = null;
async function getCompany() { if (!companyInfo) companyInfo = (await api('/admin/settings')).settings.company; return companyInfo; }
const csvText = rows => '﻿' + rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
function downloadFile(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const locLine = (lat, lng, label, acc) => `<div class="loc-line">📍 <strong>${label}</strong>${acc ? ` <span class="muted">(±${acc} m)</span>` : ''} ·
  <a class="ulink" target="_blank" rel="noopener" href="${mapsLink(lat, lng)}">Open in Google Maps</a> ·
  <a class="btn small" target="_blank" rel="noopener" href="${dirLink(lat, lng)}">Get directions</a>
  <details><summary>Show map</summary>${mapEmbed(lat, lng, 220)}</details></div>`;
function orderCard(o) {
  const dl = o.delivery;
  return `
    <article class="ord big" data-order="${o.id}">
      <div class="ord-top"><strong>${o.id}</strong><span class="tag ${tagClass(o.status)}">${esc(o.status)}</span></div>
      <p class="small">${fmtDate(o.created)} · <strong>${money(o.total)}</strong> (items ${money(o.subtotal)} + shipping ${money(o.shipping)})</p>
      <p class="small">${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join(', ')}</p>
      <p class="muted small"><strong>${esc(dl.name)}</strong> · <a class="ulink" href="tel:+${esc(dl.phone)}">+${esc(dl.phone)}</a> · ${esc(dl.email)}<br>${esc(dl.address)}${dl.notes ? '<br>Note: ' + esc(dl.notes) : ''}</p>
      ${dl.lat != null ? locLine(dl.lat, dl.lng, 'Customer shared their location', dl.acc) : '<p class="muted small">📍 No location shared with this order.</p>'}
      ${o.method ? `<p class="small pay-line">Payment: <strong>${esc(o.method)}</strong> · transaction ref <strong>${esc(o.txn)}</strong> ${o.hasReceipt ? `· <a class="ulink" target="_blank" href="/api/admin/receipt/${o.id}">view receipt</a>` : ''}</p>` : '<p class="muted small">No payment submitted yet.</p>'}
      <div class="ord-contact">
        ${o.user_id ? `<button class="btn ghost" data-chat="${o.user_id}">Chat on website</button>` : ''}
        <a class="btn ghost" target="_blank" rel="noopener" href="${waLink(dl.phone, `Hello ${dl.name}, this is Lofan regarding your order ${o.id}.`)}">WhatsApp</a>
        <button class="btn ghost" data-print="${o.id}">Print invoice</button>
      </div>
      <div class="ord-actions">
        <select data-st>${STATUS_ORDER.map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <input data-note placeholder="Note to customer (optional)">
        <button class="btn" data-upd="${o.id}">Update</button>
        ${o.status === 'Payment submitted' ? `<button class="btn ghost" data-confirm="${o.id}">Confirm payment</button>` : ''}
      </div>
      <details><summary>History</summary><ul class="events">${o.events.slice().reverse().map(ev => `<li><strong>${esc(ev.status)}</strong>${ev.note ? ' – ' + esc(ev.note) : ''}<small>${fmtDate(ev.created)}</small></li>`).join('')}</ul></details>
    </article>`;
}
function drawOrderList() {
  const q = orderSearch.trim().toLowerCase();
  const list = ordersData.orders.filter(o => !q || [o.id, o.delivery.name, o.delivery.phone, o.delivery.email, o.delivery.address, o.method, o.txn].join(' ').toLowerCase().includes(q));
  $('#ordCount').textContent = `${list.length} order${list.length === 1 ? '' : 's'}`;
  $('#orderList').innerHTML = list.length ? list.map(orderCard).join('') : '<p class="muted">No orders found.</p>';
}
async function renderOrders(keep) {
  const d = await api('/admin/orders' + (orderFilter ? '?status=' + encodeURIComponent(orderFilter) : ''));
  const ae = document.activeElement;
  if (keep && ae && ae.closest('.ord-actions, .adm-save')) return;   // don't disturb typing
  ordersData = d; updateOrderBadge();
  panel(`<div class="adm-save"><div><strong id="ordCount"></strong>
    <p class="muted small">Check your bank / Fawran / Ooredoo Money statement for the payment reference and amount, then mark the payment as confirmed. Apple Pay payments confirm themselves.</p></div>
    <div class="adm-btns"><input id="orderSearch" type="search" placeholder="Search order no., name, phone…" value="${esc(orderSearch)}">
      <select id="orderFilter"><option value="">All statuses</option>${d.statuses.map(s => `<option ${s === orderFilter ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn ghost" data-export="orders">Export CSV</button></div></div>
    <div id="orderList"></div>`);
  drawOrderList();
  $('#orderFilter').addEventListener('change', e => { orderFilter = e.target.value; renderOrders(); });
  $('#orderSearch').addEventListener('input', e => { orderSearch = e.target.value; drawOrderList(); });
  $('#panel').onclick = async e => {
    const t = e.target;
    if (t.dataset.chat) { showTab('chats'); openThread(+t.dataset.chat); return; }
    if (t.dataset.print) { printInvoice(ordersData.orders.find(o => o.id === t.dataset.print)); return; }
    if (t.dataset.export) {
      downloadFile('lofan-orders.csv', csvText([['Order', 'Date', 'Status', 'Total (QAR)', 'Payment', 'Transaction ref', 'Customer', 'Mobile', 'Email', 'Address', 'Latitude', 'Longitude', 'Items']]
        .concat(ordersData.orders.map(o => [o.id, new Date(o.created * 1000).toLocaleString(), o.status, o.total, o.method || '', o.txn || '', o.delivery.name, '+' + o.delivery.phone, o.delivery.email, o.delivery.address, o.delivery.lat ?? '', o.delivery.lng ?? '', o.items.map(i => `${i.name} x${i.qty}`).join('; ')]))));
      return;
    }
    const id = t.dataset.upd || t.dataset.confirm; if (!id) return;
    const card = t.closest('.ord');
    const status = t.dataset.confirm ? 'Payment confirmed' : $('[data-st]', card).value;
    try { await api('/admin/orders/' + id, { method: 'PUT', body: { status, note: $('[data-note]', card).value } }); toast('Order updated'); renderOrders(); }
    catch (err) { toast(err.message); }
  };
}
async function printInvoice(o) {
  const co = await getCompany(), w = window.open('', '_blank');
  if (!w) return toast('Please allow pop-ups to print the invoice.');
  const rows = o.items.map(i => `<tr><td>${esc(i.name)}</td><td class="r">${i.qty}</td><td class="r">${i.price}</td><td class="r">${i.price * i.qty}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${o.id}</title>
  <style>body{font:14px/1.5 Arial,sans-serif;color:#222;max-width:760px;margin:30px auto;padding:0 20px}h1{font-size:26px;margin:0}table{width:100%;border-collapse:collapse;margin:18px 0}
  th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}.top{display:flex;justify-content:space-between;gap:20px}.muted{color:#666}.tot td{font-weight:bold;border-top:2px solid #222}
  @media print{button{display:none}}</style></head><body>
  <div class="top"><div><h1>${esc(co.name)}</h1><div class="muted">${esc(co.address)}<br>${esc(co.phone)} · ${esc(co.email)}${co.crNumber ? '<br>CR No. ' + esc(co.crNumber) : ''}</div></div>
  <div style="text-align:right"><h1>INVOICE</h1><div>${o.id}<br>${new Date(o.created * 1000).toLocaleDateString()}<br><b>${esc(o.status)}</b></div></div></div>
  <p><b>Bill / deliver to</b><br>${esc(o.delivery.name)}<br>+${esc(o.delivery.phone)} · ${esc(o.delivery.email)}<br>${esc(o.delivery.address)}</p>
  <table><tr><th>Item</th><th class="r">Qty</th><th class="r">Price (QAR)</th><th class="r">Total (QAR)</th></tr>${rows}
  <tr><td colspan="3" class="r">Subtotal</td><td class="r">${o.subtotal}</td></tr><tr><td colspan="3" class="r">Shipping</td><td class="r">${o.shipping || 'Free'}</td></tr>
  <tr class="tot"><td colspan="3" class="r">Total (QAR)</td><td class="r">${o.total}</td></tr></table>
  <p class="muted">Payment: ${esc(o.method || 'not yet received')}${o.txn ? ' · ref ' + esc(o.txn) : ''}<br>Thank you for shopping with ${esc(co.name)}.</p>
  <button onclick="print()">Print</button><script>window.onload=function(){setTimeout(function(){print()},300)}<\/script></body></html>`);
  w.document.close();
}

/* ---------- products & stock ---------- */
async function renderProducts() {
  const [d, st] = await Promise.all([api('/admin/products'), api('/admin/settings')]);
  const auto = !!(st.settings.shop || {}).autoDeleteSoldOut;
  let products = d.products; const f = { q: '', mode: '' };
  const sold = () => products.filter(p => p.stock <= 0).length, low = () => products.filter(p => p.stock > 0 && p.stock <= 5).length;
  panel(`
    <div class="adm-save"><div><strong id="prodCount"></strong><p class="muted small" id="prodSub"></p></div>
      <div class="adm-btns"><button class="btn danger" id="delSold">Delete all sold-out items</button></div></div>
    <label class="chk auto-del"><input type="checkbox" id="autoDel" ${auto ? 'checked' : ''}>
      <span><strong>Delete sold-out items automatically.</strong> As soon as an item's stock reaches 0 it is removed from the shop and from this list for good.
      (An item with stock reserved by an unpaid order is kept until that order is paid or cancelled.)</span></label>
    <h3>Add a new item</h3>
    <form id="addForm" class="adm-add" novalidate>
      <label>Item name<input name="name" required></label>
      <label>Category<select name="cat">${Object.entries(d.categories).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select></label>
      <label>Price (QAR)<input name="price" type="number" min="0" required></label>
      <label>Stock quantity<input name="stock" type="number" min="0" required></label>
      <label class="wide">Short description (optional)<input name="desc"></label>
      <label class="wide">Photo<input name="photo" type="file" accept="image/*" required></label>
      <button class="btn" type="submit">Add item</button>
    </form>
    <form id="catForm" class="adm-cat"><label>New category<input id="newCat" placeholder="e.g. Table Runners"></label><button class="btn ghost" type="submit">Add category</button></form>
    <h3>Current items</h3>
    <div class="adm-filter"><input id="prodSearch" type="search" placeholder="Search items…"><select id="prodMode"><option value="">All items</option><option value="low">Running low (5 or fewer)</option><option value="out">Sold out</option></select></div>
    <div class="adm-table">
      <div class="adm-row prod head"><span></span><span>Item</span><span>Category</span><span>Price (QAR)</span><span>Stock</span><span>Shop</span></div>
      <div id="prodRows"></div>
    </div>`);
  const drawHead = () => {
    $('#prodCount').textContent = `${products.length} item${products.length === 1 ? '' : 's'} in the shop`;
    $('#prodSub').innerHTML = `<span class="${sold() ? 'bad' : ''}">${sold()} sold out</span> · ${low()} running low – items with no stock can be deleted permanently.`;
    $('#delSold').disabled = !sold(); $('#delSold').textContent = `Delete all sold-out items (${sold()})`;
  };
  const drawRows = () => {
    const q = f.q.toLowerCase();
    const list = products.filter(p => (!q || (p.name + ' ' + (d.categories[p.cat] || '')).toLowerCase().includes(q)) && (!f.mode || (f.mode === 'out' ? p.stock <= 0 : p.stock > 0 && p.stock <= 5)));
    $('#prodRows').innerHTML = list.length ? list.map(p => `<div class="adm-row prod ${p.stock <= 0 ? 'soldrow' : ''}" data-id="${p.id}">
        <img src="${esc(p.img)}" alt=""><span><strong>${esc(p.name)}</strong><small>${esc(p.desc || '')}</small>${p.stock <= 0 ? '<em class="sold-tag">Sold out</em>' : p.stock <= 5 ? '<em class="low-tag">Low stock</em>' : ''}</span><span class="pcat">${esc(d.categories[p.cat] || p.cat)}</span>
        <label class="pf"><em>Price (QAR)</em><input type="number" min="0" data-f="price" value="${p.price}"></label>
        <label class="pf"><em>Stock</em><input type="number" min="0" data-f="stock" value="${p.stock}" class="${p.stock === 0 ? 'zero' : ''}"></label>
        <span class="vis"><input type="checkbox" data-f="active" ${p.active ? 'checked' : ''} title="Show in the shop"><em class="vtxt">Show in shop</em><button class="rm danger-text" data-del="${p.id}">Delete forever</button></span></div>`).join('')
      : '<p class="muted" style="padding:16px 0">No items match.</p>';
    drawHead();
  };
  drawRows();
  $('#prodSearch').addEventListener('input', e => { f.q = e.target.value; drawRows(); });
  $('#prodMode').addEventListener('change', e => { f.mode = e.target.value; drawRows(); });
  $('#panel').onchange = async e => {
    if (e.target.id === 'autoDel') {
      try {
        const r = await api('/admin/settings', { method: 'PUT', body: { shop: { autoDeleteSoldOut: e.target.checked } } });
        toast(e.target.checked ? (r.settings.swept ? `Auto-delete is on – ${r.settings.swept} sold-out item(s) removed` : 'Auto-delete is on') : 'Auto-delete is off');
        if (r.settings.swept) renderProducts();
      } catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
      return;
    }
    const fld = e.target.dataset.f; if (!fld) return;
    const row = e.target.closest('.adm-row'), p = products.find(x => x.id === +row.dataset.id);
    const val = fld === 'active' ? e.target.checked : Math.max(0, Math.round(+e.target.value || 0));
    try {
      const r = await api('/admin/products/' + p.id, { method: 'PUT', body: { [fld]: val } });
      p[fld] = fld === 'active' ? (val ? 1 : 0) : val;
      if (r.autoDeleted) { toast('Sold out – item deleted automatically'); renderProducts(); return; }
      toast('Saved');
      if (fld === 'stock') { e.target.classList.toggle('zero', val === 0); row.classList.toggle('soldrow', val <= 0); drawHead(); }
    } catch (err) { toast(err.message); }
  };
  $('#panel').onclick = async e => {
    const id = e.target.dataset.del;
    if (id) {
      const p = products.find(x => x.id === +id);
      if (!confirm(`Delete "${p.name}" FOREVER?\n\nIt disappears from the shop and from this list and cannot be brought back. Past orders keep their own record of it.`)) return;
      await api('/admin/products/' + id, { method: 'DELETE' }); toast('Item deleted permanently'); renderProducts(); return;
    }
    if (e.target.id === 'delSold') {
      const n = sold();
      if (!n || !confirm(`Delete ${n} sold-out item${n === 1 ? '' : 's'} FOREVER?\n\n` + products.filter(p => p.stock <= 0).map(p => '• ' + p.name).join('\n') + '\n\nThis cannot be undone.')) return;
      const r = await api('/admin/products/delete-soldout', { method: 'POST', body: {} }); toast(`${r.deleted} item(s) deleted permanently`); renderProducts();
    }
  };
  $('#catForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/admin/categories', { method: 'POST', body: { label: $('#newCat').value } }); toast('Category added'); renderProducts(); } catch (err) { toast(err.message); }
  });
  $('#addForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fm = e.target, v = Object.fromEntries(new FormData(fm)), file = fm.elements.photo.files[0], btn = $('button[type=submit]', fm);
    btn.disabled = true;
    try {
      const data = await resizeImage(file);
      await api('/admin/products', { method: 'POST', body: { name: v.name, cat: v.cat, price: v.price, stock: v.stock, desc: v.desc, image: { data } } });
      toast('Item added to the shop'); renderProducts();
    } catch (err) { toast(err.message || 'Could not add item'); btn.disabled = false; }
  });
}
async function resizeImage(file, max = 1200) {
  const bmp = await createImageBitmap(file), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

/* ---------- enquiries & customers ---------- */
async function renderEnquiries() {
  const { enquiries } = await api('/admin/enquiries');
  panel(enquiries.length ? enquiries.map(q => `<div class="ord"><div class="ord-top"><strong>${esc(q.name)}${q.company ? ' · ' + esc(q.company) : ''}</strong>
      <span class="ord-right"><select data-enq="${q.id}">${['New', 'Replied', 'Closed'].map(s => `<option ${s === q.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="rm danger-text" data-del-enq="${q.id}">Delete</button></span></div>
      <p class="small">${esc(q.type)}${q.qty ? ' · ' + esc(q.qty) : ''} · ${fmtDate(q.created)}</p><p>${esc(q.message)}</p>
      <p class="muted small">${esc(q.email)} · <a class="ulink" href="tel:${esc(q.phone)}">${esc(q.phone)}</a></p></div>`).join('') : '<p class="muted">No enquiries yet.</p>');
  $('#panel').onchange = async e => { if (e.target.dataset.enq) { await api('/admin/enquiries/' + e.target.dataset.enq, { method: 'PUT', body: { status: e.target.value } }); toast('Updated'); } };
  $('#panel').onclick = async e => {
    const id = e.target.dataset.delEnq; if (!id) return;
    if (!confirm('Delete this enquiry and the contact details in it permanently?')) return;
    await api('/admin/enquiries/' + id, { method: 'DELETE' }); toast('Enquiry deleted'); renderEnquiries();
  };
}

let customersData = [], customerSearch = '';
function customerCard(c) {
  return `
    <article class="ord cust-card" data-cust="${c.id}">
      <div class="ord-top"><strong>${esc(c.name)}</strong><span class="muted small">Joined ${fmtDate(c.created)}</span></div>
      <p class="small">${c.phone ? '<a class="ulink" href="tel:+' + esc(c.phone) + '">+' + esc(c.phone) + '</a>' : 'No mobile yet'} · ${esc(c.email)}</p>
      <p class="muted small">${c.address ? esc(c.address) : 'No address saved'}</p>
      ${c.lat != null ? locLine(c.lat, c.lng, `Shared location · ${fmtDate(c.loc_at)}`) : '<p class="muted small">📍 No location shared.</p>'}
      <p class="small"><strong>${c.orders}</strong> order${c.orders === 1 ? '' : 's'}${c.openOrders ? ` (<b>${c.openOrders}</b> in progress)` : ''} · <strong>${money(c.spent)}</strong> spent</p>
      <div class="ord-contact">
        <button class="btn ghost" data-chat="${c.id}">Chat on website</button>
        ${c.phone ? `<a class="btn ghost" target="_blank" rel="noopener" href="${waLink(c.phone, `Hello ${c.name}, this is Lofan.`)}">WhatsApp</a>` : ''}
        ${isOwner() ? `<button class="btn ghost danger-text" data-delcust="${c.id}">Delete customer</button>` : ''}
      </div>
    </article>`;
}
function drawCustomers() {
  const q = customerSearch.trim().toLowerCase();
  const list = customersData.filter(c => !q || [c.name, c.email, c.phone, c.address].join(' ').toLowerCase().includes(q));
  $('#custCount').textContent = `${list.length} customer${list.length === 1 ? '' : 's'}`;
  $('#custList').innerHTML = list.length ? list.map(customerCard).join('') : '<p class="muted">No customers found.</p>';
}
async function renderCustomers() {
  customersData = (await api('/admin/customers')).customers;
  panel(`<div class="adm-save"><div><strong id="custCount"></strong><p class="muted small">Delete a customer to erase their contact details permanently.</p></div>
    <div class="adm-btns"><input id="custSearch" type="search" placeholder="Search name, phone, email…" value="${esc(customerSearch)}"><button class="btn ghost" data-export="customers">Export CSV</button></div></div>
    <div id="custList"></div>`);
  drawCustomers();
  $('#custSearch').addEventListener('input', e => { customerSearch = e.target.value; drawCustomers(); });
  $('#panel').onclick = e => {
    const t = e.target;
    if (t.dataset.chat) { showTab('chats'); openThread(+t.dataset.chat); }
    if (t.dataset.delcust) confirmDeleteCustomer(customersData.find(c => c.id === +t.dataset.delcust));
    if (t.dataset.export) downloadFile('lofan-customers.csv', csvText([['Name', 'Mobile', 'Email', 'Address', 'Orders', 'Spent (QAR)', 'Latitude', 'Longitude', 'Joined']]
      .concat(customersData.map(c => [c.name, c.phone ? '+' + c.phone : '', c.email, c.address, c.orders, c.spent, c.lat ?? '', c.lng ?? '', new Date(c.created * 1000).toLocaleDateString()]))));
  };
}
function confirmDeleteCustomer(c) {
  Modal.open(`
    <h2>Delete <em>${esc(c.name)}</em>?</h2>
    <p class="gate-note">This permanently erases their account and contact details (mobile, email, address, shared location) and their chat history. <strong>It cannot be undone.</strong></p>
    ${c.orders ? `<div class="del-orders"><p><strong>${c.orders} order${c.orders === 1 ? '' : 's'}</strong>${c.openOrders ? ` – <b class="bad">${c.openOrders} not finished yet</b>` : ''}. What should happen to them?</p>
      <label class="chk"><input type="radio" name="ordmode" value="keep" checked> <span>Keep the order records for my accounts (they stay under Orders, no longer linked to a customer account)</span></label>
      <label class="chk"><input type="radio" name="ordmode" value="delete"> <span>Delete their orders and receipts too (unpaid orders put their items back in stock)</span></label></div>` : ''}
    <button class="btn danger full" id="confirmDel">Delete permanently</button>
    <button class="btn ghost full" id="cancelDel">Cancel</button>`);
  $('#cancelDel').addEventListener('click', Modal.close);
  $('#confirmDel').addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true;
    const mode = ($('input[name=ordmode]:checked') || {}).value || 'keep';
    try {
      const r = await api(`/admin/customers/${c.id}?orders=${mode}`, { method: 'DELETE' });
      Modal.close(); toast(r.ordersDeleted ? `Customer and ${r.ordersDeleted} order(s) deleted` : 'Customer deleted permanently');
      renderCustomers(); poll();
    } catch (err) { toast(err.message); btn.disabled = false; }
  });
}

/* ---------- chat with customers (website chat + WhatsApp) ---------- */
const waLink = (phone, text) => `https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
let chatUid = null, chatLast = 0;
const msgX = m => `<button class="msg-x" data-delmsg="${m.id}" title="Delete this message" aria-label="Delete this message">&times;</button>`;
const bubble = m => m.loc
  ? `<div class="msg ${m.sender === 'admin' ? 'me' : 'them'} loc" data-mid="${m.id}">${msgX(m)}<p>📍 Shared location</p><a href="${mapsLink(m.loc.lat, m.loc.lng)}" target="_blank" rel="noopener">Open in Google Maps</a> <a class="btn small" href="${dirLink(m.loc.lat, m.loc.lng)}" target="_blank" rel="noopener">Get directions</a><small>${fmtDate(m.created)}</small></div>`
  : `<div class="msg ${m.sender === 'admin' ? 'me' : 'them'}" data-mid="${m.id}">${msgX(m)}<p>${esc(m.body)}</p><small>${fmtDate(m.created)}</small></div>`;
async function renderChats() {
  const { threads } = await api('/admin/chats');
  panel(`<div class="chat-admin">
    <aside class="chat-list" id="threadList"></aside>
    <section class="chat-pane" id="chatPane"><p class="muted center">Select a customer on the left, or start a chat from the Orders / Customers tab.</p></section></div>`);
  drawThreads(threads);
  $('#threadList').onclick = e => { const t = e.target.closest('[data-uid]'); if (t) openThread(+t.dataset.uid); };
  if (chatUid) openThread(chatUid);
}
function drawThreads(threads) {
  const el = $('#threadList'); if (!el) return;
  el.innerHTML = threads.length ? threads.map(t => `<button class="thread ${t.id === chatUid ? 'on' : ''}" data-uid="${t.id}">
      <strong>${esc(t.name)}</strong>${t.unread ? `<b class="badge">${t.unread}</b>` : ''}
      <small>${/^\[loc:/.test(t.last || '') ? '📍 Shared location' : esc((t.last || '').slice(0, 60))}</small></button>`).join('') : '<p class="muted small">No conversations yet.</p>';
}
async function openThread(uid) {
  chatUid = uid; chatLast = 0;
  try {
    const d = await api(`/admin/chats/${uid}`);
    const c = d.customer;
    if (!$('#chatPane')) { await renderChats(); return; }
    $('#chatPane').innerHTML = `
      <div class="chat-head"><div><strong>${esc(c.name)}</strong><small class="muted"> ${c.phone ? '+' + esc(c.phone) : ''} ${esc(c.email)}</small></div>
        <span class="chat-head-btns">${c.lat != null ? `<a class="btn ghost" target="_blank" rel="noopener" href="${dirLink(c.lat, c.lng)}">📍 Directions</a>` : ''}${c.phone ? `<a class="btn ghost" target="_blank" rel="noopener" href="${waLink(c.phone, `Hello ${c.name}, this is Lofan.`)}">Open WhatsApp</a>` : ''}<button class="btn ghost danger-text" data-clearchat="${c.id}">Clear chat</button></span></div>
      <div class="chat-body" id="adminChatBody">${d.messages.length ? d.messages.map(bubble).join('') : '<p class="chat-empty">No messages yet. Say hello below.</p>'}</div>
      <form id="adminChatForm"><input id="adminChatInput" placeholder="Reply to ${esc(c.name.split(' ')[0])}…" autocomplete="off" maxlength="1000"><button class="btn" type="submit">Send</button></form>`;
    if (d.messages.length) chatLast = d.messages[d.messages.length - 1].id;
    const body = $('#adminChatBody'); body.scrollTop = body.scrollHeight;
    $('#chatPane').onclick = async e => {                 // delete one message, or clear the whole conversation
      const one = e.target.closest('[data-delmsg]'), all = e.target.closest('[data-clearchat]');
      try {
        if (one) { await api(`/admin/chats/${uid}/messages/${one.dataset.delmsg}`, { method: 'DELETE' }); one.closest('.msg').remove(); poll(); }
        if (all && confirm('Delete the whole conversation with this customer? This cannot be undone.')) {
          await api(`/admin/chats/${uid}`, { method: 'DELETE' }); toast('Conversation cleared'); chatUid = null; poll(); renderChats();
        }
      } catch (err) { toast(err.message); }
    };
    $('#adminChatForm').onsubmit = async e => {
      e.preventDefault();
      const input = $('#adminChatInput'), text = input.value.trim(); if (!text) return;
      input.value = '';
      try { const r = await api(`/admin/chats/${uid}`, { method: 'POST', body: { body: text } }); appendMsgs([r.message]); }
      catch (err) { input.value = text; toast(err.message); }
    };
    $('#adminChatInput').focus();
    const { threads } = await api('/admin/chats'); drawThreads(threads); poll();
  } catch (err) { toast(err.message); }
}
function appendMsgs(list) {
  const body = $('#adminChatBody'); if (!body || !list.length) return;
  const stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
  const hint = $('.chat-empty', body); if (hint) hint.remove();
  body.insertAdjacentHTML('beforeend', list.map(bubble).join(''));
  chatLast = list[list.length - 1].id; if (stick) body.scrollTop = body.scrollHeight;
}
async function refreshChat() {
  try {
    const { threads } = await api('/admin/chats'); drawThreads(threads);
    if (chatUid && $('#adminChatBody')) { const d = await api(`/admin/chats/${chatUid}?after=${chatLast}`); appendMsgs(d.messages); }
  } catch { /* ignore */ }
}
setInterval(() => { if (tab === 'chats' && !document.hidden) refreshChat(); }, 4000);

/* ---------- company & payment settings (Qatar) ---------- */
async function renderSettings() {
  if (!isOwner()) { panel('<p class="muted">Only owner accounts can change company, payment and alert settings.</p>'); return; }
  const { settings: s } = await api('/admin/settings');
  const c = s.company, ib = s.payments.iban, fw = s.payments.fawran, oo = s.payments.ooredoo, sh = s.shipping;
  const v = x => esc(x ?? '');
  panel(`
  <form id="setForm" novalidate>
    <div class="set-warn" id="setWarn" ${ibanOk(ib.iban) ? 'hidden' : ''}>Your bank (IBAN) details are not set yet, so customers cannot see the bank-transfer option. Enter your company's Qatar IBAN below.</div>

    <h3>Company details</h3>
    <div class="set-grid">
      <label>Company name<input name="company.name" value="${v(c.name)}"></label>
      <label>Commercial Registration (CR) no.<input name="company.crNumber" value="${v(c.crNumber)}" placeholder="e.g. 123456"></label>
      <label>Address<input name="company.address" value="${v(c.address)}"></label>
      <label>Phone<input name="company.phone" value="${v(c.phone)}" placeholder="+974 5555 1234"></label>
      <label>Email<input name="company.email" value="${v(c.email)}"></label>
      <label>WhatsApp (digits, with 974)<input name="company.whatsapp" value="${v(c.whatsapp)}"></label>
    </div>

    <h3>Bank transfer – Qatar (IBAN)</h3>
    <label class="chk"><input type="checkbox" name="payments.iban.enabled" ${ib.enabled ? 'checked' : ''}> Offer bank transfer to customers</label>
    <div class="set-grid">
      <label>Bank name<input name="payments.iban.bankName" value="${v(ib.bankName)}" placeholder="e.g. your bank's registered name"></label>
      <label>Account holder name<input name="payments.iban.accountName" value="${v(ib.accountName)}"></label>
      <label>Account number<input name="payments.iban.accountNumber" value="${v(ib.accountNumber)}"></label>
      <label>IBAN (Qatar – 29 characters, starts with QA)<input name="payments.iban.iban" id="ibanInput" value="${v(ib.iban)}" placeholder="QA00 XXXX 0000 0000 0000 0000 0000 0"><small id="ibanHint" class="hint"></small></label>
      <label>SWIFT / BIC<input name="payments.iban.swift" value="${v(ib.swift)}" placeholder="XXXXQAQA"></label>
      <label>Branch<input name="payments.iban.branch" value="${v(ib.branch)}"></label>
    </div>

    <h3>Fawran (Qatar instant payments)</h3>
    <label class="chk"><input type="checkbox" name="payments.fawran.enabled" ${fw.enabled ? 'checked' : ''}> Offer Fawran</label>
    <div class="set-grid">
      <label>Fawran alias – mobile number or IBAN<input name="payments.fawran.alias" value="${v(fw.alias)}" placeholder="5555 1234"></label>
      <label>Account name<input name="payments.fawran.accountName" value="${v(fw.accountName)}"></label>
      <label>Bank<input name="payments.fawran.bankName" value="${v(fw.bankName)}"></label>
    </div>

    <h3>Ooredoo Money</h3>
    <label class="chk"><input type="checkbox" name="payments.ooredoo.enabled" ${oo.enabled ? 'checked' : ''}> Offer Ooredoo Money</label>
    <div class="set-grid">
      <label>Ooredoo Money number (8 digits)<input name="payments.ooredoo.number" value="${v(oo.number)}" placeholder="5555 1234"></label>
      <label>Account name<input name="payments.ooredoo.accountName" value="${v(oo.accountName)}"></label>
    </div>

    <h3>Google sign-in</h3>
    <p class="muted small">Lets customers create an account and sign in with their Google account. Create a free <strong>OAuth Client ID (Web application)</strong> at console.cloud.google.com → APIs &amp; Services → Credentials, add <code>${esc(location.origin)}</code> under <em>Authorised JavaScript origins</em>, then paste the Client ID here. See README.txt for the steps.</p>
    <div class="set-grid">
      <label>Google Client ID<input name="google.clientId" value="${v((s.google || {}).clientId)}" placeholder="1234567890-abc123.apps.googleusercontent.com"></label>
    </div>

    <h3>Apple Pay</h3>
    ${(() => {
      const a = s.applepay || {}, miss = a.missing || [];
      return `<div class="${miss.length ? 'set-warn' : 'set-ok'}">${miss.length
        ? `<strong>Apple Pay is not live yet.</strong> Still needed: ${miss.map(esc).join(', ')}. See README.txt → <em>APPLE PAY SETUP</em> for how to get each one. Apple Pay only works on a public <strong>https://</strong> domain.`
        : `<strong>Everything is filled in.</strong> Tick "Offer Apple Pay" and save. Test with a sandbox card in Safari on an iPhone/Mac first.`}</div>
      <label class="chk"><input type="checkbox" name="applepay.enabled" ${a.enabled ? 'checked' : ''}> Offer Apple Pay to customers</label>
      <label class="chk"><input type="checkbox" name="applepay.sandbox" ${a.sandbox !== false ? 'checked' : ''}> Test (sandbox) mode – untick only when going live</label>
      <div class="set-grid">
        <label>Apple Merchant ID<input name="applepay.merchantId" value="${v(a.merchantId)}" placeholder="merchant.com.lofan"></label>
        <label>Name shown on the Apple Pay sheet<input name="applepay.displayName" value="${v(a.displayName)}"></label>
        <label>Your website domain (no https://)<input name="applepay.domain" value="${v(a.domain)}" placeholder="lofan.qa"></label>
        <label>Payment provider (Checkout.com) – public key<input name="applepay.publicKey" value="${v(a.publicKey)}" placeholder="pk_sbox_…"></label>
        <label>Payment provider – secret key<input type="password" name="applepay.secretKey" autocomplete="new-password" placeholder="${a.hasSecret ? 'Saved – leave blank to keep' : 'sk_sbox_…'}"></label>
      </div>
      <label>Merchant identity certificate + private key (paste the PEM text) ${a.hasIdentity ? '<small class="hint good">✓ saved – paste again only to replace it</small>' : ''}
        <textarea name="applepay.identityPem" rows="4" placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----&#10;-----BEGIN PRIVATE KEY-----&#10;…&#10;-----END PRIVATE KEY-----"></textarea></label>
      <label>Domain verification file (paste the whole text Apple gives you; it is published at <code>/.well-known/apple-developer-merchantid-domain-association.txt</code>)
        <textarea name="applepay.domainFile" rows="3">${v(a.domainFile)}</textarea></label>`;
    })()}

    <h3>Shipping (QAR)</h3>
    <div class="set-grid">
      <label>Delivery fee<input type="number" min="0" name="shipping.fee" value="${sh.fee}"></label>
      <label>Free delivery from (order subtotal)<input type="number" min="0" name="shipping.freeFrom" value="${sh.freeFrom}"></label>
    </div>

    <h3>Order rules – confirming payments</h3>
    ${(() => {
      const o = s.orders || {};
      return `<p class="muted small">An order only becomes <strong>CONFIRMED</strong> after you have verified its payment (Orders → Confirm payment). Until then the customer sees "awaiting payment" and the items are only reserved.</p>
      <label class="chk"><input type="checkbox" name="orders.requireReceipt" ${o.requireReceipt !== false ? 'checked' : ''}> Customers must upload a payment receipt (screenshot) when they submit a bank / Fawran / Ooredoo payment</label>
      <div class="set-grid"><label>Release unpaid orders after (hours – 0 = never)<input type="number" min="0" max="720" name="orders.unpaidHours" value="${o.unpaidHours ?? 24}"></label></div>`;
    })()}

    <h3>Order alerts to your phone</h3>
    ${(() => {
      const al = s.alerts || {}, ev = al.events || {}, wa = al.whatsapp || {}, tg = al.telegram || {};
      return `<p class="muted small">Get a WhatsApp message on your phone for every order: item names with prices, customer name, address, time and a map link.</p>
      <p class="small"><strong>Send an alert when:</strong></p>
      <label class="chk"><input type="checkbox" name="alerts.events.placed" ${ev.placed !== false ? 'checked' : ''}> a customer places an order (not paid yet)</label>
      <label class="chk"><input type="checkbox" name="alerts.events.submitted" ${ev.submitted !== false ? 'checked' : ''}> a customer submits their payment (you need to verify it)</label>
      <label class="chk"><input type="checkbox" name="alerts.events.confirmed" ${ev.confirmed !== false ? 'checked' : ''}> an order is confirmed (payment verified / Apple Pay paid)</label>

      <h4>WhatsApp</h4>
      <div class="set-warn"><strong>One-time activation (2 minutes) – do it from the WhatsApp that should receive the alerts:</strong>
        <ol class="steps-list">
          <li>Save the number <strong>+34 644 91 07 79</strong> (CallMeBot) in your phone contacts. (If it does not work, check the current number on <a class="ulink" href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" rel="noopener">callmebot.com</a>.)</li>
          <li>In WhatsApp send that contact this exact message: <em>I allow callmebot to send me messages</em></li>
          <li>It replies with your <strong>API key</strong> (within about 2 minutes; if not, try again after 24 hours). Paste the key below.</li>
          <li>Tick "Send WhatsApp alerts", press Save, then "Send test WhatsApp".</li>
        </ol></div>
      <label class="chk"><input type="checkbox" name="alerts.whatsapp.enabled" ${wa.enabled ? 'checked' : ''}> Send WhatsApp alerts</label>
      <div class="set-grid">
        <label>WhatsApp number that receives the alerts<input name="alerts.whatsapp.number" value="${v(wa.number)}" placeholder="${v(wa.target || '+974…')}"><small class="hint muted">Leave empty to use your company WhatsApp number${wa.target ? ' (<strong>' + v(wa.target) + '</strong>)' : ''}. It must be the WhatsApp that did the activation above.</small></label>
        <label>CallMeBot API key<input type="password" name="alerts.whatsapp.apiKey" autocomplete="new-password" placeholder="${wa.hasKey ? 'Saved – leave blank to keep' : 'the key you received on WhatsApp'}"></label>
        <label>Service<select name="alerts.whatsapp.provider"><option value="callmebot" ${wa.provider !== 'webhook' ? 'selected' : ''}>CallMeBot (free, personal WhatsApp)</option><option value="webhook" ${wa.provider === 'webhook' ? 'selected' : ''}>Another WhatsApp service (web address)</option></select></label>
        <label>Web address of that service (only for "Another WhatsApp service", https://…)<input name="alerts.whatsapp.webhookUrl" value="${v(wa.webhookUrl)}" placeholder="https://…"></label>
      </div>
      <p class="muted small">CallMeBot is a free third-party service for personal use: the order details (customer name, address, items) pass through its servers, and it is not guaranteed. For a guaranteed business service use a paid WhatsApp gateway and choose "Another WhatsApp service".</p>
      <button type="button" class="btn ghost" data-test="whatsapp">Send test WhatsApp</button>

      <h4>Telegram (free)</h4>
      <p class="muted small">An optional extra: create a bot with @BotFather in Telegram, copy its token, send the bot a message, and use your chat id (e.g. from @userinfobot).</p>
      <label class="chk"><input type="checkbox" name="alerts.telegram.enabled" ${tg.enabled ? 'checked' : ''}> Send Telegram alerts</label>
      <div class="set-grid">
        <label>Bot token<input type="password" name="alerts.telegram.botToken" autocomplete="new-password" placeholder="${tg.hasToken ? 'Saved – leave blank to keep' : '123456789:AA…'}"></label>
        <label>Chat id<input name="alerts.telegram.chatId" value="${v(tg.chatId)}" placeholder="123456789"></label>
      </div>
      <button type="button" class="btn ghost" data-test="telegram">Send test Telegram</button>
      <p class="note" id="testNote"></p>`;
    })()}

    <div class="set-bar"><button class="btn" type="submit">Save Settings</button><p class="note" id="setNote"></p></div>
  </form>`);

  const hint = () => {
    const val = $('#ibanInput').value.trim(), h = $('#ibanHint');
    h.textContent = !val ? '' : ibanOk(val) ? '✓ Valid Qatar IBAN' : 'Not a valid Qatar IBAN yet (QA + 2 digits + 4-letter bank code + 21 characters)';
    h.className = 'hint ' + (!val ? '' : ibanOk(val) ? 'good' : 'badc');
  };
  $('#ibanInput').addEventListener('input', hint); hint();

  $('#setForm').addEventListener('submit', async e => {
    e.preventDefault();
    const body = {};
    $$('[name]', e.target).forEach(el => {
      const path = el.name.split('.'); let o = body;
      path.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; });
      o[path.at(-1)] = el.type === 'checkbox' ? el.checked : el.value;
    });
    const note = $('#setNote'); note.className = 'note';
    try { await api('/admin/settings', { method: 'PUT', body }); note.textContent = 'Saved. Customers will see these details immediately.'; $('#setWarn').hidden = ibanOk($('#ibanInput').value); toast('Settings saved'); }
    catch (err) { note.textContent = err.message; note.classList.add('err'); }
  });
  $('#setForm').addEventListener('click', async e => {   // "Send test WhatsApp / Telegram" (uses the settings you saved)
    const b = e.target.closest('[data-test]'); if (!b) return;
    const note = $('#testNote'); note.className = 'note'; note.textContent = 'Sending…'; b.disabled = true;
    try {
      const r = await api('/admin/alerts/test', { method: 'POST', body: { channel: b.dataset.test } });
      note.innerHTML = r.results.map(x => `${x.ok ? '✓ Sent' : '✗ Failed'} – ${esc(x.channel)} to ${esc(x.to)}${x.ok ? '' : ': ' + esc(x.detail || 'unknown error')}`).join('<br>');
      if (r.results.some(x => !x.ok)) note.classList.add('err');
    } catch (err) { note.textContent = err.message; note.classList.add('err'); }
    b.disabled = false;
  });
}

/* ---------- security: sessions, admin accounts, access log, reset ---------- */
const deviceName = ua => {
  ua = ua || '';
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return b + (o ? ' on ' + o : '');
};
const ACTION_LABEL = {
  login: 'Signed in', login_failed: 'Failed sign-in', login_blocked: 'Blocked sign-in', logout: 'Signed out', 'admin.setup': 'First admin created',
  'admin.create': 'Admin created', 'admin.update': 'Admin changed', 'admin.delete': 'Admin deleted', 'password.change': 'Password changed',
  'order.status': 'Order status', 'product.add': 'Product added', 'product.edit': 'Product edited', 'product.delete': 'Product deleted', 'product.deleteSoldOut': 'Sold-out items deleted',
  'settings.update': 'Settings changed', 'customer.delete': 'Customer erased', 'enquiry.delete': 'Enquiry deleted', 'notifications.delete': 'Notifications deleted',
  'chat.delete': 'Chat message deleted', 'chat.clear': 'Chat cleared', reset: 'DATA RESET', 'session.revoke': 'Session signed out', 'session.revokeAll': 'Sessions signed out',
  'alert.whatsapp': 'WhatsApp alert', 'alert.sms': 'SMS alert (old)', 'alert.telegram': 'Telegram alert', 'alert.test': 'Alert test'
};
async function renderSecurity() {
  const owner = isOwner();
  const [ss, ad, lg] = await Promise.all([api('/admin/sessions'), owner ? api('/admin/admins') : null, owner ? api('/admin/log') : null]);
  const sessions = ss.sessions;
  panel(`
    <h3>Who is signed in</h3>
    <p class="muted small">${owner ? 'Every admin sign-in on this website.' : 'Your sign-ins.'} Staff sign-ins expire after 7 days. If you do not recognise one, press "Sign out".</p>
    <div class="adm-table sess">
      <div class="adm-row head sess-row"><span>Who</span><span>Device</span><span>Location (IP)</span><span>Signed in</span><span>Last active</span><span></span></div>
      ${sessions.map(s => `<div class="adm-row sess-row"><span><strong>${esc(s.name)}</strong><small>${esc(s.email)}</small></span><span>${esc(deviceName(s.ua))}</span><span>${esc(s.ip || '')}</span><span>${fmtDate(s.created)}</span><span>${fmtDate(s.lastSeen)}</span>
        <span>${s.current ? '<em class="sold-tag" style="background:#d8e2c4;color:#3d5028">This device</em>' : `<button class="rm danger-text" data-revoke="${s.sid}">Sign out</button>`}</span></div>`).join('')}
    </div>
    ${sessions.length > 1 ? '<button class="btn ghost danger-text" id="revokeOthers" style="margin-top:12px">Sign out all other devices</button>' : ''}

    ${owner ? `
    <h3>Admin accounts <small class="muted">(${ad.admins.length} of 10)</small></h3>
    <p class="muted small"><strong>Owner</strong> can do everything. <strong>Staff</strong> can handle orders, chat, products, enquiries and customers, but cannot see payment settings, manage admins, erase customers, or read this log.</p>
    <div class="adm-table accts">
      <div class="adm-row head adm-acc"><span>Name</span><span>Level</span><span>Status</span><span>Last sign-in</span><span></span></div>
      ${ad.admins.map(a => `<div class="adm-row adm-acc ${a.disabled ? 'soldrow' : ''}" data-aid="${a.id}">
        <span><strong>${esc(a.name)}</strong><small>${esc(a.email)}</small></span>
        <span><select data-alevel ${a.id === state.user.id ? 'disabled' : ''}><option value="owner" ${a.level === 'owner' ? 'selected' : ''}>Owner</option><option value="staff" ${a.level === 'staff' ? 'selected' : ''}>Staff</option></select></span>
        <span>${a.disabled ? '<em class="sold-tag">Disabled</em>' : a.sessions ? `<em class="sold-tag" style="background:#d8e2c4;color:#3d5028">${a.sessions} signed in</em>` : 'Active'}</span>
        <span>${a.lastLogin ? fmtDate(a.lastLogin) : 'Never'}</span>
        <span class="acc-btns"><button class="rm" data-areset="${a.id}">Reset password</button>
          ${a.id === state.user.id ? '<em class="muted small">(you)</em>' : `<button class="rm" data-atoggle="${a.id}" data-dis="${a.disabled ? 0 : 1}">${a.disabled ? 'Enable' : 'Disable'}</button><button class="rm danger-text" data-adel="${a.id}">Delete</button>`}</span></div>`).join('')}
    </div>
    <h4>Add an admin account</h4>
    <form id="addAdmin" class="adm-add" novalidate>
      <label>Name<input name="name" required placeholder="e.g. Sales manager"></label>
      <label>Email<input name="email" type="email" required></label>
      <label>Password (8+, letters and numbers)<input name="password" type="password" autocomplete="new-password" required></label>
      <label>Level<select name="level"><option value="staff">Staff</option><option value="owner">Owner</option></select></label>
      <button class="btn" type="submit">Add admin</button>
    </form>
    <p class="note" id="addAdminNote"></p>` : ''}

    <h3>My password</h3>
    <form id="adminPw" class="set-pw" novalidate>
      <div class="set-grid">
        <label>Current password<input type="password" name="current" autocomplete="current-password"></label>
        <label>New password (8+ characters, letters and numbers)<input type="password" name="new" autocomplete="new-password"></label>
      </div>
      <button class="btn ghost" type="submit">Change my password</button><p class="note" id="pwNote"></p>
    </form>

    ${owner ? `
    <h3>Access &amp; activity log</h3>
    <p class="muted small">Every sign-in, failed sign-in and important change made by the admins and the system (last 300).</p>
    <div class="adm-filter"><input id="logSearch" type="search" placeholder="Search (name, action, IP, order no.…)">
      <select id="logAdmin"><option value="0">All admins</option>${ad.admins.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
      <button class="btn ghost" id="logCsv">Export CSV</button></div>
    <div class="adm-table logt" id="logTable"></div>

    <h3>Reset test data</h3>
    <div class="set-warn"><strong>Careful – this permanently deletes data.</strong> Use it to clear test customers and test orders before you start selling. Your products, prices, categories, settings and admin accounts are <strong>never</strong> touched.</div>
    <form id="resetForm" novalidate>
      <label class="chk"><input type="checkbox" name="orders" checked> Orders (and uploaded payment receipts)</label>
      <label class="chk"><input type="checkbox" name="customers" checked> Customers and their accounts</label>
      <label class="chk"><input type="checkbox" name="chats" checked> Chat messages</label>
      <label class="chk"><input type="checkbox" name="enquiries" checked> Enquiries</label>
      <label class="chk"><input type="checkbox" name="notifications" checked> Notifications</label>
      <label class="chk"><input type="checkbox" name="log"> This activity log</label>
      <label class="chk"><input type="checkbox" name="restoreStock" checked> Put the items of deleted orders back into stock</label>
      <label>Type <strong>RESET</strong> to confirm<input id="resetConfirm" autocomplete="off" placeholder="RESET"></label>
      <button class="btn danger" id="resetBtn" type="submit" disabled>Delete the selected data</button><p class="note" id="resetNote"></p>
    </form>` : ''}`);

  $('#panel').onclick = async e => {
    const t = e.target;
    try {
      if (t.dataset.revoke) { await api('/admin/sessions/' + t.dataset.revoke, { method: 'DELETE' }); toast('Signed out'); renderSecurity(); }
      if (t.id === 'revokeOthers' && confirm('Sign out every other device?')) { const r = await api('/admin/sessions/revoke-others', { method: 'POST', body: {} }); toast(`${r.revoked} session(s) signed out`); renderSecurity(); }
      if (t.dataset.atoggle) { await api('/admin/admins/' + t.dataset.atoggle, { method: 'PUT', body: { disabled: t.dataset.dis === '1' } }); toast('Updated'); renderSecurity(); }
      if (t.dataset.adel && confirm('Delete this admin account permanently?')) { await api('/admin/admins/' + t.dataset.adel, { method: 'DELETE' }); toast('Admin deleted'); renderSecurity(); }
      if (t.dataset.areset) askNewPassword(+t.dataset.areset);
    } catch (err) { toast(err.message); }
  };
  $('#panel').onchange = async e => {
    if (!e.target.matches('[data-alevel]')) return;
    try { await api('/admin/admins/' + e.target.closest('[data-aid]').dataset.aid, { method: 'PUT', body: { level: e.target.value } }); toast('Level changed'); renderSecurity(); }
    catch (err) { toast(err.message); renderSecurity(); }
  };
  $('#adminPw').addEventListener('submit', async e => {
    e.preventDefault(); const note = $('#pwNote'); note.className = 'note';
    try { await api('/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); note.textContent = 'Password updated. Your other devices were signed out.'; }
    catch (err) { note.textContent = err.message; note.classList.add('err'); }
  });
  if (!owner) return;

  $('#addAdmin').addEventListener('submit', async e => {
    e.preventDefault(); const note = $('#addAdminNote'); note.className = 'note';
    try { await api('/admin/admins', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Admin account created'); renderSecurity(); }
    catch (err) { note.textContent = err.message; note.classList.add('err'); }
  });

  let logRows = lg.log;
  const drawLog = () => {
    $('#logTable').innerHTML = `<div class="adm-row head log-row"><span>When</span><span>Admin</span><span>What</span><span>Details</span><span>IP / device</span></div>` +
      (logRows.length ? logRows.map(r => `<div class="adm-row log-row ${/failed|blocked|RESET|reset/i.test(r.action) ? 'soldrow' : ''}"><span>${fmtDate(r.created)}</span><span>${esc(r.admin_name)}</span>
        <span><strong>${esc(ACTION_LABEL[r.action] || r.action)}</strong></span><span>${esc(r.detail)}</span><span>${esc(r.ip || '')}<small>${esc(deviceName(r.ua))}</small></span></div>`).join('') : '<p class="muted" style="padding:14px 0">Nothing logged yet.</p>');
  };
  drawLog();
  let tmr;
  const reloadLog = () => { clearTimeout(tmr); tmr = setTimeout(async () => { logRows = (await api(`/admin/log?q=${encodeURIComponent($('#logSearch').value)}&admin=${$('#logAdmin').value}`)).log; drawLog(); }, 250); };
  $('#logSearch').addEventListener('input', reloadLog); $('#logAdmin').addEventListener('change', reloadLog);
  $('#logCsv').addEventListener('click', e => { e.preventDefault(); downloadFile('lofan-activity-log.csv', csvText([['When', 'Admin', 'Action', 'Details', 'IP', 'Device']].concat(logRows.map(r => [new Date(r.created * 1000).toLocaleString(), r.admin_name, r.action, r.detail, r.ip, deviceName(r.ua)])))); });

  $('#resetConfirm').addEventListener('input', e => { $('#resetBtn').disabled = e.target.value.trim() !== 'RESET'; });
  $('#resetForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, body = { confirm: $('#resetConfirm').value.trim() }, note = $('#resetNote'); note.className = 'note';
    ['orders', 'customers', 'chats', 'enquiries', 'notifications', 'log', 'restoreStock'].forEach(k => { body[k] = f.elements[k].checked; });
    if (!confirm('Last chance: permanently delete the selected data?')) return;
    try {
      const r = await api('/admin/reset', { method: 'POST', body });
      note.textContent = 'Done – deleted: ' + Object.entries(r.deleted).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') + '.'; toast('Data reset'); poll();
      $('#resetConfirm').value = ''; $('#resetBtn').disabled = true;
    } catch (err) { note.textContent = err.message; note.classList.add('err'); }
  });
}
function askNewPassword(id) {
  Modal.open(`<h2>Reset <em>password</em></h2><p class="gate-note">Choose a new password for this admin (8+ characters with letters and numbers). They will be signed out everywhere.</p>
    <form id="newPwForm" novalidate><label>New password<input name="password" type="password" autocomplete="new-password" required></label>
    <button class="btn full" type="submit">Set password</button><p class="note" data-note></p></form>`);
  $('#newPwForm').addEventListener('submit', async e => {
    e.preventDefault(); const note = $('[data-note]', e.target);
    try { await api('/admin/admins/' + id, { method: 'PUT', body: { password: e.target.elements.password.value } }); Modal.close(); toast('Password changed'); renderSecurity(); }
    catch (err) { note.textContent = err.message; note.classList.add('err'); }
  });
}

gate().catch(() => { $('#gateBody').innerHTML = '<p class="muted">Cannot reach the server. Run <code>python server.py</code> and reload.</p>'; });
