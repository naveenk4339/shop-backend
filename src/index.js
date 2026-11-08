import express from 'express';
import cors from 'cors';
import db from './db.js';
import { createSession, hashPassword, isDisabledDemoUser, migrateSessions, requireAuth, seedDemoUser, verifyPassword } from './auth.js';
import { chargeCard, newOrderId, validateCard } from './payment.js';

seedDemoUser();
migrateSessions();

const app = express();
// Only the frontend's address may call the API from a browser.
// Comma-separate several origins, or use * to allow any.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());
app.use(cors({ origin: allowedOrigins.includes('*') ? true : allowedOrigins }));
app.use(express.json());

const MAX_QTY = 10; // most of one item a customer can buy
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials(email, password) {
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
    return 'Please enter a valid email address.';
  }
  if (typeof password !== 'string' || password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}

function getCart(userId) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.price, p.emoji, c.qty
       FROM cart_items c JOIN products p ON p.id = c.product_id
       WHERE c.user_id = ? ORDER BY p.id`
    )
    .all(userId);
}

function getSaved(userId) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.price, p.emoji, s.qty
       FROM saved_items s JOIN products p ON p.id = s.product_id
       WHERE s.user_id = ? ORDER BY s.saved_at DESC, s.rowid DESC`
    )
    .all(userId);
}

// Responses for "Save for later" actions carry both lists, since a move changes both.
const cartAndSaved = (userId) => ({ cart: getCart(userId), saved: getSaved(userId) });

// --- Auth ---

app.post('/api/register', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;
  const error = validateCredentials(email, password);
  if (error) return res.status(400).json({ error });

  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists || isDisabledDemoUser(email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(email, hashPassword(password));
  const userId = Number(lastInsertRowid);
  res.status(201).json({ token: createSession(userId), user: { id: userId, email } });
});

app.post('/api/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;
  const error = validateCredentials(email, password);
  if (error) return res.status(400).json({ error });

  const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email);
  if (!user || isDisabledDemoUser(email) || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  res.json({ token: createSession(user.id), user: { id: user.id, email: user.email } });
});

app.post('/api/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionKey);
  res.status(204).end();
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// --- Products & cart ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/products', (req, res) => {
  const products = db
    .prepare(
      `SELECT id, name, category, price, list_price AS listPrice, rating,
              review_count AS reviewCount, emoji, highlights
       FROM products ORDER BY id`
    )
    .all();
  res.json(products.map((p) => ({ ...p, highlights: JSON.parse(p.highlights) })));
});

app.get('/api/cart', requireAuth, (req, res) => {
  res.json(getCart(req.user.id));
});

// Set the quantity of one product in the cart; qty 0 removes it.
app.put('/api/cart/:productId', requireAuth, (req, res) => {
  const productId = Number(req.params.productId);
  const qty = Number(req.body.qty);
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) {
    return res.status(400).json({ error: `Quantity must be a whole number from 0 to ${MAX_QTY}.` });
  }
  const product = db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  if (qty === 0) {
    db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, productId);
  } else {
    db.prepare(
      `INSERT INTO cart_items (user_id, product_id, qty) VALUES (?, ?, ?)
       ON CONFLICT (user_id, product_id) DO UPDATE SET qty = excluded.qty`
    ).run(req.user.id, productId, qty);
  }
  res.json(getCart(req.user.id));
});

app.delete('/api/cart', requireAuth, (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
  res.json([]);
});

// --- Save for later ---

const productExists = (productId) => Boolean(db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId));

app.get('/api/saved', requireAuth, (req, res) => {
  res.json(getSaved(req.user.id));
});

// Moves a product out of the cart (if it's there) into the saved list, keeping its quantity.
const saveForLater = db.transaction((userId, productId) => {
  const inCart = db.prepare('SELECT qty FROM cart_items WHERE user_id = ? AND product_id = ?').get(userId, productId);
  db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(userId, productId);
  db.prepare(
    `INSERT INTO saved_items (user_id, product_id, qty) VALUES (?, ?, ?)
     ON CONFLICT (user_id, product_id) DO UPDATE SET qty = MIN(qty + excluded.qty, ?)`
  ).run(userId, productId, inCart?.qty ?? 1, MAX_QTY);
});

app.post('/api/saved/:productId', requireAuth, (req, res) => {
  const productId = Number(req.params.productId);
  if (!productExists(productId)) return res.status(404).json({ error: 'Product not found.' });
  saveForLater(req.user.id, productId);
  res.json(cartAndSaved(req.user.id));
});

// Moves a saved product back to the cart with its saved quantity (never above the limit).
const moveToCart = db.transaction((userId, saved) => {
  db.prepare('DELETE FROM saved_items WHERE user_id = ? AND product_id = ?').run(userId, saved.product_id);
  db.prepare(
    `INSERT INTO cart_items (user_id, product_id, qty) VALUES (?, ?, MIN(?, ?))
     ON CONFLICT (user_id, product_id) DO UPDATE SET qty = MIN(qty + excluded.qty, ?)`
  ).run(userId, saved.product_id, saved.qty, MAX_QTY, MAX_QTY);
});

app.post('/api/saved/:productId/move-to-cart', requireAuth, (req, res) => {
  const productId = Number(req.params.productId);
  const saved = db
    .prepare('SELECT product_id, qty FROM saved_items WHERE user_id = ? AND product_id = ?')
    .get(req.user.id, productId);
  if (!saved) return res.status(404).json({ error: 'That item is not in your saved list.' });
  moveToCart(req.user.id, saved);
  res.json(cartAndSaved(req.user.id));
});

app.delete('/api/saved/:productId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM saved_items WHERE user_id = ? AND product_id = ?').run(req.user.id, Number(req.params.productId));
  res.json(cartAndSaved(req.user.id));
});

// --- Checkout & orders ---

function getOrder(orderId, userId) {
  const order = db
    .prepare(
      `SELECT id, total_items, total_amount_cents, status, card_brand, card_last4, created_at
       FROM orders WHERE id = ? AND user_id = ?`
    )
    .get(orderId, userId);
  if (!order) return null;
  const items = db
    .prepare(
      `SELECT product_id, name, unit_price_cents, qty, line_total_cents
       FROM order_items WHERE order_id = ? ORDER BY product_id`
    )
    .all(orderId);
  return {
    id: order.id,
    status: order.status,
    totalItems: order.total_items,
    totalAmount: order.total_amount_cents / 100,
    card: { brand: order.card_brand, last4: order.card_last4 },
    createdAt: order.created_at,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name,
      price: i.unit_price_cents / 100,
      qty: i.qty,
      lineTotal: i.line_total_cents / 100,
    })),
  };
}

const saveOrder = db.transaction((orderId, userId, lines, totals, card) => {
  db.prepare(
    `INSERT INTO orders (id, user_id, total_items, total_amount_cents, status, card_brand, card_last4)
     VALUES (?, ?, ?, ?, 'APPROVED', ?, ?)`
  ).run(orderId, userId, totals.items, totals.cents, card.brand, card.last4);
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, name, unit_price_cents, qty, line_total_cents)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const l of lines) insertItem.run(orderId, l.id, l.name, l.unitCents, l.qty, l.unitCents * l.qty);
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
});

// Pays for the current cart. Totals are always computed from the saved cart,
// never taken from the browser.
app.post('/api/checkout', requireAuth, (req, res) => {
  const lines = getCart(req.user.id).map((l) => ({ ...l, unitCents: Math.round(l.price * 100) }));
  if (lines.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

  const { errors, card } = validateCard(req.body.card);
  if (errors) return res.status(400).json({ error: 'Please check your card details.', fields: errors });

  const totals = {
    items: lines.reduce((sum, l) => sum + l.qty, 0),
    cents: lines.reduce((sum, l) => sum + l.unitCents * l.qty, 0),
  };
  const payment = chargeCard(card, totals.cents);
  if (!payment.approved) return res.status(402).json({ error: payment.reason });

  const orderId = newOrderId();
  saveOrder(orderId, req.user.id, lines, totals, card);
  res.status(201).json(getOrder(orderId, req.user.id));
});

app.get('/api/orders', requireAuth, (req, res) => {
  const ids = db
    .prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(req.user.id);
  res.json(ids.map(({ id }) => getOrder(id, req.user.id)));
});

app.get('/api/orders/:orderId', requireAuth, (req, res) => {
  const order = getOrder(req.params.orderId, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(order);
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`Shop API listening on http://localhost:${PORT}`);
});
