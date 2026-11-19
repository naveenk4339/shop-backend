// End-to-end tests for "Save for later": start the real server on a spare port with a throwaway database.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 5000 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'shop-saved-test-'));
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
async function newUser() {
  const email = `saver${++userCount}-${Date.now()}@example.com`;
  const { data } = await call('POST', '/register', { body: { email, password: 'secret123' } });
  return data.token;
}

// [[productId, qty], ...] for compact comparisons
const pairs = (lines) => lines.map((l) => [l.id, l.qty]);

test('saved routes need a valid token', async () => {
  assert.equal((await call('GET', '/saved')).status, 401);
  assert.equal((await call('POST', '/saved/1')).status, 401);
  assert.equal((await call('POST', '/saved/1/move-to-cart')).status, 401);
  assert.equal((await call('DELETE', '/saved/1')).status, 401);
});

test('a new shopper has nothing saved', async () => {
  const token = await newUser();
  assert.deepEqual((await call('GET', '/saved', { token })).data, []);
});

test('Save for later moves an item out of the cart and keeps its quantity', async () => {
  const token = await newUser();
  await call('PUT', '/cart/7', { token, body: { qty: 2 } });
  await call('PUT', '/cart/1', { token, body: { qty: 1 } });

  const { status, data } = await call('POST', '/saved/7', { token });
  assert.equal(status, 200);
  assert.deepEqual(pairs(data.cart), [[1, 1]]);
  assert.deepEqual(pairs(data.saved), [[7, 2]]);
  assert.deepEqual(pairs((await call('GET', '/saved', { token })).data), [[7, 2]]);
});

test('saving an item that is not in the cart adds it with quantity 1', async () => {
  const token = await newUser();
  const { data } = await call('POST', '/saved/3', { token });
  assert.deepEqual(pairs(data.saved), [[3, 1]]);
  assert.deepEqual(data.cart, []);
});

test('saving the same item again adds to its quantity, up to 10', async () => {
  const token = await newUser();
  await call('PUT', '/cart/2', { token, body: { qty: 6 } });
  await call('POST', '/saved/2', { token });
  await call('PUT', '/cart/2', { token, body: { qty: 7 } });
  const { data } = await call('POST', '/saved/2', { token });
  assert.deepEqual(pairs(data.saved), [[2, 10]]);
});

test('the newest saved item is listed first', async () => {
  const token = await newUser();
  await call('POST', '/saved/4', { token });
  await call('POST', '/saved/9', { token });
  const { data } = await call('GET', '/saved', { token });
  assert.deepEqual(data.map((s) => s.id), [9, 4]);
});

test('Move to cart restores the saved quantity and empties that saved row', async () => {
  const token = await newUser();
  await call('PUT', '/cart/7', { token, body: { qty: 3 } });
  await call('POST', '/saved/7', { token });
  const { status, data } = await call('POST', '/saved/7/move-to-cart', { token });
  assert.equal(status, 200);
  assert.deepEqual(pairs(data.cart), [[7, 3]]);
  assert.deepEqual(data.saved, []);
});

test('Move to cart onto an item already in the cart never goes above 10', async () => {
  const token = await newUser();
  await call('PUT', '/cart/5', { token, body: { qty: 6 } });
  await call('POST', '/saved/5', { token });
  await call('PUT', '/cart/5', { token, body: { qty: 7 } });
  const { data } = await call('POST', '/saved/5/move-to-cart', { token });
  assert.deepEqual(pairs(data.cart), [[5, 10]]);
});

test('moving something that is not saved is a 404', async () => {
  const token = await newUser();
  const { status, data } = await call('POST', '/saved/6/move-to-cart', { token });
  assert.equal(status, 404);
  assert.equal(data.error, 'That item is not in your saved list.');
});

test('saving an unknown product is a 404', async () => {
  const token = await newUser();
  const { status, data } = await call('POST', '/saved/999', { token });
  assert.equal(status, 404);
  assert.equal(data.error, 'Product not found.');
});

test('Delete removes a saved item and leaves the cart alone', async () => {
  const token = await newUser();
  await call('PUT', '/cart/1', { token, body: { qty: 2 } });
  await call('POST', '/saved/8', { token });
  const { status, data } = await call('DELETE', '/saved/8', { token });
  assert.equal(status, 200);
  assert.deepEqual(data.saved, []);
  assert.deepEqual(pairs(data.cart), [[1, 2]]);
});

test("one shopper's saved list is private", async () => {
  const owner = await newUser();
  await call('POST', '/saved/10', { token: owner });
  const other = await newUser();
  assert.deepEqual((await call('GET', '/saved', { token: other })).data, []);
  assert.equal((await call('POST', '/saved/10/move-to-cart', { token: other })).status, 404);
  await call('DELETE', '/saved/10', { token: other });
  assert.deepEqual(pairs((await call('GET', '/saved', { token: owner })).data), [[10, 1]]);
});

test('checkout leaves saved items alone', async () => {
  const token = await newUser();
  await call('PUT', '/cart/1', { token, body: { qty: 1 } });
  await call('POST', '/saved/2', { token });
  const card = { name: 'Test Shopper', number: '4242 4242 4242 4242', expiry: '12/30', cvv: '123' };
  const { status, data: order } = await call('POST', '/checkout', { token, body: { card } });
  assert.equal(status, 201);
  assert.deepEqual(order.items.map((i) => i.productId), [1]);
  assert.deepEqual(pairs((await call('GET', '/saved', { token })).data), [[2, 1]]);
});
