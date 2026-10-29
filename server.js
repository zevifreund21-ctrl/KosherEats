// KosherEats — kosher food delivery for Brooklyn, NY.
// Stack: Node.js + Express + node:sqlite (single DB file). No build step.
// Data rule: restaurant listings and menu items come from verified research
// (research/restaurants.json) or from restaurant owners themselves. The app
// never invents a restaurant, a menu item, or a price.
// Orders are order requests: the restaurant confirms by phone, and payment
// happens on delivery/pickup. No payments are processed in this app.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'koshereats.db');

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','owner')),
  phone TEXT,
  address TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  order_url TEXT,
  cuisine TEXT,
  category TEXT NOT NULL CHECK (category IN ('meat','dairy','pareve','bakery')),
  hechsher TEXT,
  price_level TEXT,
  hours TEXT,
  delivery INTEGER,
  delivery_fee REAL,
  min_order REAL,
  rating REAL,
  rating_source TEXT,
  source_urls TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price REAL,
  section TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, restaurant_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  type TEXT NOT NULL CHECK (type IN ('delivery','pickup')),
  status TEXT NOT NULL DEFAULT 'placed'
    CHECK (status IN ('placed','confirmed','preparing','on_the_way','delivered','cancelled')),
  address TEXT,
  phone TEXT,
  notes TEXT,
  subtotal REAL NOT NULL,
  delivery_fee REAL,
  total REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  qty INTEGER NOT NULL,
  note TEXT
);
`);

// Auto-seed verified restaurant data on first boot only (empty table;
// never overwrites owner-added listings). Without this a fresh deploy
// would serve an empty restaurant list.
try { require('./seed').seedDb(db); } catch (e) { console.error('Auto-seed failed:', e.message); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function now() { return Date.now(); }
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const attempt = crypto.scryptSync(password, parts[0], 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(parts[1], 'hex'), Buffer.from(attempt, 'hex'));
}
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function getSessionUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) || null;
}
function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.user = user;
  next();
}
function publicUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role, phone: row.phone || null, address: row.address || null };
}

// Open-now: hours is JSON {mon:{open:"11:00",close:"22:00"},...} in 24h local
// time (America/New_York). Returns true/false/null (null = hours unknown).
function isOpenNow(restaurant) {
  let hours = null;
  try { hours = restaurant.hours ? JSON.parse(restaurant.hours) : null; } catch { hours = null; }
  if (!hours) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value;
  const dayKey = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' }[get('weekday')];
  const day = hours[dayKey];
  if (!day || day.closed) return false;
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  const open = toMin(day.open), close = toMin(day.close);
  if (close <= open) return mins >= open || mins < close; // past-midnight close
  return mins >= open && mins < close;
}
function restaurantShape(row, meId) {
  const fav = meId ? !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND restaurant_id = ?').get(meId, row.id) : false;
  let hours = null;
  try { hours = row.hours ? JSON.parse(row.hours) : null; } catch { hours = null; }
  return {
    id: row.id, owner_id: row.owner_id, name: row.name, address: row.address,
    phone: row.phone || null, website: row.website || null, order_url: row.order_url || null,
    cuisine: row.cuisine || null, category: row.category, hechsher: row.hechsher || null,
    price_level: row.price_level || null, hours, delivery: row.delivery === null ? null : !!row.delivery,
    delivery_fee: row.delivery_fee, min_order: row.min_order,
    rating: row.rating, rating_source: row.rating_source || null,
    verified: !!row.verified, open_now: isOpenNow(row), favorite: fav,
  };
}
function menuShape(row) {
  return { id: row.id, restaurant_id: row.restaurant_id, name: row.name, description: row.description || null, price: row.price, section: row.section || null, available: !!row.available };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------
const USERNAME_RE = /^[a-zA-Z0-9._]{3,20}$/;
app.post('/api/signup', (req, res) => {
  const { username, display_name, password, role } = req.body || {};
  if (!username || !USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3–20 letters, numbers, dots or underscores.' });
  if (!display_name || display_name.trim().length < 1 || display_name.length > 40) return res.status(400).json({ error: 'Display name is required.' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  const safeRole = role === 'owner' ? 'owner' : 'customer';
  try {
    const r = db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(username, display_name.trim(), hashPassword(password), safeRole, now());
    const token = newToken();
    db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, Number(r.lastInsertRowid), now());
    res.cookie('session', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 3600 * 1000 });
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid))) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'That username is already taken.' });
    throw e;
  }
});
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username || '');
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, user.id, now());
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 3600 * 1000 });
  res.json({ user: publicUser(user) });
});
app.post('/api/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(parseCookies(req).session);
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true });
});
app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
app.put('/api/me', requireAuth, (req, res) => {
  const { display_name, phone, address } = req.body || {};
  if (display_name !== undefined) {
    if (!display_name || display_name.trim().length < 1 || display_name.length > 40) return res.status(400).json({ error: 'Display name is required.' });
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name.trim(), req.user.id);
  }
  if (phone !== undefined) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(String(phone).slice(0, 30) || null, req.user.id);
  if (address !== undefined) db.prepare('UPDATE users SET address = ? WHERE id = ?').run(String(address).slice(0, 200) || null, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// ---------------------------------------------------------------------------
// Restaurants API
// ---------------------------------------------------------------------------
app.get('/api/meta', (req, res) => {
  const cuisines = db.prepare('SELECT DISTINCT cuisine FROM restaurants WHERE cuisine IS NOT NULL ORDER BY cuisine').all().map(r => r.cuisine);
  const hechshers = db.prepare('SELECT DISTINCT hechsher FROM restaurants WHERE hechsher IS NOT NULL ORDER BY hechsher').all().map(r => r.hechsher);
  res.json({ cuisines, hechshers, categories: ['meat', 'dairy', 'pareve', 'bakery'] });
});

app.get('/api/restaurants', (req, res) => {
  const me = getSessionUser(req);
  const q = String(req.query.q || '').trim().toLowerCase();
  const category = String(req.query.category || '');
  const cuisine = String(req.query.cuisine || '');
  const hechsher = String(req.query.hechsher || '');
  const openNow = req.query.open_now === '1';
  const sort = String(req.query.sort || 'recommended');
  let rows = db.prepare('SELECT * FROM restaurants ORDER BY name COLLATE NOCASE').all();
  let list = rows.map(r => restaurantShape(r, me?.id));
  if (q) list = list.filter(r => (r.name + ' ' + (r.cuisine || '') + ' ' + r.address).toLowerCase().includes(q));
  if (category) list = list.filter(r => r.category === category);
  if (cuisine) list = list.filter(r => r.cuisine === cuisine);
  if (hechsher) list = list.filter(r => r.hechsher === hechsher);
  if (openNow) list = list.filter(r => r.open_now === true);
  if (sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else list.sort((a, b) => ((b.open_now ? 1 : 0) - (a.open_now ? 1 : 0)) || ((b.rating || 0) - (a.rating || 0)));
  res.json({ restaurants: list });
});

app.get('/api/restaurants/:id', (req, res) => {
  const me = getSessionUser(req);
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Restaurant not found.' });
  const menu = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY id').all(row.id).map(menuShape);
  res.json({ restaurant: restaurantShape(row, me?.id), menu });
});

function validateRestaurantBody(body) {
  const { name, address, category } = body || {};
  if (!name || !String(name).trim()) return 'Restaurant name is required.';
  if (!address || !String(address).trim()) return 'Address is required.';
  if (!['meat', 'dairy', 'pareve', 'bakery'].includes(category)) return 'Pick meat, dairy, pareve, or bakery.';
  return null;
}
app.post('/api/restaurants', requireAuth, (req, res) => {
  const err = validateRestaurantBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  let hours = null;
  if (b.hours) {
    if (typeof b.hours === 'string') { try { hours = JSON.parse(b.hours); } catch { return res.status(400).json({ error: 'Hours must be valid JSON.' }); } }
    else hours = b.hours;
  }
  const r = db.prepare(
    `INSERT INTO restaurants (owner_id, name, address, phone, website, order_url, cuisine, category, hechsher, price_level, hours, delivery, delivery_fee, min_order, verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(req.user.id, String(b.name).trim().slice(0, 80), String(b.address).trim().slice(0, 200),
    b.phone ? String(b.phone).slice(0, 30) : null, b.website || null, b.order_url || null,
    b.cuisine ? String(b.cuisine).slice(0, 40) : null, b.category,
    b.hechsher ? String(b.hechsher).slice(0, 40) : null, b.price_level || null,
    hours ? JSON.stringify(hours) : null,
    b.delivery === undefined ? null : (b.delivery ? 1 : 0),
    b.delivery_fee === undefined || b.delivery_fee === null ? null : Number(b.delivery_fee),
    b.min_order === undefined || b.min_order === null ? null : Number(b.min_order), now());
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(r.lastInsertRowid));
  res.json({ restaurant: restaurantShape(row, req.user.id) });
});
app.put('/api/restaurants/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Restaurant not found.' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the restaurant owner can edit this listing.' });
  const err = validateRestaurantBody({ ...row, ...req.body });
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  let hours = row.hours;
  if (b.hours !== undefined) hours = typeof b.hours === 'string' ? b.hours : JSON.stringify(b.hours);
  db.prepare(
    `UPDATE restaurants SET name=?, address=?, phone=?, website=?, order_url=?, cuisine=?, category=?, hechsher=?, price_level=?, hours=?, delivery=?, delivery_fee=?, min_order=? WHERE id=?`
  ).run(String(b.name ?? row.name).trim().slice(0, 80), String(b.address ?? row.address).trim().slice(0, 200),
    b.phone !== undefined ? (b.phone ? String(b.phone).slice(0, 30) : null) : row.phone,
    b.website !== undefined ? (b.website || null) : row.website,
    b.order_url !== undefined ? (b.order_url || null) : row.order_url,
    b.cuisine !== undefined ? (b.cuisine ? String(b.cuisine).slice(0, 40) : null) : row.cuisine,
    b.category ?? row.category,
    b.hechsher !== undefined ? (b.hechsher ? String(b.hechsher).slice(0, 40) : null) : row.hechsher,
    b.price_level !== undefined ? (b.price_level || null) : row.price_level,
    hours,
    b.delivery !== undefined ? (b.delivery ? 1 : 0) : row.delivery,
    b.delivery_fee !== undefined ? (b.delivery_fee === null ? null : Number(b.delivery_fee)) : row.delivery_fee,
    b.min_order !== undefined ? (b.min_order === null ? null : Number(b.min_order)) : row.min_order,
    row.id);
  res.json({ restaurant: restaurantShape(db.prepare('SELECT * FROM restaurants WHERE id = ?').get(row.id), req.user.id) });
});

// Menu item CRUD (owner only).
function requireOwner(req, res, next) {
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Restaurant not found.' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the restaurant owner can change the menu.' });
  req.restaurant = row;
  next();
}
app.post('/api/restaurants/:id/menu', requireAuth, requireOwner, (req, res) => {
  const { name, description, price, section } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Item name is required.' });
  const p = price === null || price === undefined || price === '' ? null : Number(price);
  if (p !== null && (!Number.isFinite(p) || p < 0)) return res.status(400).json({ error: 'Price must be a number or left blank.' });
  const r = db.prepare('INSERT INTO menu_items (restaurant_id, name, description, price, section, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.restaurant.id, String(name).trim().slice(0, 100), description ? String(description).slice(0, 300) : null, p, section ? String(section).slice(0, 40) : null, now());
  res.json({ item: menuShape(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(r.lastInsertRowid))) });
});
app.put('/api/restaurants/:id/menu/:itemId', requireAuth, requireOwner, (req, res) => {
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?').get(Number(req.params.itemId), req.restaurant.id);
  if (!item) return res.status(404).json({ error: 'Menu item not found.' });
  const { name, description, price, section, available } = req.body || {};
  const p = price === undefined ? item.price : (price === null || price === '' ? null : Number(price));
  if (p !== null && (!Number.isFinite(p) || p < 0)) return res.status(400).json({ error: 'Price must be a number or left blank.' });
  db.prepare('UPDATE menu_items SET name=?, description=?, price=?, section=?, available=? WHERE id=?')
    .run(name !== undefined ? String(name).trim().slice(0, 100) : item.name,
      description !== undefined ? (description ? String(description).slice(0, 300) : null) : item.description,
      p, section !== undefined ? (section ? String(section).slice(0, 40) : null) : item.section,
      available !== undefined ? (available ? 1 : 0) : item.available, item.id);
  res.json({ item: menuShape(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(item.id)) });
});
app.delete('/api/restaurants/:id/menu/:itemId', requireAuth, requireOwner, (req, res) => {
  db.prepare('DELETE FROM menu_items WHERE id = ? AND restaurant_id = ?').run(Number(req.params.itemId), req.restaurant.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------
app.get('/api/favorites', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT r.* FROM favorites f JOIN restaurants r ON r.id = f.restaurant_id WHERE f.user_id = ? ORDER BY r.name'
  ).all(req.user.id);
  res.json({ restaurants: rows.map(r => restaurantShape(r, req.user.id)) });
});
app.post('/api/favorites/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM restaurants WHERE id = ?').get(id)) return res.status(404).json({ error: 'Restaurant not found.' });
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, restaurant_id, created_at) VALUES (?, ?, ?)').run(req.user.id, id, now());
  res.json({ ok: true });
});
app.delete('/api/favorites/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND restaurant_id = ?').run(req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
function orderShape(order, meId) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id)
    .map(i => ({ id: i.id, menu_item_id: i.menu_item_id, name: i.name, price: i.price, qty: i.qty, note: i.note || null }));
  const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(order.restaurant_id);
  return {
    id: order.id, user_id: order.user_id, restaurant_id: order.restaurant_id,
    restaurant_name: rest?.name || 'Restaurant', restaurant_phone: rest?.phone || null,
    type: order.type, status: order.status, address: order.address || null,
    phone: order.phone || null, notes: order.notes || null,
    subtotal: order.subtotal, delivery_fee: order.delivery_fee, total: order.total,
    items, created_at: order.created_at, updated_at: order.updated_at,
  };
}
app.post('/api/orders', requireAuth, (req, res) => {
  const { restaurant_id, type, address, phone, notes, items } = req.body || {};
  const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(restaurant_id));
  if (!rest) return res.status(404).json({ error: 'Restaurant not found.' });
  if (type !== 'delivery' && type !== 'pickup') return res.status(400).json({ error: 'Choose delivery or pickup.' });
  if (type === 'delivery' && rest.delivery === 0) return res.status(400).json({ error: 'This restaurant does not deliver.' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your cart is empty.' });
  let subtotal = 0;
  const lines = [];
  for (const it of items) {
    const menu = db.prepare('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ? AND available = 1').get(Number(it.menu_item_id), rest.id);
    if (!menu) return res.status(400).json({ error: 'An item in your cart is no longer available.' });
    if (menu.price === null) return res.status(400).json({ error: `“${menu.name}” has no listed price — please call the restaurant to order it.` });
    const qty = Math.max(1, Math.min(50, Number(it.qty) || 1));
    subtotal += menu.price * qty;
    lines.push({ menu, qty, note: it.note ? String(it.note).slice(0, 200) : null });
  }
  subtotal = Math.round(subtotal * 100) / 100;
  if (rest.min_order !== null && subtotal < rest.min_order) {
    return res.status(400).json({ error: `Minimum order is $${rest.min_order.toFixed(2)}.` });
  }
  const fee = type === 'delivery' ? rest.delivery_fee : null;
  const total = Math.round((subtotal + (fee || 0)) * 100) / 100;
  const r = db.prepare(
    `INSERT INTO orders (user_id, restaurant_id, type, status, address, phone, notes, subtotal, delivery_fee, total, created_at, updated_at)
     VALUES (?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.user.id, rest.id, type, type === 'delivery' ? String(address || req.user.address || '').slice(0, 200) : null,
    String(phone || req.user.phone || '').slice(0, 30), notes ? String(notes).slice(0, 500) : null,
    subtotal, fee, total, now(), now());
  const orderId = Number(r.lastInsertRowid);
  for (const l of lines) {
    db.prepare('INSERT INTO order_items (order_id, menu_item_id, name, price, qty, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(orderId, l.menu.id, l.menu.name, l.menu.price, l.qty, l.note);
  }
  res.json({ order: orderShape(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId), req.user.id) });
});
app.get('/api/orders', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ orders: rows.map(o => orderShape(o, req.user.id)) });
});
app.get('/api/orders/:id', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(order.restaurant_id);
  if (order.user_id !== req.user.id && rest?.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your order.' });
  res.json({ order: orderShape(order, req.user.id) });
});
const OWNER_STATUSES = ['confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled'];
app.put('/api/orders/:id/status', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(order.restaurant_id);
  const { status } = req.body || {};
  if (rest?.owner_id === req.user.id) {
    if (!OWNER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), order.id);
  } else if (order.user_id === req.user.id) {
    if (status !== 'cancelled' || order.status !== 'placed') {
      return res.status(403).json({ error: 'You can only cancel an order that has not been confirmed yet.' });
    }
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', now(), order.id);
  } else {
    return res.status(403).json({ error: 'Not your order.' });
  }
  res.json({ order: orderShape(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id), req.user.id) });
});
app.get('/api/restaurants/:id/orders', requireAuth, (req, res) => {
  const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(req.params.id));
  if (!rest) return res.status(404).json({ error: 'Restaurant not found.' });
  if (rest.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the restaurant owner can view these orders.' });
  const rows = db.prepare('SELECT * FROM orders WHERE restaurant_id = ? ORDER BY id DESC LIMIT 100').all(rest.id);
  res.json({ orders: rows.map(o => orderShape(o, req.user.id)) });
});
app.get('/api/my-restaurants', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM restaurants WHERE owner_id = ? ORDER BY name').all(req.user.id);
  res.json({ restaurants: rows.map(r => restaurantShape(r, req.user.id)) });
});

app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`KosherEats listening on http://localhost:${PORT}`);
});
