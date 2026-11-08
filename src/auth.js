import crypto from 'node:crypto';
import db from './db.js';

// Passwords are stored as "salt:hash" using scrypt.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(expected, actual);
}

const DEMO_USER = { email: 'demo@shop.com', password: 'demo123' };
const demoUserEnabled = process.env.SEED_DEMO_USER === 'true' ||
  (process.env.SEED_DEMO_USER !== 'false' && process.env.NODE_ENV !== 'production');

export function isDisabledDemoUser(email) {
  return !demoUserEnabled && email === DEMO_USER.email;
}

export function seedDemoUser() {
  if (!demoUserEnabled) {
    db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)')
      .run(DEMO_USER.email);
    return;
  }
  db.prepare('INSERT OR IGNORE INTO users (email, password_hash) VALUES (?, ?)').run(
    DEMO_USER.email,
    hashPassword(DEMO_USER.password)
  );
}

const SESSION_IS_ACTIVE = "sessions.created_at > datetime('now', '-1 day')";

function hashSessionToken(token) {
  return `sha256:${crypto.createHash('sha256').update(token).digest('hex')}`;
}

// Keep unexpired sessions from existing databases while removing the raw tokens.
export function migrateSessions() {
  db.transaction(() => {
    db.prepare(`DELETE FROM sessions WHERE NOT (${SESSION_IS_ACTIVE})`).run();
    const legacySessions = db.prepare('SELECT token FROM sessions WHERE length(token) = 64').all();
    const updateToken = db.prepare('UPDATE sessions SET token = ? WHERE token = ?');
    for (const { token } of legacySessions) updateToken.run(hashSessionToken(token), token);
  }).immediate();
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(hashSessionToken(token), userId);
  return token;
}

// Express middleware: reads "Authorization: Bearer <token>" and sets req.user.
export function requireAuth(req, res, next) {
  const token = /^Bearer +([a-f0-9]{64})$/i.exec(req.headers.authorization || '')?.[1];
  const sessionKey = token && hashSessionToken(token);
  const user = sessionKey
    ? db
        .prepare(
          `SELECT u.id, u.email FROM sessions
           JOIN users u ON u.id = sessions.user_id
           WHERE sessions.token = ? AND ${SESSION_IS_ACTIVE}`
        )
        .get(sessionKey)
    : null;
  if (!user || isDisabledDemoUser(user.email)) {
    return res.status(401).json({ error: 'Please log in again.' });
  }
  req.user = user;
  req.sessionKey = sessionKey;
  next();
}
