// End-to-end API tests: start the real server on a spare port with a throwaway database.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 4100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'shop-test-'));
let server;

before(async () => {
  server = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'test.db'), NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
});

after(() => {
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method, route, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${route}`, { method, headers, body: body && JSON.stringify(body) });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

let userCount = 0;
async function newUser() {
  const email = `shopper${++userCount}-${Date.now()}@example.com`;
  const { status, data } = await call('POST', '/register', { body: { email, password: 'secret123' } });
  assert.equal(status, 201);
  return data.token;
}

const goodCard = { name: 'Test Shopper', number: '4242 4242 4242 4242', expiry: '12/30', cvv: '123' };

test('products are public and include details', async () => {
  const { status, data } = await call('GET', '/products');
  assert.equal(status, 200);
  assert.equal(data.length, 14);
  assert.ok(Array.isArray(data[0].highlights) && data[0].highlights.length > 0);
});

test('cart, checkout and orders require a valid token', async () => {
  for (const route of ['/cart', '/orders']) {
    assert.equal((await call('GET', route)).status, 401);
    assert.equal((await call('GET', route, { token: 'not-a-real-token' })).status, 401);
  }
  assert.equal((await call('POST', '/checkout', { body: { card: goodCard } })).status, 401);
});

test('demo account can sign in outside production', async () => {
  const { status, data } = await call('POST', '/login', { body: { email: 'demo@shop.com', password: 'demo123' } });
  assert.equal(status, 200);
  assert.ok(data.token);
});

test('wrong password is rejected', async () => {
  const { status } = await call('POST', '/login', { body: { email: 'demo@shop.com', password: 'wrong-pass' } });
  assert.equal(status, 401);
});

test('cart quantity must be 0-10 and the product must exist', async () => {
  const token = await newUser();
  assert.equal((await call('PUT', '/cart/1', { token, body: { qty: 11 } })).status, 400);
  assert.equal((await call('PUT', '/cart/1', { token, body: { qty: -1 } })).status, 400);
  assert.equal((await call('PUT', '/cart/1', { token, body: { qty: 1.5 } })).status, 400);
  assert.equal((await call('PUT', '/cart/999', { token, body: { qty: 1 } })).status, 404);
  const { data } = await call('PUT', '/cart/1', { token, body: { qty: 10 } });
  assert.deepEqual(data.map((l) => [l.id, l.qty]), [[1, 10]]);
  const cleared = await call('PUT', '/cart/1', { token, body: { qty: 0 } });
  assert.deepEqual(cleared.data, []);
});

test('checkout with an empty cart is refused', async () => {
  const token = await newUser();
  const { status, data } = await call('POST', '/checkout', { token, body: { card: goodCard } });
  assert.equal(status, 400);
  assert.equal(data.error, 'Your cart is empty.');
});

test('invalid card details come back per field and nothing is charged', async () => {
  const token = await newUser();
  await call('PUT', '/cart/2', { token, body: { qty: 1 } });
  const { status, data } = await call('POST', '/checkout', {
    token,
    body: { card: { name: '', number: '4242 4242 4242 4241', expiry: '01/20', cvv: '1' } },
  });
  assert.equal(status, 400);
  assert.deepEqual(Object.keys(data.fields).sort(), ['cvv', 'expiry', 'name', 'number']);
  assert.equal((await call('GET', '/cart', { token })).data.length, 1);
  assert.deepEqual((await call('GET', '/orders', { token })).data, []);
});

test('a declined card leaves the cart alone and creates no order', async () => {
  const token = await newUser();
  await call('PUT', '/cart/3', { token, body: { qty: 2 } });
  const { status, data } = await call('POST', '/checkout', {
    token,
    body: { card: { ...goodCard, number: '4000 0000 0000 0002' } },
  });
  assert.equal(status, 402);
  assert.equal(data.error, 'Your card was declined. Try a different card.');
  assert.deepEqual((await call('GET', '/cart', { token })).data.map((l) => [l.id, l.qty]), [[3, 2]]);
  assert.deepEqual((await call('GET', '/orders', { token })).data, []);
});

test('an approved payment charges the server-side total, saves the order and empties the cart', async () => {
  const token = await newUser();
  await call('PUT', '/cart/7', { token, body: { qty: 2 } }); // 2 x $129.99
  await call('PUT', '/cart/1', { token, body: { qty: 3 } }); // 3 x $4.99
  // A tampered total in the request must be ignored.
  const { status, data: order } = await call('POST', '/checkout', {
    token,
    body: { card: goodCard, totalAmount: 0.01, items: [] },
  });
  assert.equal(status, 201);
  assert.equal(order.status, 'APPROVED');
  assert.equal(order.totalItems, 5);
  assert.equal(order.totalAmount, 274.95);
  assert.deepEqual(order.card, { brand: 'Visa', last4: '4242' });
  assert.deepEqual(
    order.items.map((i) => [i.productId, i.qty, i.lineTotal]),
    [[1, 3, 14.97], [7, 2, 259.98]]
  );
  assert.deepEqual((await call('GET', '/cart', { token })).data, []);
  const orders = (await call('GET', '/orders', { token })).data;
  assert.deepEqual(orders.map((o) => o.id), [order.id]);
  assert.equal((await call('GET', `/orders/${order.id}`, { token })).data.totalAmount, 274.95);
});

test("a shopper can't read someone else's order", async () => {
  const owner = await newUser();
  await call('PUT', '/cart/5', { token: owner, body: { qty: 1 } });
  const { data: order } = await call('POST', '/checkout', { token: owner, body: { card: goodCard } });
  const stranger = await newUser();
  assert.equal((await call('GET', `/orders/${order.id}`, { token: stranger })).status, 404);
});

test('a shopper can cancel their own order once', async () => {
  const token = await newUser();
  await call('PUT', '/cart/4', { token, body: { qty: 2 } });
  const { data: order } = await call('POST', '/checkout', { token, body: { card: goodCard } });

  const cancelled = await call('POST', `/orders/${order.id}/cancel`, { token });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.status, 'CANCELLED');
  assert.equal(cancelled.data.totalAmount, order.totalAmount);
  assert.equal((await call('GET', `/orders/${order.id}`, { token })).data.status, 'CANCELLED');

  const again = await call('POST', `/orders/${order.id}/cancel`, { token });
  assert.equal(again.status, 409);
  assert.equal(again.data.error, 'This order has already been cancelled.');
});

test("a shopper can't cancel someone else's order or a missing one", async () => {
  const owner = await newUser();
  await call('PUT', '/cart/6', { token: owner, body: { qty: 1 } });
  const { data: order } = await call('POST', '/checkout', { token: owner, body: { card: goodCard } });
  const stranger = await newUser();
  assert.equal((await call('POST', `/orders/${order.id}/cancel`, { token: stranger })).status, 404);
  assert.equal((await call('POST', '/orders/ORD-00000000-000000/cancel', { token: owner })).status, 404);
  assert.equal((await call('POST', `/orders/${order.id}/cancel`)).status, 401);
  assert.equal((await call('GET', `/orders/${order.id}`, { token: owner })).data.status, 'APPROVED');
});

test('after logout the token stops working', async () => {
  const token = await newUser();
  assert.equal((await call('POST', '/logout', { token })).status, 204);
  assert.equal((await call('GET', '/me', { token })).status, 401);
});
