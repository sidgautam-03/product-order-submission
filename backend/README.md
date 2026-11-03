# Product & Order API

Node.js, Express 5, MongoDB (Mongoose). Run with `npm run dev`; create the first admin with `npm run seed`
(reads `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`).

## Conventions

- Success: `{ success: true, data, meta? }`. Error: `{ success: false, error: { code, message, details? } }`.
- Lists return `meta: { page, limit, total, totalPages }`. Defaults `page=1`, `limit=10`; a `limit` above 50 is
  clamped to 50, malformed values return 400.
- Money is stored as integer paise and returned as rupees with 2 decimals. Conversion is string/integer
  arithmetic only (`src/utils/money.js`), never float math.
- Every response has an `X-Request-Id` (an incoming one is reused if it is a short safe token) and the same
  id is on every log line for that request.

## Ratings: `averageRating` and `reviewCount`

Each product stores `ratingSum`, `reviewCount` and `averageRating`. Posting a review does one atomic
single-document update (an aggregation-pipeline `updateOne`) that adds the rating to the sum, adds 1 to the count,
and recomputes the average from those two values in the same operation.

Why: MongoDB applies a single-document update atomically, so many reviews arriving at once serialize and the
three fields can never disagree, with no read-modify-write race. Storing the average (instead of aggregating
reviews on every list) keeps `minRating` filtering and `rating_desc` sorting index-backed and cheap.
The average is rounded half-up to one decimal using integers (`floor((sum*20+count)/(count*2))/10`), because the
aggregation `$round` operator rounds half to even. A product with no reviews has `averageRating: 0`.
The unique `{ product, user }` index on reviews enforces one review per customer per product.

## Orders

All order routes need a JWT. Customers see and cancel only their own orders; admins see all and run fulfilment.

**`POST /api/orders`** (customer) needs an `Idempotency-Key` header (a UUID) and a JSON body with `customerName`,
`customerEmail` and `items` (1 to 20 of `{ productId, quantity 1-100 }`). The client never sends prices: line totals
and the total are computed server-side in integer paise from the current product prices and then frozen on the order
(name, unit price, line total, total), so later product edits or archiving never change an existing order.

- **Duplicate product ids are merged** by summing their quantities; a merged quantity above 100 is a 400.
- Order creation and the stock decrement run in **one MongoDB transaction** (a replica set is required). Each item
  uses a conditional update (`stock >= quantity`), so stock never goes negative and 20 parallel orders for the last
  5 units give exactly 5 `201`s and 15 `409`s. A missing or archived product is a `404` listing the product ids;
  insufficient stock is a `409` (`INSUFFICIENT_STOCK`) listing **every** failing item with `requested` and
  `available`, and nothing is saved or decremented.
- **Idempotency:** the same key from the same user within 24 hours (`IDEMPOTENCY_TTL_HOURS`) returns the original
  status code and body (header `Idempotency-Replayed: true`) without touching stock again. The same key with a
  different body is `422` (the key is in `error.details[0].key`). The unique `{ user, key }` index makes two
  simultaneous requests create one order; the second waits for the first and replays its response. A request that
  fails (404, 409, 400) releases its key, so it can be retried once the problem is fixed. The request body is compared
  after merging and sorting items, so listing items in a different order is still the same request.

**`PATCH /api/orders/:id`** (admin or owner) with `{ "status": "..." }`:

| From | To | Who |
|---|---|---|
| Pending | Shipped | Admin |
| Shipped | Delivered | Admin |
| Pending | Cancelled | Admin, or the owning customer |

Anything else, including repeating the current status, is `409` with `currentStatus` and `allowedNextStatuses`;
Delivered and Cancelled are final. A valid transition the caller's role may not make is `403`, listing the
transitions their role allows. The change is a compare-and-set on the status that was validated, inside a
transaction, so when two requests race from the same status only one wins and the other gets `409`. Every change
appends `{ status, changedBy, at }` to `statusHistory`. Cancelling restores stock in the same transaction.
A missing order and another customer's order return the identical `404`.

**`GET /api/orders/:id`** and **`GET /api/orders`** (`status`, `page`, `limit`, newest first; admins also get
`customerEmail`, `from`, `to`). An unknown status is `400`. `from`/`to` accept `YYYY-MM-DD` (an **IST calendar day**,
`to` inclusive of the whole day) or a full ISO datetime.

### Low-stock emails

When a product's stock falls to or below its `lowStockThreshold`, an `EmailJob` is queued for `ADMIN_EMAIL` inside the
same transaction as the stock change. A per-product `lowStockAlerted` flag is flipped with a conditional update, so
concurrent orders crossing the threshold queue exactly one email; the flag clears once stock is above the threshold
again (cancellation, or an admin raising stock), after which the next drop queues a new one.
`npm run worker` sends queued jobs through SMTP (`SMTP_*`, `EMAIL_FROM`), claiming jobs atomically, retrying with
exponential backoff up to `EMAIL_MAX_ATTEMPTS`, and recovering jobs stuck by a crashed worker.

## Sales report

**`GET /api/reports/sales?from=2026-10-01&to=2026-10-31`** (admin). `from` and `to` are required `YYYY-MM-DD` dates,
`from` must not be after `to`, and the range is at most 366 days. **All days are Asia/Kolkata (IST, UTC+05:30)
days**: an order belongs to the IST calendar day of its `createdAt`, and both range ends are IST day boundaries.
It is one aggregation with `$facet` (nothing is looped over in Node except zero-filling the already-grouped days).
Cancelled orders are excluded from revenue, the order count, daily revenue and top products.

```json
{
  "range": { "from": "2026-10-01", "to": "2026-10-31", "timezone": "Asia/Kolkata" },
  "totalRevenue": 400.0,
  "orderCount": 3,
  "ordersByStatus": { "Pending": 1, "Shipped": 1, "Delivered": 1, "Cancelled": 1 },
  "revenuePerDay": [{ "date": "2026-10-01", "revenue": 200.0, "orders": 1 }],
  "topProducts": [{ "productId": "...", "name": "...", "quantitySold": 4, "revenue": 200.0 }]
}
```

`revenuePerDay` has one entry for every day in the range (0 when there were no sales); `ordersByStatus` includes all
four statuses; `topProducts` is the 5 best sellers by quantity (ties broken by product id).

## Authentication and security

- `POST /api/auth/register` always creates a **customer** (a `role` in the body is ignored). Password: 8 to 72
  characters with at least one letter and one number. Email is unique ignoring case.
- `POST /api/auth/login` returns a JWT; a wrong password and an unknown email give the same `401`.
  `GET /api/auth/me` returns the current user. Send `Authorization: Bearer <token>`.
  Missing, invalid or expired tokens, and tokens of a deleted user, are `401`; a valid token without the required
  role is `403`. Passwords are bcrypt hashes and never appear in any response.
- `npm run seed` creates the admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Running it twice is safe: an existing admin
  is left alone, and an existing customer with that email is never promoted or modified (the seed fails instead).
- `/api/auth/login` and `/api/auth/register` allow **5 requests per 15 minutes per IP each**; extra requests get `429`
  with a `Retry-After` header. (`AUTH_RATE_LIMIT_MAX` can raise the limit; it exists for the automated tests.)
- helmet security headers, and CORS limited to `CLIENT_URL`. Any JSON body or query string with a field name starting
  with `$` or containing `.` (for example `{ "email": { "$gt": "" } }` or `?category[$ne]=x`) is rejected with `400`.

### Sessions, refresh tokens and logout

Every login or registration creates a **session**. The access token (JWT, `JWT_EXPIRES_IN`) carries the session id, and
`authenticate` checks on every request that the session is not revoked and the user still exists and is active, so logout,
password reset, and disabling a user take effect **immediately** rather than when the token expires.

- Login and register return `{ user, token, refreshToken }`. The refresh token is an opaque random value, stored only as a
  SHA-256 hash, valid for `REFRESH_TOKEN_DAYS` (default 7).
- `POST /api/auth/refresh` exchanges it for a new access token **and a new refresh token** (rotation). Presenting a refresh
  token that was already rotated out means it leaked, so the whole session is revoked. Two simultaneous refreshes with the
  same token: one wins, the other gets `401`. A client that retries a refresh after a lost response will therefore have
  to log in again; that is the deliberate cost of theft detection.
- `POST /api/auth/logout` revokes the current session; `POST /api/auth/logout-all` revokes every session of the user.

### Password change and reset

- `POST /api/auth/change-password` (logged in) checks the current password; the new one must differ and meet the policy.
  Every **other** session is signed out; the current one stays.
- `POST /api/auth/forgot-password` always answers `200` with the same message, whether or not the email is registered. For a real
  account it queues a `PASSWORD_RESET` email (through the outbox) holding a single-use token valid for
  `PASSWORD_RESET_MINUTES` (default 30); asking again invalidates the previous link. Only a hash of the token is stored.
- `POST /api/auth/reset-password` with `{ token, newPassword }` sets the password, consumes the token atomically (two
  simultaneous uses: exactly one succeeds), signs out **every** session and clears any lockout.

### Email verification

Registration queues an `EMAIL_VERIFICATION` email (token valid `EMAIL_VERIFY_HOURS`, default 24).
`POST /api/auth/verify-email` with `{ token }` marks the account verified (`emailVerified` is on the user object);
`POST /api/auth/resend-verification` (logged in) issues a new token and invalidates the old one. Verification is informational
by default; set `REQUIRE_EMAIL_VERIFICATION=true` to make `POST /api/orders` return `403 EMAIL_NOT_VERIFIED` until the
customer has verified. Accounts created by an admin, and the seeded admin, count as verified.

### Account lockout

`LOGIN_MAX_ATTEMPTS` (default 5) consecutive wrong passwords lock the account for `LOGIN_LOCK_MINUTES` (default 15); a
successful login or a password reset clears the counter. While locked (or disabled) even the correct password gets the same
generic `401 Invalid email or password`, so lockout cannot be used to find out which emails are registered. Existing sessions
are not affected. This is in addition to the per-IP rate limit.

### Admin user management (admin only)

`GET /api/admin/users` (filters `role`, `isActive`, `q`, plus pagination), `POST /api/admin/users` (create a customer or an
admin), `PATCH /api/admin/users/:id` (`role` and/or `isActive`). Role changes apply immediately; deactivating a user revokes
all their sessions and blocks login. An admin cannot demote or deactivate themselves, so at least one active admin always remains.

### Secrets

The app refuses to start with `NODE_ENV=production` unless `JWT_SECRET` is at least 32 characters and not a placeholder such as
`change-me` (generate one with `openssl rand -hex 32`); in development it only prints a warning.

## Email notifications

The customer gets an email when an order is placed (order id, items, quantities, total) and on **every** status change,
including cancellation; the admin gets one for low stock. Emails use an **outbox**: the API inserts an `emailjobs` row
inside the same transaction as the order or stock change (so it exists if and only if the change committed), and the
response never waits for SMTP. A separate process sends them:

```
npm run worker
```

The worker claims a job with an atomic `pending -> sending` update, so with two workers running a job is never sent
twice. A failed send is retried with exponential backoff (30 s, 1 min, 2 min, ...) up to `EMAIL_MAX_ATTEMPTS`, then the
job is marked `failed`; a job left in `sending` by a crashed worker is picked up again after 5 minutes.
`GET /api/admin/email-jobs?status=failed` (admin; also `event`, `page`, `limit`) lists jobs with `attempts` and `lastError`.

**Where to see the sent emails:** use a free [Ethereal](https://ethereal.email/create) account. Put its SMTP username
and password in `SMTP_USER` / `SMTP_PASS` (`SMTP_HOST=smtp.ethereal.email`, `SMTP_PORT=587`), start the worker, then
open <https://ethereal.email/messages> and log in with the same credentials: every message the worker sends appears
there. Each successful send also logs a `previewUrl` in `logs/email.log` that opens that exact message.
Mailtrap works the same way (use its SMTP host, port and credentials).

## Logging

Structured JSON, one object per line, always with `timestamp` (ISO 8601), `level` and `message`; request lines also have
`requestId`. Configure with `LOG_LEVEL` and `LOG_DIR` (see `.env.example`).

| File / output | Contents |
|---|---|
| console | application log (`logs/app.log` as well when `LOG_DIR` is set) |
| `logs/email.log` | successful email sends |
| `logs/email-error.log` | failed email attempts |

- Every HTTP request is logged with `method`, `path` (no query string), `statusCode`, `durationMs` and `userId` when
  logged in. Request bodies, headers and query strings are never logged, so passwords, tokens and auth bodies cannot
  leak; sensitive keys are also masked by redaction as a second safety net.
- Every email attempt logs `event` (`ORDER_PLACED`, `STATUS_CHANGED` or `LOW_STOCK`), `jobId`, `orderId` or
  `productId`, `recipient`, `attempt`, `result` (`sent` / `failed`), and `messageId` or `error`. The `requestId` of the
  API request that queued the email is stored on the job, so a worker log line can be traced back to that request.
- Email lines are also printed to the console when `NODE_ENV=development`.

## Images

Multer keeps uploads in memory (max 5 files, 2 MB each). The real type is read from the file's magic bytes
(JPEG, PNG, WEBP only; SVG and renamed text files are rejected), and only then are files written to `uploads/`
under generated names. If saving the product fails, files already written are deleted; images removed by PATCH
are deleted from disk after the update succeeds. Files are served at `/uploads/<name>`.
