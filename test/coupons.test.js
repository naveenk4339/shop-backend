import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCoupon } from '../src/coupons.js';

test('SAVE10 takes 10% off, rounded to the cent', () => {
  assert.deepEqual(applyCoupon('SAVE10', 27495), { code: 'SAVE10', label: '10% off your order', discountCents: 2750 });
  assert.equal(applyCoupon('SAVE10', 499).discountCents, 50);
});

test('codes ignore case and surrounding spaces', () => {
  assert.equal(applyCoupon('  save10 ', 1000).code, 'SAVE10');
});

test('WELCOME5 takes $5 off orders of $25 or more', () => {
  assert.equal(applyCoupon('WELCOME5', 2500).discountCents, 500);
  assert.equal(applyCoupon('WELCOME5', 12999).discountCents, 500);
});

test('WELCOME5 explains the minimum when the order is too small', () => {
  assert.deepEqual(applyCoupon('WELCOME5', 2499), { error: 'WELCOME5 needs an order of at least $25.00.' });
});

test('unknown or empty codes are rejected', () => {
  for (const code of ['SAVE100', '', undefined, 'DROP TABLE']) {
    assert.deepEqual(applyCoupon(code, 5000), { error: 'That promo code is not valid.' });
  }
});
