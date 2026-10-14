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

// A ready-made account so the app can be tried without registering.
// Set SEED_DEMO_USER=false to skip it.
export const DEMO_USER = { email: 'demo@shop.com', password: 'demo123' };

export function seedDemoUser() {
  if (process.env.SEED_DEMO_USER === 'false') return;
  db.prepare('INSERT OR IGNORE INTO users (email, password_hash) VALUES (?, ?)').run(
    DEMO_USER.email,
    hashPassword(DEMO_USER.password)
  );
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

// Express middleware: reads "Authorization: Bearer <token>" and sets req.user.
export function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const user = token
    ? db
        .prepare(
          `SELECT u.id, u.email FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token = ?`
        )
        .get(token)
    : null;
  if (!user) return res.status(401).json({ error: 'Please log in again.' });
  req.user = user;
  req.token = token;
  next();
}
