import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginLimiter } from '../src/loginLimiter.js';

// A fake clock so the 15-minute windows can be tested instantly.
function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const limiter = createLoginLimiter({ now: clock.now });
  return { limiter, clock };
}
const MIN = 60_000;

test('locks an email after 5 failures and tells how long to wait', () => {
  const { limiter } = setup();
  for (let i = 0; i < 4; i++) limiter.recordFailure('a@x.com');
  assert.equal(limiter.retryAfter('a@x.com'), 0);
  limiter.recordFailure('a@x.com');
  assert.equal(limiter.retryAfter('a@x.com'), 15 * 60);
});

test('the lock ends after 15 minutes', () => {
  const { limiter, clock } = setup();
  for (let i = 0; i < 5; i++) limiter.recordFailure('a@x.com');
  clock.advance(14 * MIN);
  assert.equal(limiter.retryAfter('a@x.com'), 60);
  clock.advance(MIN);
  assert.equal(limiter.retryAfter('a@x.com'), 0);
});

test('failures spread over more than 15 minutes do not lock', () => {
  const { limiter, clock } = setup();
  for (let i = 0; i < 4; i++) limiter.recordFailure('a@x.com');
  clock.advance(16 * MIN);
  limiter.recordFailure('a@x.com');
  assert.equal(limiter.retryAfter('a@x.com'), 0);
});

test('a successful sign-in clears the count', () => {
  const { limiter } = setup();
  for (let i = 0; i < 4; i++) limiter.recordFailure('a@x.com');
  limiter.recordSuccess('a@x.com');
  limiter.recordFailure('a@x.com');
  assert.equal(limiter.retryAfter('a@x.com'), 0);
});

test('each email is counted separately', () => {
  const { limiter } = setup();
  for (let i = 0; i < 5; i++) limiter.recordFailure('a@x.com');
  assert.ok(limiter.retryAfter('a@x.com') > 0);
  assert.equal(limiter.retryAfter('b@x.com'), 0);
});
