# Product & Order Management

A small shop: customers browse products, place orders and review what they bought; admins manage products, fulfil orders and read a sales report.

| Folder | What it is |
|---|---|
| [backend/](backend/) | Node.js 22, Express 5, MongoDB (Mongoose). API reference: [backend/API.md](backend/API.md). More detail: [backend/README.md](backend/README.md) |
| [frontend/](frontend/) | React 19 + Vite + Tailwind. Notes: [frontend/README.md](frontend/README.md) |
| [docker-compose.yml](docker-compose.yml) | MongoDB (replica set), API, email worker, web |

## Prerequisites

- **With Docker:** Docker with Compose v2 (`docker compose`).
- **Without Docker:** Node.js 22 or newer, and MongoDB 6+ running **as a replica set** (orders use multi-document transactions, which MongoDB only allows on a replica set; a plain standalone `mongod` makes placing and cancelling orders fail).
- Internet access for the email worker if you want to see test emails on [Ethereal](https://ethereal.email).

## Setup with Docker

```bash
docker compose up --build
```

This starts four services:

| Service | URL / port | Notes |
|---|---|---|
| `mongo` | internal only | single-node replica set `rs0`, initiated automatically; healthy once it is PRIMARY |
| `api` | http://localhost:5000 | waits for `mongo` to be healthy |
| `worker` | none | same image as `api`, runs `npm run worker`; waits for `mongo` to be healthy |
| `web` | http://localhost:5173 | the built React app served by nginx |

Settings come from [backend/.env.example](backend/.env.example) (compose never reads a real `.env`); only `MONGO_URI` is overridden to point at the `mongo` container.
Data lives in two named volumes: `mongo_data` (database) and `uploads` (product images). `docker compose down` keeps them; `docker compose down -v` deletes them.

Then create the admin and demo data (safe to repeat):

```bash
docker compose exec api npm run seed
```

The frontend is built with `VITE_API_URL=http://localhost:5000` because the browser, not the container, calls the API. If you publish the API on another address, change the `VITE_API_URL` build arg in `docker-compose.yml` and the `CLIENT_URL` setting (CORS) to match, then rebuild.

## Setup without Docker

1. Start MongoDB as a replica set, for example:
   ```bash
   mongod --replSet rs0 --dbpath ./data
   mongosh --eval "rs.initiate()"     # once
   ```
2. Backend:
   ```bash
   cd backend
   cp .env.example .env               # then edit: JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
   npm install
   npm run seed                       # admin + 12 demo products
   npm run dev                        # API on http://localhost:5000
   npm run worker                     # in a second terminal: sends queued emails
   ```
   `MONGO_URI` in `.env.example` is `mongodb://localhost:27017/product-order-test?replicaSet=rs0`, which matches step 1.
3. Frontend:
   ```bash
   cd frontend
   cp .env.example .env               # VITE_API_URL=http://localhost:5000
   npm install
   npm run dev                        # http://localhost:5173
   ```

Tests: `cd backend && npm test` (uses an in-memory MongoDB replica set, no setup needed), `cd frontend && npm test`.

## Seeded login

`npm run seed` creates the admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. With the `.env.example` defaults:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `change-me-123` |

It also creates 12 products with 2 generated PNG images each in 3 categories (Electronics, Books, Home). Running it again changes nothing: an existing admin is left alone (it is never given a new password), and products are skipped when a live product with the same name exists. If `ADMIN_EMAIL` already belongs to a customer, the seed stops with an error instead of promoting them.

Customers register themselves in the UI (`/register`). **Change the defaults before exposing this anywhere:** the API refuses to start with `NODE_ENV=production` and a weak `JWT_SECRET`.

## Where to see test emails (Ethereal)

Emails (order placed, status changes, low stock, password reset, email verification) are sent by the **worker**, not the API.

- By default `SMTP_HOST=smtp.ethereal.email` with no credentials. In that case the worker creates a throwaway Ethereal account when it starts, and logs a `previewUrl` for every email it sends. Open that link to read the message.
  - Docker: `docker compose logs -f worker`
  - Local: the worker's console, and `backend/logs/email.log`
- To use a fixed inbox instead, create an account at https://ethereal.email/create, put its username and password in `SMTP_USER` / `SMTP_PASS`, and read the mail at https://ethereal.email/messages. (In Docker, `.env.example` is the settings file, so add them there or as `environment:` entries for `worker`.)
- Low-stock emails go to `ADMIN_EMAIL`. Failed or pending sends are visible to an admin at `GET /api/admin/email-jobs`.

## Design decisions

Each of these was written after reading the code it describes.

### Average rating

A product stores `ratingSum`, `reviewCount` and `averageRating` ([review.service.js](backend/src/services/review.service.js)). Posting a review does one `updateOne` with an aggregation pipeline that adds the rating to the sum, adds 1 to the count and recomputes the average from those two values in the same operation. A single-document update is atomic in MongoDB, so simultaneous reviews cannot leave the three fields disagreeing, and nothing is read and written back in Node. Storing the average (instead of averaging reviews on every list) lets `minRating` filtering and `rating_desc` sorting use an index.

The average is rounded **half-up to one decimal using integer arithmetic**, `floor((sum*20 + count) / (count*2)) / 10`, because MongoDB's `$round` rounds half to even. A product with no reviews has `averageRating: 0`. A unique `{ product, user }` index allows one review per customer per product, and only a customer with a **Delivered** order containing the product may review it. The review row and the product totals are two separate writes (not one transaction); if the product update fails, the review row is deleted again.

### Overselling prevention

Placing an order runs in one MongoDB transaction ([order.service.js](backend/src/services/order.service.js)). For each item the stock check and the decrement are a single conditional update, `findOneAndUpdate({ _id, stock: { $gte: quantity } }, { $inc: { stock: -quantity } })`. Stock therefore cannot go below zero even with many orders racing for the last units; the loser's update matches nothing. If any item fails, the transaction aborts and the decrements of the other items are rolled back, and the `409 INSUFFICIENT_STOCK` response lists **every** failing item with `requested` and `available`. Items are processed in product-id order so concurrent orders take their locks in the same order. Cancelling a Pending order restores the stock in its own transaction. Prices are always read from the database, never from the request, and frozen on the order.

### Idempotency

`POST /api/orders` requires an `Idempotency-Key` header (a UUID) ([idempotency.service.js](backend/src/services/idempotency.service.js)). The key is claimed by inserting a row with a unique `{ user, key }` index, so two simultaneous requests with the same key cannot both do the work: the second waits (up to 15 s) for the first and then replays its stored response. The row stores a SHA-256 hash of the normalised body (duplicate items merged, items sorted by product id), so the same key with a different body is `422 IDEMPOTENCY_KEY_REUSED`. The response is saved **in the same transaction as the order**, so either both exist or neither does. A replay returns the original status and body with `Idempotency-Replayed: true` and touches no stock. A failed request deletes its key so the client can fix the problem and retry. Keys expire after `IDEMPOTENCY_TTL_HOURS` (24); a record stuck "processing" for over 60 s (a crashed request) is discarded.

### Outbox, without duplicate sends

The API never talks to SMTP. Inside the same transaction as the order, status change or stock change it inserts an `EmailJob` row ([email.service.js](backend/src/services/email.service.js)), so the email exists if and only if the change committed. The worker polls every `EMAIL_WORKER_INTERVAL_MS` and **claims** each job with one atomic `findOneAndUpdate` (`pending` to `sending`, attempts + 1). Two workers can therefore never take the same job, and you can run several side by side. A failed send goes back to `pending` with exponential backoff (30 s, 1 min, 2 min, ...), and becomes `failed` after `EMAIL_MAX_ATTEMPTS`. A job left in `sending` by a crashed worker is returned to `pending` after 5 minutes.
This guarantees *at-least-once* delivery with no duplicates from concurrent workers. The one case that can still send twice is a worker that crashes after SMTP accepted a message but before it was marked `sent`. Low-stock emails are deduplicated with a per-product `lowStockAlerted` flag that is flipped with a conditional update, so many orders crossing the threshold at once queue exactly one email; it is re-armed when stock rises above the threshold again.

### Money as integer paise

Prices, line totals and order totals are stored as integer paise (`pricePaise`, `unitPricePaise`, `lineTotalPaise`, `totalPaise`) so no floating-point rounding ever touches money. Conversion happens only at the edges, in [money.js](backend/src/utils/money.js): `rupeesToPaise` accepts a plain amount with at most 2 decimals by regex and string arithmetic (`"499.99"` becomes `49999`; `"1.999"` is rejected), and `paiseToRupees` formats back using integer division and remainder. The API shows rupees (`499.99`) in JSON.

### Duplicate order items

If the same `productId` appears more than once in an order, the quantities are **merged by summing** before anything else happens ([order.validator.js](backend/src/validators/order.validator.js)). A merged quantity above 100 is a `400`. The merged list is sorted by product id, which is also what makes the request hash (and therefore idempotency) independent of the order the client listed items in. The stored order has one line per product.

### Other choices worth knowing

- **Reports use IST.** Sales days are Asia/Kolkata calendar days, in one `$facet` aggregation; cancelled orders are excluded from revenue.
- **Sessions are checked on every request.** The JWT carries a session id; logout, password reset and disabling a user take effect immediately. Refresh tokens rotate, and reuse of an old one revokes the session.
- **Order status** follows `Pending -> Shipped -> Delivered`, or `Pending -> Cancelled`; changes are compare-and-set so two racing requests cannot both win.
- **Images** are validated by their bytes (JPEG, PNG, WEBP only), max 5 per product and 2 MB each.

## Not completed

- **The frontend does not cover every backend feature.** It has no screens for password reset, email verification, changing password, admin user management or the email-job list; those exist only as API endpoints (see [backend/API.md](backend/API.md)). The frontend's logout only clears the token in the browser, and it never uses the refresh token, so a user is sent to the login page when the 1 hour access token expires.
- **Rate limiting is per process.** The auth rate limiter keeps its counters in the API's memory, so running several API instances gives each its own counter, and a restart resets them.
- **No automated test of the Docker setup.** `docker compose` is not exercised by any test or CI job in this repository.
