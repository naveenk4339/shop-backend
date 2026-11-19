// Starts the real server (spare port, throwaway database) to check the sign-in limit end to end.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 4900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'shop-limit-test-'));
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

const login = async (email, password) => {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, retryAfter: res.headers.get('retry-after'), data: await res.json() };
};

test('5 wrong passwords lock the account for 15 minutes, even with the right password', async () => {
  const email = 'locked@example.com';
  await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'right-pass' }),
  });
  for (let i = 0; i < 5; i++) assert.equal((await login(email, 'wrong-pass')).status, 401);

  const blocked = await login(email, 'right-pass');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.retryAfter, '900');
  assert.equal(blocked.data.error, 'Too many failed sign-in attempts. Try again in 15 minutes.');
});

test('other accounts can still sign in', async () => {
  assert.equal((await login('demo@shop.com', 'demo123')).status, 200);
});

test('a correct password resets the count', async () => {
  for (let i = 0; i < 4; i++) await login('demo@shop.com', 'wrong-pass');
  assert.equal((await login('demo@shop.com', 'demo123')).status, 200);
  for (let i = 0; i < 4; i++) await login('demo@shop.com', 'wrong-pass');
  assert.equal((await login('demo@shop.com', 'demo123')).status, 200);
});
