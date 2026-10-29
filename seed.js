// Seed: loads verified restaurant research into an empty database.
// Runs automatically on server boot (see server.js) and can also be run
// once manually: `npm run seed` (requires the server to have created the
// schema at least once). Never overwrites owner-added listings; only fills
// an empty restaurants table.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'koshereats.db');
const RESEARCH = path.join(__dirname, 'research', 'restaurants.json');

// Seed using an already-open database handle (server boot path). The
// schema must already exist; returns the number of restaurants seeded.
function seedDb(db) {
  if (!fs.existsSync(RESEARCH)) {
    console.log('No research file yet — skipping seed.');
    return 0;
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM restaurants').get().n;
  if (count > 0) {
    console.log(`Restaurants table already has ${count} rows — skipping seed.`);
    return 0;
  }
  const data = JSON.parse(fs.readFileSync(RESEARCH, 'utf8'));
  const now = Date.now();
  let items = 0;
  for (const r of data) {
    const res = db.prepare(
      `INSERT INTO restaurants (owner_id, name, address, phone, website, order_url, cuisine, category, hechsher, price_level, hours, delivery, delivery_fee, min_order, rating, rating_source, source_urls, verified, created_at)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(r.name, r.address, r.phone || null, r.website || null, r.order_url || null,
      r.cuisine || null, r.category, r.hechsher || null, r.price_level || null,
      r.hours ? JSON.stringify(r.hours) : null,
      r.delivery === null || r.delivery === undefined ? null : (r.delivery ? 1 : 0),
      r.delivery_fee ?? null, r.min_order ?? null,
      r.rating ?? null, r.rating_source || null,
      r.sources ? JSON.stringify(r.sources) : null, now);
    const rid = Number(res.lastInsertRowid);
    for (const m of r.menu || []) {
      db.prepare('INSERT INTO menu_items (restaurant_id, name, description, price, section, available, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
        .run(rid, m.name, m.description || null, m.price ?? null, m.section || null, now);
      items++;
    }
  }
  console.log(`Seeded ${data.length} restaurants, ${items} menu items.`);
  return data.length;
}

// Standalone entry point: `npm run seed`. The schema is created by the
// server on boot; if it does not exist yet, say so instead of crashing.
function main() {
  const db = new DatabaseSync(DB_PATH);
  const table = db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='restaurants'"
  ).get().n;
  if (!table) {
    console.log('Schema not created yet — start the server once, then re-run seed.');
    return;
  }
  seedDb(db);
}

if (require.main === module) main();
module.exports = { main, seedDb };
