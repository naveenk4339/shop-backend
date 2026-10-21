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
  highlights: "TEXT NOT NULL DEFAULT '[]'", // JSON array of short "About this item" points
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

// "About this item" points shown on each product's page, keyed by product id.
const HIGHLIGHTS = {
  1: ['Crisp, sweet Gala apples picked at peak ripeness', 'About 8–10 medium apples per 3 lb bag', 'Great for snacking, lunch boxes and baking', 'Store in the fridge to keep them crunchy for weeks'],
  2: ['Slow-fermented for 24 hours for a tangy flavor', 'Crackly crust with a soft, open crumb', 'Made with just flour, water, salt and starter', 'Best within 3 days; slice and freeze to keep longer'],
  3: ['USDA certified organic whole milk', 'From pasture-raised cows, no added hormones', 'Rich and creamy with 3.25% milk fat', 'Keep refrigerated; use within 7 days of opening'],
  4: ['Aged 12 months for a sharp, nutty taste', 'Crumbly texture that melts smoothly', 'Pairs well with apples, crackers and wine', '8 oz block; rewrap tightly after opening'],
  5: ['100% Arabica beans, medium roast', 'Smooth body with notes of chocolate and caramel', 'Whole beans stay fresh longer; grind just before brewing', 'Works for drip, French press and pour-over'],
  6: ['A dozen large brown eggs from cage-free hens', 'Grade A, packed within days of laying', 'Good source of protein for any meal', 'Keep refrigerated in the carton'],
  7: ['Active noise cancelling blocks out traffic and office noise', 'Up to 30 hours of battery life; 10-minute quick charge gives 5 hours', 'Soft over-ear cushions for all-day comfort', 'Built-in microphone for calls and voice assistants', 'Bluetooth 5.3 with a range of about 30 ft'],
  8: ['Tracks heart rate, steps, sleep and calories', 'Up to 7 days of battery on a single charge', 'Water resistant for swimming and showers', 'Shows calls and app notifications from your phone'],
  9: ['Loud, clear 360° sound with deep bass', 'IPX7 waterproof for the pool, beach and shower', 'Up to 16 hours of playtime per charge', 'Pair two speakers for stereo sound'],
  10: ['Non-stick coating releases eggs and pancakes easily', '12-inch pan for family-size meals', 'Works on gas, electric and induction stovetops', 'Oven safe up to 450°F; stay-cool handle'],
  11: ['Double-wall vacuum insulation keeps drinks cold 24 hours or hot 12 hours', 'Holds 32 oz; fits most car cup holders', 'Leak-resistant lid with straw included', 'Dishwasher safe, BPA free'],
  12: ['Hand-poured natural soy wax', 'Calming lavender scent with essential oils', 'About 60 hours of burn time', 'Cotton wick for a clean, even burn'],
  13: ['Practical advice for writing flexible, maintainable code', 'Covers testing, debugging, automation and teamwork', 'Updated 20th anniversary edition', 'Paperback, 352 pages'],
  14: ['100 simple recipes for everyday cooking', 'Step-by-step instructions with photos', 'Covers breakfast, mains, sides and desserts', 'Includes a basic kitchen tools guide'],
};

// Insert new products and refresh existing ones so the catalog stays current.
const upsertProduct = db.prepare(
  `INSERT INTO products (id, name, category, price, list_price, rating, review_count, emoji, highlights)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (id) DO UPDATE SET
     name = excluded.name, category = excluded.category, price = excluded.price,
     list_price = excluded.list_price, rating = excluded.rating,
     review_count = excluded.review_count, emoji = excluded.emoji, highlights = excluded.highlights`
);
for (const p of SEED_PRODUCTS) upsertProduct.run(...p, JSON.stringify(HIGHLIGHTS[p[0]] || []));

export default db;
