// Slows down password guessing: after too many wrong passwords for one email
// within a time window, that email is locked out for a while.
// Kept in memory, so it resets when the server restarts (fine for one instance).
export function createLoginLimiter({ maxFailures = 5, windowMs = 15 * 60_000, lockMs = 15 * 60_000, now = Date.now } = {}) {
  const attempts = new Map(); // email -> { failures, firstAt, lockedUntil }

  // Seconds until this email may try again, or 0 if it's not locked.
  function retryAfter(email) {
    const entry = attempts.get(email);
    if (!entry || entry.lockedUntil <= now()) return 0;
    return Math.ceil((entry.lockedUntil - now()) / 1000);
  }

  function recordFailure(email) {
    const t = now();
    let entry = attempts.get(email);
    if (!entry || t - entry.firstAt > windowMs) {
      entry = { failures: 0, firstAt: t, lockedUntil: 0 };
      attempts.set(email, entry);
    }
    entry.failures += 1;
    if (entry.failures >= maxFailures) {
      entry.lockedUntil = t + lockMs;
      entry.failures = 0;
      entry.firstAt = t;
    }
    if (attempts.size > 10_000) prune(t);
  }

  function recordSuccess(email) {
    attempts.delete(email);
  }

  // Drop entries that are neither locked nor inside the counting window.
  function prune(t) {
    for (const [email, entry] of attempts) {
      if (entry.lockedUntil <= t && t - entry.firstAt > windowMs) attempts.delete(email);
    }
  }

  return { retryAfter, recordFailure, recordSuccess };
}
