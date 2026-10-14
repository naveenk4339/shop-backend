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

// Columns added after the first release; added here so older databases keep working.
const productColumns = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
const NEW_PRODUCT_COLUMNS = {
  category: "TEXT NOT NULL DEFAULT 'Grocery'",
  list_price: 'REAL',
  rating: 'REAL NOT NULL DEFAULT 0',
  review_count: 'INTEGER NOT NULL DEFAULT 0',
};
for (const [column, type] of Object.entries(NEW_PRODUCT_COLUMNS)) {
  if (!productColumns.includes(column)) db.exec(`ALTER TABLE products ADD COLUMN ${column} ${type}`);
}

// [id, name, category, price, list price (null = no discount), rating, reviews, emoji]
const SEED_PRODUCTS = [
  [1, 'Fresh Gala Apples, 3 lb Bag', 'Grocery', 4.99, 5.49, 4.6, 2341, '🍎'],
  [2, 'Artisan Sourdough Bread Loaf, 24 oz', 'Grocery', 5.49, null, 4.4, 812, '🍞'],
  [3, 'Organic Whole Milk, 1 Gallon', 'Grocery', 6.29, null, 4.7, 1530, '🥛'],
  [4, 'Aged White Cheddar Cheese, 8 oz', 'Grocery', 5.75, 6.99, 4.5, 967, '🧀'],
  [5, 'Medium Roast Whole Bean Coffee, 2 lb', 'Grocery', 18.99, 24.99, 4.6, 8754, '☕'],
  [6, 'Large Brown Eggs, 12 Count', 'Grocery', 4.19, null, 4.3, 642, '🥚'],
  [7, 'Wireless Noise Cancelling Headphones', 'Electronics', 129.99, 179.99, 4.5, 15872, '🎧'],
  [8, 'Smart Watch with Heart Rate Monitor', 'Electronics', 89.99, 119.99, 4.2, 6321, '⌚'],
  [9, 'Portable Bluetooth Speaker, Waterproof', 'Electronics', 39.99, 49.99, 4.6, 22104, '🔊'],
  [10, 'Non-Stick Frying Pan, 12 inch', 'Home & Kitchen', 29.99, 39.99, 4.4, 4410, '🍳'],
  [11, 'Insulated Stainless Steel Tumbler, 32 oz', 'Home & Kitchen', 24.95, null, 4.8, 31987, '🥤'],
  [12, 'Lavender Scented Soy Candle, 14 oz', 'Home & Kitchen', 14.99, null, 4.3, 1208, '🕯️'],
  [13, 'The Pragmatic Programmer (Paperback)', 'Books', 39.99, 49.99, 4.8, 5523, '📘'],
  [14, "Beginner's Cookbook: 100 Easy Recipes", 'Books', 17.99, null, 4.5, 733, '📗'],
];

// Insert new products and refresh existing ones so the catalog stays current.
const upsertProduct = db.prepare(
  `INSERT INTO products (id, name, category, price, list_price, rating, review_count, emoji)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (id) DO UPDATE SET
     name = excluded.name, category = excluded.category, price = excluded.price,
     list_price = excluded.list_price, rating = excluded.rating,
     review_count = excluded.review_count, emoji = excluded.emoji`
);
for (const p of SEED_PRODUCTS) upsertProduct.run(...p);

export default db;
