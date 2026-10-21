# shop-backend

Node.js (Express + SQLite) API for the shop. Used by [shop-frontend](https://github.com/naveenk4339/shop-frontend).

Stores users, login sessions, carts, and paid orders. Payments are **simulated**; no real money moves.

## Run

```bash
npm install
npm start          # or: npm run dev  (restarts on file changes)
```

The API listens on http://localhost:4000. Check it with `curl http://localhost:4000/api/health`.

A demo account is created on start: `demo@shop.com` / `demo123`.

## Configuration

| Variable         | Default                  | Purpose                                                      |
| ---------------- | ------------------------ | ------------------------------------------------------------ |
| `PORT`           | `4000`                   | Port to listen on                                            |
| `DB_PATH`        | `./shop.db`              | SQLite database file (created automatically)                 |
| `CORS_ORIGIN`    | `http://localhost:5173`  | Frontend address(es) allowed to call the API; comma-separated, or `*` |
| `SEED_DEMO_USER` | `true`                   | Set to `false` to skip creating the demo account            |

## API

Authenticated routes need `Authorization: Bearer <token>` (the token comes from login/register).

| Method | Path                    | Auth | Description                                    |
| ------ | ----------------------- | ---- | ---------------------------------------------- |
| GET    | `/api/health`           | no   | Health check                                   |
| POST   | `/api/register`         | no   | `{ email, password }` → `{ token, user }`      |
| POST   | `/api/login`            | no   | `{ email, password }` → `{ token, user }`      |
| POST   | `/api/logout`           | yes  | Ends the session                               |
| GET    | `/api/me`               | yes  | Current user                                   |
| GET    | `/api/products`         | no   | All products (name, category, price, listPrice, rating, reviewCount, highlights) |
| GET    | `/api/cart`             | yes  | Current user's cart                            |
| PUT    | `/api/cart/:productId`  | yes  | `{ qty }` sets quantity 0–10 (0 removes)       |
| DELETE | `/api/cart`             | yes  | Empties the cart                               |
| POST   | `/api/checkout`         | yes  | `{ card: { name, number, expiry, cvv } }` → saved order |
| GET    | `/api/orders`           | yes  | Current user's orders                          |
| GET    | `/api/orders/:orderId`  | yes  | One order with its items                       |

### Test cards

| Card number           | Result   |
| --------------------- | -------- |
| `4242 4242 4242 4242` | Approved |
| `4000 0000 0000 0002` | Declined |

## Database

SQLite tables: `users`, `sessions`, `products`, `cart_items`, `orders`, `order_items`.
Amounts are stored in cents. Only the card brand and last 4 digits are saved, never the full number or CVV.

## Structure

```
src/
  index.js     API routes
  db.js        tables and sample products
  auth.js      password hashing, sessions, demo account
  payment.js   card validation and simulated payment
```
