// KosherEats frontend — vanilla JS, no build step.
// Cart lives in localStorage (one restaurant at a time). Orders are fetched
// from the server; the orders page polls while an order is still active.

'use strict';

const $ = sel => document.querySelector(sel);
const api = {
  async req(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  get: p => api.req(p),
  post: (p, body) => api.req(p, { method: 'POST', body: JSON.stringify(body || {}) }),
  put: (p, body) => api.req(p, { method: 'PUT', body: JSON.stringify(body || {}) }),
  del: p => api.req(p, { method: 'DELETE' }),
};
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '<', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) {
  if (n === null || n === undefined) return null;
  return '$' + Number(n).toFixed(2);
}
function fmtTime12(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}
const CUISINE_EMOJI = {
  pizza: '🍕', sushi: '🍣', bakery: '🥐', israeli: '🥙', steakhouse: '🥩',
  deli: '🥪', chinese: '🍜', italian: '🍝', burgers: '🍔', cafe: '☕',
  seafood: '🐟', mexican: '🌮', american: '🍔', middle_eastern: '🧆',
  french: '🥐', asian: '🍱', dessert: '🍦', health: '🥗',
};
function tileEmoji(r) {
  const c = (r.cuisine || '').toLowerCase().replace(/[^a-z_]/g, '_');
  return CUISINE_EMOJI[c] || '🍽️';
}
function tileColor(name) {
  let h = 0;
  for (const ch of String(name || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 38%)`;
}
function initials(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function catLabel(c) {
  return { meat: 'Meat', dairy: 'Dairy', pareve: 'Pareve', bakery: 'Bakery' }[c] || c;
}
function hoursLine(hours) {
  if (!hours) return 'Hours not listed';
  const days = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
  return days.map(([k, label]) => {
    const d = hours[k];
    if (!d || d.closed) return `${label} Closed`;
    return `${label} ${fmtTime12(d.open)}–${fmtTime12(d.close)}`;
  }).join(' · ');
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let me = null;
let meta = { cuisines: [], hechshers: [], categories: [] };
let filters = { q: '', category: '', cuisine: '', hechsher: '', openNow: false, sort: 'recommended' };
let currentRestaurant = null;
let currentMenu = [];
let pollTimer = null;

const CART_KEY = 'koshereats-cart-v1';
let cart = JSON.parse(localStorage.getItem(CART_KEY) || 'null') || { restaurantId: null, items: {} };
function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCartCount();
}
function cartCount() { return Object.values(cart.items).reduce((n, i) => n + i.qty, 0); }
function cartSubtotal() { return Object.values(cart.items).reduce((n, i) => n + i.qty * i.price, 0); }
function renderCartCount() {
  const n = cartCount();
  $('#cart-count').textContent = n;
  $('#cart-count').classList.toggle('hidden', n === 0);
}
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', route);
async function route() {
  stopPolling();
  const hash = location.hash || '#/';
  const [_, page, arg] = hash.split('/');
  const view = $('#view');
  window.scrollTo(0, 0);
  if (page === 'r' && arg) return renderRestaurant(Number(arg));
  if (page === 'orders') return renderOrders();
  if (page === 'favorites') return renderFavorites();
  if (page === 'account') return renderAccount();
  if (page === 'dashboard') return renderDashboard();
  if (page === 'list') return renderListForm();
  if (page === 'checkout-success' && arg) return renderOrderSuccess(Number(arg));
  return renderHome();
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function shabbatNote() {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date());
  if (wd === 'Fri') return 'Many kosher places close early today for Shabbat — check each restaurant’s Friday hours before ordering.';
  if (wd === 'Sat') return 'Many kosher places are closed for Shabbat and reopen after nightfall on Saturday. Hours shown are each restaurant’s own.';
  return '';
}
async function renderHome() {
  const view = $('#view');
  const note = shabbatNote();
  view.innerHTML = `
    <div class="hero">
      <h1>Kosher food, delivered in Brooklyn.</h1>
      <p>Real kosher restaurants, real menus, real prices. Meat, dairy, pareve and bakery — with hechsher info on every listing.</p>
      ${note ? `<div class="shabbat-note">🕯️ ${note}</div>` : ''}
    </div>
    <div class="chips" id="cat-chips"></div>
    <div class="filter-row">
      <select id="f-cuisine"><option value="">All cuisines</option></select>
      <select id="f-hechsher"><option value="">Any hechsher</option></select>
      <select id="f-sort">
        <option value="recommended">Recommended</option>
        <option value="rating">Highest rated</option>
        <option value="name">Name A–Z</option>
      </select>
      <label class="toggle"><input type="checkbox" id="f-open"> Open now</label>
    </div>
    <div id="rest-grid" class="grid"></div>
    <div id="rest-empty" class="empty-note hidden"></div>`;

  const chips = $('#cat-chips');
  const cats = [['', 'All'], ['meat', '🥩 Meat'], ['dairy', '🧀 Dairy'], ['pareve', '🥗 Pareve'], ['bakery', '🥐 Bakery']];
  for (const [val, label] of cats) {
    const b = document.createElement('button');
    b.className = 'chip' + (filters.category === val ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { filters.category = val; renderHome(); };
    chips.appendChild(b);
  }
  const cuisineSel = $('#f-cuisine');
  for (const c of meta.cuisines) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    cuisineSel.appendChild(o);
  }
  cuisineSel.value = filters.cuisine;
  cuisineSel.onchange = () => { filters.cuisine = cuisineSel.value; loadRestaurants(); };
  const hechSel = $('#f-hechsher');
  for (const h of meta.hechshers) {
    const o = document.createElement('option');
    o.value = h; o.textContent = h;
    hechSel.appendChild(o);
  }
  hechSel.value = filters.hechsher;
  hechSel.onchange = () => { filters.hechsher = hechSel.value; loadRestaurants(); };
  $('#f-sort').value = filters.sort;
  $('#f-sort').onchange = e => { filters.sort = e.target.value; loadRestaurants(); };
  $('#f-open').checked = filters.openNow;
  $('#f-open').onchange = e => { filters.openNow = e.target.checked; loadRestaurants(); };
  loadRestaurants();
}
async function loadRestaurants() {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.category) params.set('category', filters.category);
  if (filters.cuisine) params.set('cuisine', filters.cuisine);
  if (filters.hechsher) params.set('hechsher', filters.hechsher);
  if (filters.openNow) params.set('open_now', '1');
  params.set('sort', filters.sort);
  const grid = $('#rest-grid');
  const empty = $('#rest-empty');
  try {
    const { restaurants } = await api.get(`/api/restaurants?${params}`);
    grid.innerHTML = '';
    empty.classList.add('hidden');
    if (!restaurants.length) {
      empty.textContent = 'No restaurants match those filters yet. Try widening the search — new listings are added as restaurants sign up.';
      empty.classList.remove('hidden');
      return;
    }
    for (const r of restaurants) grid.appendChild(restaurantCard(r));
  } catch (err) {
    grid.innerHTML = '';
    empty.textContent = 'Could not load restaurants. Check your connection and refresh.';
    empty.classList.remove('hidden');
  }
}
function restaurantCard(r) {
  const card = document.createElement('article');
  card.className = 'card';
  const openText = r.open_now === null ? 'Hours not listed' : r.open_now ? 'Open now' : 'Closed';
  card.innerHTML = `
    <div class="card-tile" style="background:${tileColor(r.name)}">
      <span>${tileEmoji(r)}</span>
      <span class="open-badge${r.open_now === false ? ' closed' : ''}">${openText}</span>
      <button class="fav-btn" title="Save to favorites">${r.favorite ? '❤️' : '🤍'}</button>
    </div>
    <div class="card-body">
      <div class="card-name">${esc(r.name)} ${r.verified ? '<span class="verified-mark" title="Verified listing">✓</span>' : ''}</div>
      <div class="card-meta">${esc(r.cuisine || catLabel(r.category))} · ${esc(r.address)}</div>
      <div class="card-tags">
        <span class="tag cat-${r.category}">${catLabel(r.category)}</span>
        ${r.hechsher ? `<span class="tag hechsher">${esc(r.hechsher)}</span>` : ''}
        ${r.delivery === true ? '<span class="tag">🚴 Delivery</span>' : ''}
        ${r.delivery === false ? '<span class="tag">🏃 Pickup only</span>' : ''}
        ${r.price_level ? `<span class="tag">${esc(r.price_level)}</span>` : ''}
      </div>
      <div class="card-foot">
        <span class="rating">${r.rating ? `★ ${r.rating} <small>${esc(r.rating_source || '')}</small>` : '<small>No rating listed</small>'}</span>
        <span>${r.delivery_fee !== null && r.delivery_fee !== undefined ? `Delivery ${money(r.delivery_fee)}` : ''}</span>
      </div>
    </div>`;
  card.querySelector('.fav-btn').onclick = async e => {
    e.stopPropagation();
    if (!me) { openAuth('login'); return; }
    try {
      if (r.favorite) await api.del(`/api/favorites/${r.id}`);
      else await api.post(`/api/favorites/${r.id}`);
      r.favorite = !r.favorite;
      e.currentTarget.textContent = r.favorite ? '❤️' : '🤍';
    } catch (err) { toast(err.message); }
  };
  card.onclick = () => go(`#/r/${r.id}`);
  return card;
}

// ---------------------------------------------------------------------------
// Restaurant page
// ---------------------------------------------------------------------------
async function renderRestaurant(id) {
  const view = $('#view');
  view.innerHTML = '<p class="empty-note">Loading menu…</p>';
  try {
    const { restaurant, menu } = await api.get(`/api/restaurants/${id}`);
    currentRestaurant = restaurant;
    currentMenu = menu;
  } catch (err) {
    view.innerHTML = `<p class="empty-note">${esc(err.message)}</p>`;
    return;
  }
  const r = currentRestaurant;
  const openText = r.open_now === null ? 'Hours not listed' : r.open_now ? 'Open now' : 'Closed';
  const sections = [];
  for (const item of currentMenu) {
    const s = item.section || 'Menu';
    let sec = sections.find(x => x.name === s);
    if (!sec) { sec = { name: s, items: [] }; sections.push(sec); }
    sec.items.push(item);
  }
  view.innerHTML = `
    <a href="#/" class="back-link">← All restaurants</a>
    <div class="rest-head">
      <h1>${esc(r.name)} ${r.verified ? '<span class="verified-mark" title="Verified listing">✓</span>' : ''}</h1>
      <div class="sub">${esc(r.cuisine || catLabel(r.category))} · ${esc(r.address)} · ${openText}</div>
      <div class="card-tags">
        <span class="tag cat-${r.category}">${catLabel(r.category)}</span>
        ${r.hechsher ? `<span class="tag hechsher">${esc(r.hechsher)}</span>` : ''}
        ${r.delivery === true ? '<span class="tag">🚴 Delivery available</span>' : ''}
        ${r.delivery === false ? '<span class="tag">🏃 Pickup only</span>' : ''}
        ${r.price_level ? `<span class="tag">${esc(r.price_level)}</span>` : ''}
        ${r.rating ? `<span class="tag">★ ${r.rating} ${esc(r.rating_source || '')}</span>` : ''}
        ${r.min_order ? `<span class="tag">Min order ${money(r.min_order)}</span>` : ''}
      </div>
      <div class="rest-actions">
        ${r.phone ? `<a class="btn-ghost" href="tel:${esc(r.phone)}">📞 ${esc(r.phone)}</a>` : ''}
        ${r.website ? `<a class="btn-ghost" href="${esc(r.website)}" target="_blank" rel="noopener">Website</a>` : ''}
        <button id="rest-fav" class="btn-ghost">${r.favorite ? '❤️ Saved' : '🤍 Save'}</button>
      </div>
      <div class="hours-table">${hoursLine(r.hours).split(' · ').map(h => `<span>${esc(h)}</span>`).join('')}</div>
    </div>
    <div id="menu-sections"></div>`;
  $('#rest-fav').onclick = async () => {
    if (!me) { openAuth('login'); return; }
    try {
      if (r.favorite) await api.del(`/api/favorites/${r.id}`);
      else await api.post(`/api/favorites/${r.id}`);
      r.favorite = !r.favorite;
      $('#rest-fav').textContent = r.favorite ? '❤️ Saved' : '🤍 Save';
    } catch (err) { toast(err.message); }
  };
  const wrap = $('#menu-sections');
  if (!sections.length) {
    wrap.innerHTML = '<p class="empty-note">No menu items listed yet. Call the restaurant — or if you run this place, list your menu from the dashboard.</p>';
  }
  for (const sec of sections) {
    const secEl = document.createElement('div');
    secEl.className = 'menu-section';
    secEl.innerHTML = `<h2>${esc(sec.name)}</h2>`;
    for (const item of sec.items) secEl.appendChild(menuItemEl(item, r));
    wrap.appendChild(secEl);
  }
  renderCartBar();
}
function menuItemEl(item, r) {
  const el = document.createElement('div');
  el.className = 'menu-item';
  const inCart = cart.restaurantId === r.id ? (cart.items[item.id]?.qty || 0) : 0;
  el.innerHTML = `
    <div class="mi-info">
      <div class="mi-name">${esc(item.name)}</div>
      ${item.description ? `<div class="mi-desc">${esc(item.description)}</div>` : ''}
      <div class="mi-price">${item.price !== null ? money(item.price) : '<span class="noprice">Price not listed — call to order</span>'}</div>
    </div>
    <div class="mi-ctl"></div>`;
  const ctl = el.querySelector('.mi-ctl');
  if (!item.available) {
    ctl.innerHTML = '<span style="color:var(--muted);font-size:.85rem">Unavailable</span>';
    return el;
  }
  if (item.price === null) {
    const call = document.createElement('a');
    call.className = 'btn-ghost';
    call.textContent = 'Call';
    call.href = r.phone ? `tel:${r.phone}` : '#';
    if (!r.phone) call.onclick = e => { e.preventDefault(); toast('No phone number listed for this restaurant'); };
    ctl.appendChild(call);
    return el;
  }
  if (inCart > 0) {
    ctl.innerHTML = `<div class="qty-ctl">
      <button data-a="dec">−</button><span class="qty">${inCart}</span><button data-a="inc">+</button>
    </div>`;
    ctl.querySelector('[data-a="dec"]').onclick = () => setQty(item, inCart - 1);
    ctl.querySelector('[data-a="inc"]').onclick = () => setQty(item, inCart + 1);
  } else {
    const b = document.createElement('button');
    b.className = 'add-btn';
    b.textContent = 'Add';
    b.onclick = () => setQty(item, 1);
    ctl.appendChild(b);
  }
  return el;
}
function setQty(item, qty) {
  const r = currentRestaurant;
  if (!r) return;
  if (cart.restaurantId && cart.restaurantId !== r.id && qty > 0) {
    if (!confirm('Your cart has items from another restaurant. Clear it and start a new cart here?')) return;
    cart = { restaurantId: r.id, items: {} };
  }
  if (qty <= 0) delete cart.items[item.id];
  else {
    cart.restaurantId = r.id;
    cart.items[item.id] = { qty, name: item.name, price: item.price };
  }
  saveCart();
  renderRestaurant(r.id);
}
function renderCartBar() {
  document.querySelectorAll('.cart-bar').forEach(el => el.remove());
  if (cartCount() === 0) return;
  const bar = document.createElement('button');
  bar.className = 'cart-bar';
  bar.innerHTML = `<span>🛒 ${cartCount()} item${cartCount() > 1 ? 's' : ''}</span><span>View cart · ${money(cartSubtotal())}</span>`;
  bar.onclick = openCart;
  document.body.appendChild(bar);
}

// ---------------------------------------------------------------------------
// Cart + checkout
// ---------------------------------------------------------------------------
function openCart() {
  renderCartDrawer();
  $('#cart-overlay').classList.remove('hidden');
}
function closeCart() { $('#cart-overlay').classList.add('hidden'); }
$('#cart-close').onclick = closeCart;
$('#cart-overlay').addEventListener('click', e => { if (e.target.id === 'cart-overlay') closeCart(); });
$('#btn-cart').onclick = () => { if (cartCount() === 0) { toast('Your cart is empty'); return; } openCart(); };

async function renderCartDrawer() {
  const restId = cart.restaurantId;
  $('#cart-restaurant').innerHTML = '';
  $('#cart-items').innerHTML = '';
  $('#cart-summary').innerHTML = '';
  if (!restId || cartCount() === 0) {
    $('#cart-items').innerHTML = '<p class="empty-note">Your cart is empty.</p>';
    return;
  }
  let rest = currentRestaurant && currentRestaurant.id === restId ? currentRestaurant : null;
  if (!rest) {
    try { rest = (await api.get(`/api/restaurants/${restId}`)).restaurant; } catch { rest = { id: restId, name: 'Restaurant', delivery_fee: null, min_order: null, delivery: null }; }
  }
  $('#cart-restaurant').innerHTML = `<h3 style="padding:12px 18px 0">${esc(rest.name)}</h3>`;
  const itemsEl = $('#cart-items');
  for (const [id, it] of Object.entries(cart.items)) {
    const row = document.createElement('div');
    row.className = 'cart-line';
    row.innerHTML = `
      <div class="cl-info"><div class="cl-name">${esc(it.name)}</div><div class="cl-price">${money(it.price)} each</div></div>
      <div class="qty-ctl"><button data-a="dec">−</button><span class="qty">${it.qty}</span><button data-a="inc">+</button></div>
      <div style="min-width:64px;text-align:right;font-weight:700">${money(it.price * it.qty)}</div>`;
    row.querySelector('[data-a="dec"]').onclick = () => {
      const item = currentMenu.find(m => m.id === Number(id)) || { id: Number(id), name: it.name, price: it.price };
      setQty(item, it.qty - 1);
      if (cartCount() === 0) closeCart(); else renderCartDrawer();
    };
    row.querySelector('[data-a="inc"]').onclick = () => {
      const item = currentMenu.find(m => m.id === Number(id)) || { id: Number(id), name: it.name, price: it.price };
      setQty(item, it.qty + 1);
      renderCartDrawer();
    };
    itemsEl.appendChild(row);
  }
  const sub = cartSubtotal();
  $('#cart-summary').innerHTML = `
    <div class="row"><span>Subtotal</span><span>${money(sub)}</span></div>
    <div class="row"><span>Delivery fee</span><span>${rest.delivery_fee !== null && rest.delivery_fee !== undefined ? money(rest.delivery_fee) : 'Confirmed by restaurant'}</span></div>
    <div class="total"><span>Total</span><span>${money(sub + (rest.delivery_fee || 0))}</span></div>
    ${rest.min_order && sub < rest.min_order ? `<div class="error">Minimum order is ${money(rest.min_order)}.</div>` : ''}`;
  $('#btn-checkout').disabled = !!(rest.min_order && sub < rest.min_order);
  $('#btn-checkout').onclick = () => { closeCart(); openCheckout(rest); };
}

function openCheckout(rest) {
  if (!me) { openAuth('login', () => openCheckout(rest)); return; }
  const delivers = rest.delivery !== false;
  const body = openModal('Checkout', '', false);
  body.innerHTML = `
    <div class="form-row">
      <label><input type="radio" name="otype" value="delivery" ${delivers ? 'checked' : ''} ${delivers ? '' : 'disabled'}> Delivery</label>
      <label><input type="radio" name="otype" value="pickup" ${delivers ? '' : 'checked'}> Pickup</label>
    </div>
    <div id="co-address-wrap">
      <label>Delivery address</label>
      <input id="co-address" type="text" placeholder="Street, apartment, city" value="${esc(me.address || '')}">
    </div>
    <label>Phone number</label>
    <input id="co-phone" type="text" placeholder="For the restaurant to confirm" value="${esc(me.phone || '')}">
    <label>Notes for the restaurant (optional)</label>
    <textarea id="co-notes" rows="2" placeholder="e.g. Ring the bell, no onions…"></textarea>
    <div style="font-size:.9rem;color:var(--muted);line-height:1.5">
      This places an order request with <b style="color:var(--ink)">${esc(rest.name)}</b>. The restaurant confirms by phone.
      Payment happens on delivery or pickup — no payment is taken here.
      ${rest.delivery_fee !== null && rest.delivery_fee !== undefined ? `Delivery fee ${money(rest.delivery_fee)} · ` : ''}Total ${money(cartSubtotal() + (rest.delivery_fee || 0))}.
    </div>
    <button id="co-place" class="btn-primary">Place order</button>`;
  const syncType = () => {
    const t = body.querySelector('input[name="otype"]:checked')?.value || 'pickup';
    $('#co-address-wrap').style.display = t === 'delivery' ? '' : 'none';
  };
  body.querySelectorAll('input[name="otype"]').forEach(r => r.onchange = syncType);
  syncType();
  body.querySelector('#co-place').onclick = async () => {
    const type = body.querySelector('input[name="otype"]:checked')?.value || 'pickup';
    const address = body.querySelector('#co-address').value.trim();
    const phone = body.querySelector('#co-phone').value.trim();
    const notes = body.querySelector('#co-notes').value.trim();
    if (type === 'delivery' && !address) { toast('Add a delivery address'); return; }
    if (!phone) { toast('Add a phone number so the restaurant can confirm'); return; }
    const items = Object.entries(cart.items).map(([id, it]) => ({ menu_item_id: Number(id), qty: it.qty }));
    try {
      const { order } = await api.post('/api/orders', { restaurant_id: rest.id, type, address, phone, notes, items });
      cart = { restaurantId: null, items: {} };
      saveCart();
      document.querySelectorAll('.cart-bar').forEach(el => el.remove());
      closeModal();
      go(`#/checkout-success/${order.id}`);
    } catch (err) { toast(err.message); }
  };
}
async function renderOrderSuccess(orderId) {
  const view = $('#view');
  view.innerHTML = '<p class="empty-note">Loading your order…</p>';
  try {
    const { order } = await api.get(`/api/orders/${orderId}`);
    view.innerHTML = `
      <div class="section" style="text-align:center">
        <div style="font-size:3rem">✅</div>
        <h2 style="margin:8px 0">Order placed with ${esc(order.restaurant_name)}</h2>
        <p style="color:var(--muted);line-height:1.6">Order #${order.id} · ${money(order.total)} · ${order.type === 'delivery' ? 'Delivery' : 'Pickup'}<br>
        The restaurant will call ${esc(order.phone || 'you')} to confirm. Payment happens on delivery or pickup.</p>
        ${order.restaurant_phone ? `<a class="btn-ghost" href="tel:${esc(order.restaurant_phone)}" style="display:inline-block;margin-top:12px">📞 Call the restaurant</a>` : ''}
        <div style="margin-top:14px"><a class="btn-primary" href="#/orders" style="display:inline-block">Track my order</a></div>
      </div>`;
  } catch (err) {
    view.innerHTML = `<p class="empty-note">${esc(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
const STATUS_FLOW = ['placed', 'confirmed', 'preparing', 'on_the_way', 'delivered'];
const STATUS_LABEL = { placed: 'Placed', confirmed: 'Confirmed', preparing: 'Preparing', on_the_way: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
async function renderOrders() {
  const view = $('#view');
  if (!me) { openAuth('login', () => renderOrders()); view.innerHTML = '<p class="empty-note">Log in to see your orders.</p>'; return; }
  view.innerHTML = '<h1 style="margin-bottom:16px">My orders</h1><div id="orders-list"><p class="empty-note">Loading…</p></div>';
  const load = async () => {
    try {
      const { orders } = await api.get('/api/orders');
      const list = $('#orders-list');
      if (!list) return;
      if (!orders.length) { list.innerHTML = '<p class="empty-note">No orders yet. Find something good in Brooklyn.</p>'; return; }
      list.innerHTML = '';
      for (const o of orders) list.appendChild(orderCard(o, false));
      const active = orders.some(o => !['delivered', 'cancelled'].includes(o.status));
      if (active && !pollTimer) pollTimer = setInterval(load, 20000);
      if (!active) stopPolling();
    } catch (err) {
      const list = $('#orders-list');
      if (list) list.innerHTML = `<p class="empty-note">${esc(err.message)}</p>`;
    }
  };
  load();
}
function orderCard(o, isOwner) {
  const el = document.createElement('div');
  el.className = 'order-card';
  const steps = o.status === 'cancelled'
    ? `<div class="timeline"><span class="step done">Cancelled</span></div>`
    : `<div class="timeline">${STATUS_FLOW.map(s => `<span class="step${STATUS_FLOW.indexOf(s) <= STATUS_FLOW.indexOf(o.status) ? ' done' : ''}">${STATUS_LABEL[s]}</span>`).join('')}</div>`;
  el.innerHTML = `
    <div class="oc-head">
      <h3>Order #${o.id} · ${esc(o.restaurant_name)}</h3>
      <span class="status-pill ${o.status}">${STATUS_LABEL[o.status]}</span>
    </div>
    <div style="color:var(--muted);font-size:.88rem">${new Date(o.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${o.type === 'delivery' ? 'Delivery' : 'Pickup'}${o.address ? ` · ${esc(o.address)}` : ''}</div>
    ${steps}
    <div class="order-lines">${o.items.map(i => `${i.qty}× ${esc(i.name)} — ${money(i.price * i.qty)}`).join('<br>')}</div>
    <div class="order-total">Total ${money(o.total)}${o.delivery_fee ? ` (incl. ${money(o.delivery_fee)} delivery)` : ''}</div>
    ${o.notes ? `<div style="font-size:.88rem;color:var(--muted);margin-top:6px">Note: ${esc(o.notes)}</div>` : ''}
    <div class="rest-actions" style="margin-top:12px"></div>`;
  const actions = el.querySelector('.rest-actions');
  if (isOwner && !['delivered', 'cancelled'].includes(o.status)) {
    const next = { placed: 'confirmed', confirmed: 'preparing', preparing: 'on_the_way', on_the_way: 'delivered' }[o.status];
    const adv = document.createElement('button');
    adv.className = 'btn-primary';
    adv.textContent = `Mark ${STATUS_LABEL[next].toLowerCase()}`;
    adv.onclick = async () => { try { await api.put(`/api/orders/${o.id}/status`, { status: next }); renderDashboard(); } catch (err) { toast(err.message); } };
    const cancel = document.createElement('button');
    cancel.className = 'btn-danger';
    cancel.textContent = 'Cancel order';
    cancel.onclick = async () => { if (!confirm('Cancel this order?')) return; try { await api.put(`/api/orders/${o.id}/status`, { status: 'cancelled' }); renderDashboard(); } catch (err) { toast(err.message); } };
    actions.append(adv, cancel);
  }
  if (!isOwner && o.status === 'placed') {
    const cancel = document.createElement('button');
    cancel.className = 'btn-danger';
    cancel.textContent = 'Cancel order';
    cancel.onclick = async () => { if (!confirm('Cancel this order?')) return; try { await api.put(`/api/orders/${o.id}/status`, { status: 'cancelled' }); renderOrders(); } catch (err) { toast(err.message); } };
    actions.appendChild(cancel);
  }
  if (o.restaurant_phone) {
    const call = document.createElement('a');
    call.className = 'btn-ghost';
    call.href = `tel:${o.restaurant_phone}`;
    call.textContent = '📞 Call restaurant';
    actions.appendChild(call);
  }
  return el;
}

// ---------------------------------------------------------------------------
// Favorites + account
// ---------------------------------------------------------------------------
async function renderFavorites() {
  const view = $('#view');
  if (!me) { openAuth('login', () => renderFavorites()); view.innerHTML = '<p class="empty-note">Log in to see your favorites.</p>'; return; }
  view.innerHTML = '<h1 style="margin-bottom:16px">Favorites</h1><div id="fav-grid" class="grid"></div><div id="fav-empty" class="empty-note hidden"></div>';
  try {
    const { restaurants } = await api.get('/api/favorites');
    const grid = $('#fav-grid');
    if (!restaurants.length) {
      $('#fav-empty').textContent = 'No favorites yet. Tap the 🤍 on any restaurant to save it here.';
      $('#fav-empty').classList.remove('hidden');
      return;
    }
    for (const r of restaurants) grid.appendChild(restaurantCard(r));
  } catch (err) { view.innerHTML = `<p class="empty-note">${esc(err.message)}</p>`; }
}
async function renderAccount() {
  const view = $('#view');
  if (!me) { openAuth('login', () => renderAccount()); view.innerHTML = '<p class="empty-note">Log in to manage your account.</p>'; return; }
  view.innerHTML = `
    <h1 style="margin-bottom:16px">My account</h1>
    <div class="section">
      <h2>Profile</h2>
      <label>Display name</label>
      <input id="acc-name" type="text" value="${esc(me.display_name)}" maxlength="40">
      <label>Phone</label>
      <input id="acc-phone" type="text" value="${esc(me.phone || '')}" placeholder="For order confirmations">
      <label>Delivery address</label>
      <input id="acc-address" type="text" value="${esc(me.address || '')}" placeholder="Street, apartment, city">
      <button id="acc-save" class="btn-primary">Save</button>
      <p style="color:var(--muted);font-size:.88rem">Signed in as @${esc(me.username)} · ${me.role === 'owner' ? 'Restaurant owner account' : 'Customer account'}</p>
    </div>
    <div class="section">
      <h2>Restaurant owner?</h2>
      <p style="color:var(--muted);line-height:1.6;margin-bottom:10px">Own a kosher restaurant? List it here — add your menu, take order requests, and update order statuses from your dashboard. Owner accounts are free.</p>
      ${me.role === 'owner'
        ? '<a class="btn-primary" href="#/dashboard" style="display:inline-block">Go to my dashboard</a> <a class="btn-ghost" href="#/list" style="display:inline-block">List another restaurant</a>'
        : '<button id="acc-list" class="btn-primary">List my restaurant</button>'}
    </div>
    <button id="acc-logout" class="btn-danger">Log out</button>`;
  $('#acc-save').onclick = async () => {
    try {
      const { user } = await api.put('/api/me', {
        display_name: $('#acc-name').value.trim(),
        phone: $('#acc-phone').value.trim(),
        address: $('#acc-address').value.trim(),
      });
      me = user;
      toast('Saved');
    } catch (err) { toast(err.message); }
  };
  const listBtn = $('#acc-list');
  if (listBtn) listBtn.onclick = () => { toast('Create an owner account to list your restaurant — log out and sign up as a restaurant owner.'); openAuth('signup-owner'); };
  $('#acc-logout').onclick = async () => {
    try { await api.post('/api/logout'); } catch { /* ignore */ }
    location.reload();
  };
}

// ---------------------------------------------------------------------------
// Restaurant dashboard (owners)
// ---------------------------------------------------------------------------
async function renderDashboard() {
  const view = $('#view');
  if (!me) { openAuth('login', () => renderDashboard()); view.innerHTML = '<p class="empty-note">Log in to see your dashboard.</p>'; return; }
  view.innerHTML = '<h1 style="margin-bottom:16px">Restaurant dashboard</h1><div id="dash-body"><p class="empty-note">Loading…</p></div>';
  try {
    const { restaurants } = await api.get('/api/my-restaurants');
    const body = $('#dash-body');
    if (!restaurants.length) {
      body.innerHTML = '<p class="empty-note">You have no listings yet.</p><a class="btn-primary" href="#/list" style="display:inline-block">List your restaurant</a>';
      return;
    }
    body.innerHTML = '';
    for (const r of restaurants) {
      const sec = document.createElement('div');
      sec.className = 'section';
      sec.innerHTML = `<h2>${esc(r.name)}</h2>
        <p style="color:var(--muted);font-size:.9rem">${esc(r.address)} · ${r.open_now === null ? 'Hours not listed' : r.open_now ? 'Open now' : 'Closed'}</p>
        <div class="rest-actions">
          <button class="btn-ghost" data-act="orders">📋 Orders</button>
          <button class="btn-ghost" data-act="menu">🍽️ Menu</button>
          <button class="btn-ghost" data-act="edit">✏️ Details & hours</button>
          <a class="btn-ghost" href="#/r/${r.id}">View page</a>
        </div>
        <div class="dash-pane"></div>`;
      const pane = sec.querySelector('.dash-pane');
      sec.querySelector('[data-act="orders"]').onclick = () => loadDashOrders(r, pane);
      sec.querySelector('[data-act="menu"]').onclick = () => loadDashMenu(r, pane);
      sec.querySelector('[data-act="edit"]').onclick = () => loadDashEdit(r, pane);
      body.appendChild(sec);
      loadDashOrders(r, pane);
    }
  } catch (err) { $('#dash-body').innerHTML = `<p class="empty-note">${esc(err.message)}</p>`; }
}
async function loadDashOrders(r, pane) {
  pane.innerHTML = '<p class="empty-note">Loading orders…</p>';
  try {
    const { orders } = await api.get(`/api/restaurants/${r.id}/orders`);
    if (!orders.length) { pane.innerHTML = '<p class="empty-note">No orders yet for this restaurant.</p>'; return; }
    pane.innerHTML = '';
    for (const o of orders) pane.appendChild(orderCard(o, true));
  } catch (err) { pane.innerHTML = `<p class="empty-note">${esc(err.message)}</p>`; }
}
async function loadDashMenu(r, pane) {
  pane.innerHTML = '<p class="empty-note">Loading menu…</p>';
  try {
    const { menu } = await api.get(`/api/restaurants/${r.id}`);
    pane.innerHTML = `
      <div class="form-row">
        <input id="mi-name" type="text" placeholder="Item name">
        <input id="mi-price" type="text" inputmode="decimal" placeholder="Price (e.g. 12.99)">
      </div>
      <input id="mi-section" type="text" placeholder="Section (e.g. Mains, Appetizers)">
      <input id="mi-desc" type="text" placeholder="Description (optional)">
      <button id="mi-add" class="btn-primary">Add item</button>
      <div id="mi-list"></div>`;
    const list = pane.querySelector('#mi-list');
    const draw = () => {
      list.innerHTML = '';
      for (const item of menu) {
        const row = document.createElement('div');
        row.className = 'cart-line';
        row.innerHTML = `<div class="cl-info"><div class="cl-name">${esc(item.name)} ${item.available ? '' : '(unavailable)'}</div><div class="cl-price">${item.price !== null ? money(item.price) : 'No price'} · ${esc(item.section || 'Menu')}</div></div>
          <button class="btn-ghost" data-a="toggle">${item.available ? 'Hide' : 'Show'}</button>
          <button class="btn-danger" data-a="del">Delete</button>`;
        row.querySelector('[data-a="toggle"]').onclick = async () => {
          await api.put(`/api/restaurants/${r.id}/menu/${item.id}`, { available: !item.available });
          item.available = !item.available;
          draw();
        };
        row.querySelector('[data-a="del"]').onclick = async () => {
          if (!confirm(`Delete “${item.name}”?`)) return;
          await api.del(`/api/restaurants/${r.id}/menu/${item.id}`);
          menu.splice(menu.indexOf(item), 1);
          draw();
        };
        list.appendChild(row);
      }
    };
    draw();
    pane.querySelector('#mi-add').onclick = async () => {
      const name = pane.querySelector('#mi-name').value.trim();
      const priceRaw = pane.querySelector('#mi-price').value.trim();
      const section = pane.querySelector('#mi-section').value.trim();
      const description = pane.querySelector('#mi-desc').value.trim();
      if (!name) { toast('Item name is required'); return; }
      try {
        const { item } = await api.post(`/api/restaurants/${r.id}/menu`, {
          name, description: description || null, section: section || null,
          price: priceRaw === '' ? null : Number(priceRaw),
        });
        menu.push(item);
        draw();
        pane.querySelector('#mi-name').value = '';
        pane.querySelector('#mi-price').value = '';
        pane.querySelector('#mi-desc').value = '';
        toast('Item added');
      } catch (err) { toast(err.message); }
    };
  } catch (err) { pane.innerHTML = `<p class="empty-note">${esc(err.message)}</p>`; }
}
const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
async function loadDashEdit(r, pane) {
  const hours = r.hours || {};
  pane.innerHTML = `
    <div class="form-row"><div><label>Name</label><input id="de-name" type="text" value="${esc(r.name)}"></div>
    <div><label>Phone</label><input id="de-phone" type="text" value="${esc(r.phone || '')}"></div></div>
    <label>Address</label><input id="de-address" type="text" value="${esc(r.address)}">
    <div class="form-row"><div><label>Cuisine</label><input id="de-cuisine" type="text" value="${esc(r.cuisine || '')}"></div>
    <div><label>Hechsher</label><input id="de-hechsher" type="text" value="${esc(r.hechsher || '')}"></div></div>
    <div class="form-row"><div><label>Category</label><select id="de-category">
      ${['meat', 'dairy', 'pareve', 'bakery'].map(c => `<option value="${c}" ${r.category === c ? 'selected' : ''}>${catLabel(c)}</option>`).join('')}
    </select></div>
    <div><label>Website</label><input id="de-website" type="text" value="${esc(r.website || '')}"></div></div>
    <div class="form-row"><div><label>Delivery fee ($)</label><input id="de-fee" type="text" inputmode="decimal" value="${r.delivery_fee ?? ''}" placeholder="Leave blank if unknown"></div>
    <div><label>Minimum order ($)</label><input id="de-min" type="text" inputmode="decimal" value="${r.min_order ?? ''}"></div></div>
    <label class="toggle"><input type="checkbox" id="de-delivery" ${r.delivery === false ? '' : 'checked'}> Offers delivery (uncheck for pickup only)</label>
    <h3 style="margin-top:10px">Hours</h3>
    <div id="de-hours"></div>
    <button id="de-save" class="btn-primary">Save details</button>`;
  const hoursEl = pane.querySelector('#de-hours');
  for (const [key, label] of DAYS) {
    const d = hours[key] || {};
    const row = document.createElement('div');
    row.className = 'form-row';
    row.style.alignItems = 'center';
    row.innerHTML = `<label style="flex:.7">${label}</label>
      <input type="text" data-open placeholder="Open (e.g. 11:00)" value="${esc(d.open || '')}">
      <input type="text" data-close placeholder="Close (e.g. 22:00)" value="${esc(d.close || '')}">
      <label class="toggle"><input type="checkbox" data-closed ${d.closed ? 'checked' : ''}> Closed</label>`;
    hoursEl.appendChild(row);
  }
  pane.querySelector('#de-save').onclick = async () => {
    const newHours = {};
    hoursEl.querySelectorAll('.form-row').forEach((row, i) => {
      const key = DAYS[i][0];
      const closed = row.querySelector('[data-closed]').checked;
      const open = row.querySelector('[data-open]').value.trim();
      const close = row.querySelector('[data-close]').value.trim();
      if (closed || (!open && !close)) newHours[key] = { closed: true };
      else newHours[key] = { open: open || '09:00', close: close || '21:00' };
    });
    const feeRaw = pane.querySelector('#de-fee').value.trim();
    const minRaw = pane.querySelector('#de-min').value.trim();
    try {
      const { restaurant } = await api.put(`/api/restaurants/${r.id}`, {
        name: pane.querySelector('#de-name').value.trim(),
        address: pane.querySelector('#de-address').value.trim(),
        phone: pane.querySelector('#de-phone').value.trim(),
        cuisine: pane.querySelector('#de-cuisine').value.trim(),
        hechsher: pane.querySelector('#de-hechsher').value.trim(),
        category: pane.querySelector('#de-category').value,
        website: pane.querySelector('#de-website').value.trim(),
        delivery: pane.querySelector('#de-delivery').checked,
        delivery_fee: feeRaw === '' ? null : Number(feeRaw),
        min_order: minRaw === '' ? null : Number(minRaw),
        hours: newHours,
      });
      Object.assign(r, restaurant);
      toast('Saved');
    } catch (err) { toast(err.message); }
  };
}

// ---------------------------------------------------------------------------
// List your restaurant
// ---------------------------------------------------------------------------
async function renderListForm() {
  const view = $('#view');
  if (!me) { openAuth('signup-owner', () => renderListForm()); view.innerHTML = '<p class="empty-note">Create a restaurant owner account to list your restaurant.</p>'; return; }
  if (me.role !== 'owner') {
    view.innerHTML = `<div class="section"><h2>List your restaurant</h2>
      <p style="color:var(--muted);line-height:1.6">Your account is a customer account. Listing a restaurant needs an owner account — log out and sign up again as a restaurant owner (it takes a minute, and it’s free).</p>
      <button id="list-switch" class="btn-primary">Create an owner account</button></div>`;
    $('#list-switch').onclick = () => openAuth('signup-owner');
    return;
  }
  view.innerHTML = `
    <h1 style="margin-bottom:16px">List your restaurant</h1>
    <div class="section">
      <p style="color:var(--muted);line-height:1.6;margin-bottom:10px">List only your own restaurant, with real information. Listings you add show as unverified until checked; menu items and prices must be your real ones.</p>
      <label>Restaurant name</label><input id="lr-name" type="text" placeholder="e.g. Taam Bakery">
      <label>Address</label><input id="lr-address" type="text" placeholder="Street address, Brooklyn, NY">
      <div class="form-row"><div><label>Phone</label><input id="lr-phone" type="text"></div>
      <div><label>Website (optional)</label><input id="lr-website" type="text"></div></div>
      <div class="form-row"><div><label>Cuisine</label><input id="lr-cuisine" type="text" placeholder="e.g. Israeli, Pizza, Sushi"></div>
      <div><label>Hechsher</label><input id="lr-hechsher" type="text" placeholder="e.g. OU, OK, Badatz"></div></div>
      <label>Category</label><select id="lr-category">
        <option value="meat">Meat</option><option value="dairy">Dairy</option>
        <option value="pareve">Pareve</option><option value="bakery">Bakery</option>
      </select>
      <div class="form-row"><div><label>Delivery fee ($, optional)</label><input id="lr-fee" type="text" inputmode="decimal" placeholder="Leave blank if unsure"></div>
      <div><label>Minimum order ($, optional)</label><input id="lr-min" type="text" inputmode="decimal"></div></div>
      <label class="toggle"><input type="checkbox" id="lr-delivery" checked> Offers delivery</label>
      <button id="lr-create" class="btn-primary">Create listing</button>
    </div>`;
  $('#lr-create').onclick = async () => {
    const feeRaw = $('#lr-fee').value.trim();
    const minRaw = $('#lr-min').value.trim();
    try {
      const { restaurant } = await api.post('/api/restaurants', {
        name: $('#lr-name').value.trim(),
        address: $('#lr-address').value.trim(),
        phone: $('#lr-phone').value.trim(),
        website: $('#lr-website').value.trim(),
        cuisine: $('#lr-cuisine').value.trim(),
        hechsher: $('#lr-hechsher').value.trim(),
        category: $('#lr-category').value,
        delivery: $('#lr-delivery').checked,
        delivery_fee: feeRaw === '' ? null : Number(feeRaw),
        min_order: minRaw === '' ? null : Number(minRaw),
      });
      toast('Listing created — now add your menu from the dashboard');
      go('#/dashboard');
    } catch (err) { toast(err.message); }
  };
}

// ---------------------------------------------------------------------------
// Auth + modal + top bar
// ---------------------------------------------------------------------------
function openModal(title, bodyHtml) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-overlay').classList.remove('hidden');
  return $('#modal-body');
}
function closeModal() { $('#modal-overlay').classList.add('hidden'); }
$('#modal-close').onclick = closeModal;
$('#modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });

let afterAuth = null;
function openAuth(mode, cb) {
  afterAuth = cb || null;
  const isOwner = mode === 'signup-owner';
  const body = openModal(isOwner ? 'Create an owner account' : (mode === 'signup' ? 'Sign up' : 'Log in'), `
    <input id="auth-username" type="text" placeholder="Username" autocomplete="username">
    ${mode !== 'login' ? '<input id="auth-displayname" type="text" placeholder="Display name" maxlength="40">' : ''}
    <input id="auth-password" type="password" placeholder="Password" autocomplete="current-password">
    ${isOwner ? '<p style="color:var(--muted);font-size:.88rem">Owner accounts can list restaurants and manage menus and orders.</p>' : ''}
    <div id="auth-error" class="error hidden"></div>
    <button id="auth-submit" class="btn-primary">${mode === 'login' ? 'Log in' : 'Sign up'}</button>
    ${mode === 'login'
      ? '<button id="auth-switch" class="btn-ghost">No account? Sign up</button>'
      : '<button id="auth-switch" class="btn-ghost">Have an account? Log in</button>'}`);
  body.querySelector('#auth-submit').onclick = async () => {
    const username = body.querySelector('#auth-username').value.trim();
    const password = body.querySelector('#auth-password').value;
    const displayName = body.querySelector('#auth-displayname')?.value.trim();
    const err = body.querySelector('#auth-error');
    err.classList.add('hidden');
    try {
      const path = mode === 'login' ? '/api/login' : '/api/signup';
      const payload = mode === 'login' ? { username, password } : { username, display_name: displayName, password, role: isOwner ? 'owner' : 'customer' };
      const { user } = await api.post(path, payload);
      me = user;
      updateTopbar();
      closeModal();
      toast(`Welcome, ${user.display_name}`);
      if (afterAuth) { const cb2 = afterAuth; afterAuth = null; cb2(); }
    } catch (e2) { err.textContent = e2.message; err.classList.remove('hidden'); }
  };
  body.querySelector('#auth-switch').onclick = () => openAuth(mode === 'login' ? 'signup' : 'login', afterAuth);
}
function updateTopbar() {
  $('#btn-account').textContent = me ? me.display_name : 'Log in';
  $('#btn-dashboard').classList.toggle('hidden', !(me && me.role === 'owner'));
}
$('#btn-account').onclick = () => { if (me) go('#/account'); else openAuth('login'); };
$('#btn-orders').onclick = () => go('#/orders');
$('#btn-favorites').onclick = () => go('#/favorites');
$('#btn-dashboard').onclick = () => go('#/dashboard');
$('#logo-link').onclick = e => { e.preventDefault(); filters.q = ''; $('#global-search').value = ''; go('#/'); renderHome(); };
let searchDebounce = null;
$('#global-search').addEventListener('input', e => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    filters.q = e.target.value.trim();
    if ((location.hash || '#/') !== '#/') go('#/');
    else loadRestaurants();
  }, 300);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  try { meta = await api.get('/api/meta'); } catch { /* filters still work */ }
  try {
    const { user } = await api.get('/api/me');
    me = user;
  } catch { /* logged out */ }
  updateTopbar();
  renderCartCount();
  route();
}
boot();
