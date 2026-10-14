import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(dir, '..', 'shop.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL,
    price REAL NOT NULL,
    emoji TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty        INTEGER NOT NULL CHECK (qty > 0),
    PRIMARY KEY (user_id, product_id)
  );

  -- Amounts are stored in cents to avoid rounding errors.
  -- Only the card brand and last 4 digits are kept, never the full number or CVV.
  CREATE TABLE IF NOT EXISTS orders (
    id                 TEXT PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_items        INTEGER NOT NULL,
    total_amount_cents INTEGER NOT NULL,
    status             TEXT NOT NULL,
    card_brand         TEXT NOT NULL,
    card_last4         TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    order_id         TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id       INTEGER NOT NULL REFERENCES products(id),
    name             TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    qty              INTEGER NOT NULL,
    line_total_cents INTEGER NOT NULL,
    PRIMARY KEY (order_id, product_id)
  );
`);

const SEED_PRODUCTS = [
  [1, 'Apple', 0.99, '🍎'],
  [2, 'Bread', 2.49, '🍞'],
  [3, 'Milk', 3.29, '🥛'],
  [4, 'Cheese', 5.75, '🧀'],
  [5, 'Coffee', 8.99, '☕'],
  [6, 'Eggs (12)', 4.19, '🥚'],
];

const insertProduct = db.prepare(
  'INSERT OR IGNORE INTO products (id, name, price, emoji) VALUES (?, ?, ?, ?)'
);
for (const p of SEED_PRODUCTS) insertProduct.run(...p);

export default db;
