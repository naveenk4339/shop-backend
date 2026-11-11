import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardBrand, chargeCard, newOrderId, validateCard } from '../src/payment.js';

// A fixed "today" so expiry checks don't depend on when the tests run.
const NOW = new Date(2026, 10, 10); // 10 Nov 2026
const valid = { name: 'Demo User', number: '4242 4242 4242 4242', expiry: '12/30', cvv: '123' };

test('accepts a valid Visa card and keeps only brand and last 4', () => {
  const { errors, card } = validateCard(valid, NOW);
  assert.equal(errors, undefined);
  assert.equal(card.brand, 'Visa');
  assert.equal(card.last4, '4242');
});

test('ignores spaces and dashes in the card number', () => {
  assert.ok(validateCard({ ...valid, number: '4242-4242-4242-4242' }, NOW).card);
  assert.ok(validateCard({ ...valid, number: '4242424242424242' }, NOW).card);
});

test('rejects a number that fails the Luhn checksum', () => {
  const { errors } = validateCard({ ...valid, number: '4242 4242 4242 4241' }, NOW);
  assert.equal(errors.number, 'Enter a valid card number.');
});

test('rejects numbers that are too short, too long or not digits', () => {
  for (const number of ['4242', '4'.repeat(20), 'abcd efgh ijkl mnop', '']) {
    assert.ok(validateCard({ ...valid, number }, NOW).errors.number, number);
  }
});

test('requires the name on the card', () => {
  assert.equal(validateCard({ ...valid, name: '   ' }, NOW).errors.name, 'Enter the name on the card.');
});

test('expiry: this month is fine, last month has expired', () => {
  assert.ok(validateCard({ ...valid, expiry: '11/26' }, NOW).card);
  assert.equal(validateCard({ ...valid, expiry: '10/26' }, NOW).errors.expiry, 'This card has expired.');
  assert.equal(validateCard({ ...valid, expiry: '12/25' }, NOW).errors.expiry, 'This card has expired.');
});

test('expiry: must be MM/YY with a real month', () => {
  for (const expiry of ['13/30', '00/30', '1230', '12/2030', 'ab/cd', '']) {
    assert.equal(validateCard({ ...valid, expiry }, NOW).errors.expiry, 'Enter the expiry date as MM/YY.', expiry);
  }
  assert.ok(validateCard({ ...valid, expiry: '12 / 30' }, NOW).card);
});

test('CVV is 3 digits, or 4 for American Express', () => {
  assert.equal(validateCard({ ...valid, cvv: '12' }, NOW).errors.cvv, 'Enter the 3-digit security code.');
  assert.equal(validateCard({ ...valid, cvv: '1234' }, NOW).errors.cvv, 'Enter the 3-digit security code.');
  const amex = { ...valid, number: '3782 822463 10005' };
  assert.ok(validateCard({ ...amex, cvv: '1234' }, NOW).card);
  assert.equal(validateCard({ ...amex, cvv: '123' }, NOW).errors.cvv, 'Enter the 4-digit security code.');
});

test('reports every problem at once, even with no card at all', () => {
  assert.deepEqual(Object.keys(validateCard(undefined, NOW).errors).sort(), ['cvv', 'expiry', 'name', 'number']);
});

test('detects card brands', () => {
  assert.equal(cardBrand('4242424242424242'), 'Visa');
  assert.equal(cardBrand('5555555555554444'), 'Mastercard');
  assert.equal(cardBrand('2223003122003222'), 'Mastercard');
  assert.equal(cardBrand('378282246310005'), 'American Express');
  assert.equal(cardBrand('6011111111111117'), 'Discover');
  assert.equal(cardBrand('9999999999999995'), 'Card');
});

test('simulated gateway: the test decline card is declined', () => {
  const { card } = validateCard({ ...valid, number: '4000 0000 0000 0002' }, NOW);
  assert.deepEqual(chargeCard(card, 500), { approved: false, reason: 'Your card was declined. Try a different card.' });
});

test('simulated gateway: approves other cards, refuses a zero amount', () => {
  const { card } = validateCard(valid, NOW);
  assert.deepEqual(chargeCard(card, 500), { approved: true });
  assert.equal(chargeCard(card, 0).approved, false);
});

test('order ids look like ORD-YYYYMMDD-XXXXXX and are unique', () => {
  const ids = new Set(Array.from({ length: 50 }, newOrderId));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^ORD-\d{8}-[0-9A-F]{6}$/);
});
