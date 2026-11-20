// End-to-end tests for promo codes: start the real server on a spare port with a throwaway database.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 5900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'shop-coupon-test-'));
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
  return { status: res.status, data: await res.json() };
}

let userCount = 0;
async function shopperWithCart(items) {
  const email = `promo${++userCount}-${Date.now()}@example.com`;
  const { data } = await call('POST', '/register', { body: { email, password: 'secret123' } });
  for (const [id, qty] of items) await call('PUT', `/cart/${id}`, { token: data.token, body: { qty } });
  return data.token;
}

const card = { name: 'Test Shopper', number: '4242 4242 4242 4242', expiry: '12/30', cvv: '123' };

test('checking a code needs sign-in and a non-empty cart', async () => {
  assert.equal((await call('POST', '/coupons/check', { body: { code: 'SAVE10' } })).status, 401);
  const token = await shopperWithCart([]);
  const { status, data } = await call('POST', '/coupons/check', { token, body: { code: 'SAVE10' } });
  assert.equal(status, 400);
  assert.equal(data.error, 'Your cart is empty.');
});

test('checking SAVE10 shows the discount on the current cart', async () => {
  const token = await shopperWithCart([[7, 2], [1, 3]]); // $259.98 + $14.97 = $274.95
  const { status, data } = await call('POST', '/coupons/check', { token, body: { code: 'save10' } });
  assert.equal(status, 200);
  assert.deepEqual(data, { code: 'SAVE10', label: '10% off your order', subtotal: 274.95, discount: 27.5, total: 247.45 });
});

test('checking an invalid code or one below its minimum is a 400 with a reason', async () => {
  const token = await shopperWithCart([[1, 1]]); // $4.99
  assert.equal((await call('POST', '/coupons/check', { token, body: { code: 'NOPE' } })).data.error, 'That promo code is not valid.');
  const small = await call('POST', '/coupons/check', { token, body: { code: 'WELCOME5' } });
  assert.equal(small.status, 400);
  assert.equal(small.data.error, 'WELCOME5 needs an order of at least $25.00.');
});

test('checkout with a code charges the discounted total and records it on the order', async () => {
  const token = await shopperWithCart([[7, 2], [1, 3]]);
  const { status, data: order } = await call('POST', '/checkout', { token, body: { card, couponCode: 'SAVE10' } });
  assert.equal(status, 201);
  assert.equal(order.subtotal, 274.95);
  assert.equal(order.discount, 27.5);
  assert.equal(order.couponCode, 'SAVE10');
  assert.equal(order.totalAmount, 247.45);
  assert.equal((await call('GET', `/orders/${order.id}`, { token })).data.totalAmount, 247.45);
});

test('WELCOME5 takes $5 off a big enough order', async () => {
  const token = await shopperWithCart([[9, 1]]); // $39.99
  const { data: order } = await call('POST', '/checkout', { token, body: { card, couponCode: 'WELCOME5' } });
  assert.equal(order.totalAmount, 34.99);
  assert.equal(order.discount, 5);
});

test('an invalid code at checkout charges nothing and keeps the cart', async () => {
  const token = await shopperWithCart([[2, 1]]); // $5.49
  const { status, data } = await call('POST', '/checkout', { token, body: { card, couponCode: 'WELCOME5' } });
  assert.equal(status, 400);
  assert.equal(data.fields.coupon, 'WELCOME5 needs an order of at least $25.00.');
  assert.equal((await call('GET', '/cart', { token })).data.length, 1);
  assert.deepEqual((await call('GET', '/orders', { token })).data, []);
});

test('without a code nothing changes: no discount, full price', async () => {
  const token = await shopperWithCart([[3, 2]]); // $12.58
  const { data: order } = await call('POST', '/checkout', { token, body: { card } });
  assert.equal(order.totalAmount, 12.58);
  assert.equal(order.subtotal, 12.58);
  assert.equal(order.discount, 0);
  assert.equal(order.couponCode, null);
});

test('a discount sent by the browser is ignored', async () => {
  const token = await shopperWithCart([[3, 2]]);
  const { data: order } = await call('POST', '/checkout', {
    token,
    body: { card, couponCode: 'SAVE10', discount: 12.58, discountCents: 1258, totalAmount: 0.01 },
  });
  assert.equal(order.discount, 1.26);
  assert.equal(order.totalAmount, 11.32);
});
