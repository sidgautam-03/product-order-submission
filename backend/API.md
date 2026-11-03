# API reference

Every endpoint of the Express API, taken from `src/routes/*`, the validators and the services. Base URL: `http://localhost:5000`.

## Conventions

- **Success:** `{ "success": true, "data": ..., "meta": ... }` (`meta` only on lists).
- **Error:** `{ "success": false, "error": { "code": "...", "message": "...", "details": [...] } }` (`details` is optional).
- **Auth:** send `Authorization: Bearer <token>` (the `token` from login/register). Roles are `customer` and `admin`.
  A missing, invalid or expired token, a revoked session and a disabled user are all `401`; a valid token with the wrong role is `403`.
- **Lists** return `meta: { page, limit, total, totalPages }`. `page` defaults to 1, `limit` to 10; a `limit` above 50 is clamped to 50;
  a malformed value (`0`, `-1`, `abc`) is a `400`.
- **Money** is stored as integer paise and shown as rupees (`499` = Rs 499.00). Clients send rupees (`"499.99"` or `499.99`, at most 2 decimals).
- **Dates and reports:** calendar days are grouped in **IST (Asia/Kolkata, UTC+05:30)**, not UTC. See [Sales report](#get-apireportssales).
- **Ids** are 24-character hex ObjectIds; a malformed id in a path is `400 VALIDATION_ERROR`.
- Every response carries an `X-Request-Id` header. Field names starting with `$` or containing `.` in a JSON body or query string are rejected with `400`.
- Uploaded images are served unauthenticated at `GET /uploads/<filename>` (the `url` of a product image is `/uploads/<filename>`).

### Error codes

| Status | `error.code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body, query, header or id failed validation; `details` lists `{ path, message }` |
| 401 | `UNAUTHORIZED` | No/invalid/expired token, wrong login, or a revoked session |
| 403 | `FORBIDDEN` | Role not allowed, or the purchase rule for reviews |
| 403 | `EMAIL_NOT_VERIFIED` | Only when `REQUIRE_EMAIL_VERIFICATION=true`, on `POST /api/orders` |
| 404 | `NOT_FOUND` | Unknown route, product, order or user (another customer's order looks the same as a missing one) |
| 409 | `CONFLICT` | Duplicate (email, product name, review) or a concurrent modification |
| 409 | `INSUFFICIENT_STOCK` | Not enough stock; `details` lists every failing item |
| 409 | `INVALID_TRANSITION` | Order status change not allowed from the current status |
| 422 | `IDEMPOTENCY_KEY_REUSED` | Same `Idempotency-Key` with a different request body |
| 429 | `RATE_LIMITED` | Too many auth requests from one IP (`Retry-After` header is set) |
| 500 | `INTERNAL_ERROR` | Unexpected error |

Every endpoint below can also return the generic `400 VALIDATION_ERROR`; only the specific codes are listed per endpoint.
Every endpoint that requires a login can return `401`, and every role-restricted one `403`; they are listed once in the table.

## Endpoints at a glance

| Method | Path | Role |
|---|---|---|
| GET | `/health` | public |
| POST | `/api/auth/register` | public (rate limited) |
| POST | `/api/auth/login` | public (rate limited) |
| POST | `/api/auth/refresh` | public (rate limited) |
| GET | `/api/auth/me` | any logged-in user |
| POST | `/api/auth/logout` | any logged-in user |
| POST | `/api/auth/logout-all` | any logged-in user |
| POST | `/api/auth/change-password` | any logged-in user (rate limited) |
| POST | `/api/auth/forgot-password` | public (rate limited) |
| POST | `/api/auth/reset-password` | public (rate limited) |
| POST | `/api/auth/verify-email` | public (rate limited) |
| POST | `/api/auth/resend-verification` | any logged-in user (rate limited) |
| GET | `/api/products` | public (admins see more) |
| GET | `/api/products/:id` | public (admins can see archived) |
| POST | `/api/products` | admin |
| PATCH | `/api/products/:id` | admin |
| DELETE | `/api/products/:id` | admin |
| GET | `/api/products/:id/reviews` | public |
| POST | `/api/products/:id/reviews` | customer |
| POST | `/api/orders` | customer |
| GET | `/api/orders` | customer (own) or admin (all) |
| GET | `/api/orders/:id` | customer (own) or admin |
| PATCH | `/api/orders/:id` | customer (cancel own) or admin |
| GET | `/api/reports/sales` | admin |
| GET | `/api/admin/email-jobs` | admin |
| GET | `/api/admin/users` | admin |
| POST | `/api/admin/users` | admin |
| PATCH | `/api/admin/users/:id` | admin |

---

## Health

### GET /health

Role: public. Response `200`: `{ "success": true, "data": { "status": "ok" } }`.

---

## Auth

The register, login, refresh, change-password, forgot-password, reset-password, verify-email and resend-verification routes are limited to
`AUTH_RATE_LIMIT_MAX` requests (default 5; 30 for refresh) per 15 minutes per IP, each route counted on its own. Extra requests get
`429 RATE_LIMITED`.

Password rule: 8 to 72 characters with at least one letter and one number.

### POST /api/auth/register

Role: public. Always creates a `customer` (a `role` field is ignored). Queues a verification email.

Body: `{ "name": "Asha Rao", "email": "asha@example.com", "password": "secret123" }` (`name` 2 to 100 characters; `email` is lowercased).

Response `201`:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "6ae9e352207a135a279602b7", "name": "Asha Rao", "email": "asha@example.com", "role": "customer",
      "isActive": true, "emailVerified": false,
      "createdAt": "2026-11-03T13:36:18.556Z", "updatedAt": "2026-11-03T13:36:18.556Z"
    },
    "token": "<jwt>",
    "refreshToken": "<opaque string>"
  }
}
```

Errors: `400` validation, `409` email already registered, `429`.

### POST /api/auth/login

Role: public. Body: `{ "email": "asha@example.com", "password": "secret123" }`. Response `200`: same shape as register.

Errors: `400` validation; `401` `Invalid email or password` (wrong password, unknown email, disabled account, or a locked account all give the
identical message); `429`. After `LOGIN_MAX_ATTEMPTS` (default 5) consecutive wrong passwords the account is locked for `LOGIN_LOCK_MINUTES` (default 15).

### POST /api/auth/refresh

Role: public. Body: `{ "refreshToken": "<opaque string>" }`. Exchanges the refresh token for a new access token **and a new refresh token**
(the old refresh token stops working). Response `200`: `{ user, token, refreshToken }`.

Errors: `401 Invalid or expired refresh token` (unknown, expired, revoked, or an already-rotated token, which also revokes the session); `429`.

### GET /api/auth/me

Role: any logged-in user. Response `200`: `{ "success": true, "data": { "user": { ...user fields as above } } }`. Errors: `401`.

### POST /api/auth/logout

Role: any logged-in user. No body. Revokes the current session. Response `200`: `{ "success": true, "data": { "message": "Logged out" } }`. Errors: `401`.

### POST /api/auth/logout-all

Role: any logged-in user. No body. Revokes every session of the user. Response `200`: `data.message` = `Logged out of all devices`. Errors: `401`.

### POST /api/auth/change-password

Role: any logged-in user. Body: `{ "currentPassword": "secret123", "newPassword": "newer-pass-456" }`. Signs out every other session.
Response `200`: `data.message` = `Password changed; other devices were signed out`.

Errors: `400` (wrong current password, new password equal to the current one, or policy violation), `401`, `429`.

### POST /api/auth/forgot-password

Role: public. Body: `{ "email": "asha@example.com" }`. Always answers `200` with
`data.message` = `If that email is registered, a password reset link has been sent`, whether or not the email exists. Errors: `400`, `429`.

### POST /api/auth/reset-password

Role: public. Body: `{ "token": "<token from the email>", "newPassword": "newer-pass-456" }`. The token works once and expires after
`PASSWORD_RESET_MINUTES` (default 30). Signs out every session. Response `200`: `data.message` = `Password reset; sign in with the new password`.

Errors: `400` (`Invalid or expired reset token`, or policy violation), `429`.

### POST /api/auth/verify-email

Role: public. Body: `{ "token": "<token from the email>" }`. Response `200`: `data.message` = `Email verified`.
Errors: `400 Invalid or expired verification token`, `429`.

### POST /api/auth/resend-verification

Role: any logged-in user. No body. Invalidates earlier tokens and queues a new email. Response `200`: `data.message` = `Verification email sent`.
Errors: `401`, `409 Email is already verified`, `429`.

---

## Products

Product object (`price` is in rupees; `latestReviews` is present only on `GET /api/products/:id`):

```json
{
  "id": "6ae9e30fdee657e5637b92f4",
  "name": "Atomic Habits",
  "description": "A practical guide to building good habits and breaking bad ones, paperback.",
  "category": "Books",
  "price": 499,
  "stock": 100,
  "lowStockThreshold": 5,
  "images": [{ "id": "6ae9e30fdee657e5637b92f5", "url": "/uploads/ebd20865-e74d-4c31-b0c6-1bd6afcd2f85.png", "size": 7874, "mimeType": "image/png" }],
  "reviewCount": 0,
  "averageRating": 0,
  "isArchived": false,
  "createdAt": "2026-11-03T13:35:11.633Z",
  "updatedAt": "2026-11-03T13:35:11.633Z",
  "latestReviews": []
}
```

`averageRating` is 0 for an unreviewed product, otherwise 1.0 to 5.0 rounded half-up to one decimal.

### GET /api/products

Role: public (a bad `Authorization` header is still `401`). Archived products are hidden unless an admin passes `includeArchived=true`.

Query (all optional):

| Param | Meaning |
|---|---|
| `q` | text search over name and description (1 to 100 chars) |
| `category` | exact category, case-insensitive |
| `minPrice`, `maxPrice` | rupees, at most 2 decimals; `minPrice` must not exceed `maxPrice` |
| `minRating` | 0 to 5 |
| `sort` | `newest` (default), `price_asc`, `price_desc`, `rating_desc` |
| `includeArchived` | `true` / `false`, admin only (ignored for others) |
| `page`, `limit` | pagination |

Response `200`: `{ "success": true, "data": [ <product>, ... ], "meta": { "page": 1, "limit": 10, "total": 12, "totalPages": 2 } }`. Errors: `400`, `401` (bad token).

### GET /api/products/:id

Role: public; admins can also read archived products. Response `200`: `data` is the product with `latestReviews` (the 5 newest reviews).
Errors: `400` bad id, `404` unknown or archived (for non-admins).

### POST /api/products

Role: admin. `multipart/form-data`:

| Field | Rules |
|---|---|
| `name` | 2 to 100 chars; unique among non-archived products, ignoring case |
| `description` | 1 to 1000 chars |
| `price` | rupees, greater than 0, at most 2 decimals |
| `category` | 1 to 50 chars |
| `stock` | integer, 0 or more |
| `lowStockThreshold` | optional integer, 0 or more (default 5) |
| `images` | 1 to 5 files, JPEG/PNG/WEBP only, 2 MB each (type checked from the file's bytes, not the extension) |

Response `201`: `data` is the new product.

Errors: `400` (validation, no images, more than 5, a file over 2 MB, a file that is not a real JPEG/PNG/WEBP, a field other than `images`), `401`, `403`, `409 A product with this name already exists`.

### PATCH /api/products/:id

Role: admin. `multipart/form-data` (or JSON when no images are sent). Any of the create fields (all optional), plus:

| Field | Rules |
|---|---|
| `images` | new files to add |
| `removeImageIds` | ids of existing images to delete; repeat the field, comma-separate, or send a JSON array string |

The product must end with 1 to 5 images. Response `200`: the updated product.

Errors: `400` (nothing to update; unknown `removeImageIds`; image count out of range; validation), `401`, `403`, `404` (unknown or archived), `409` (duplicate name or a concurrent edit).

### DELETE /api/products/:id

Role: admin. Archives (soft-deletes) the product; existing orders keep their snapshot. Response `200`: the product with `isArchived: true`.
Errors: `400`, `401`, `403`, `404` (unknown or already archived).

### GET /api/products/:id/reviews

Role: public. Query: `page`, `limit`. Newest first. Response `200`:

```json
{
  "success": true,
  "data": [{ "id": "...", "product": "6ae9e30fdee657e5637b92f4", "reviewerName": "Asha Rao", "rating": 5, "comment": "Great read", "createdAt": "...", "updatedAt": "..." }],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

Errors: `400`, `404` (unknown or archived product).

### POST /api/products/:id/reviews

Role: customer. Body: `{ "rating": 5, "comment": "Great read" }` (`rating` integer 1 to 5; `comment` optional, up to 500 chars). The reviewer name comes from the account.
Allowed only when the customer has a **Delivered** order containing the product, and once per product. Response `201`: the review.

Errors: `400`, `401`, `403` (not a customer, or no delivered order with this product), `404`, `409 You have already reviewed this product`.

---

## Orders

Order object:

```json
{
  "id": "6ae9e354207a135a279602c5",
  "customerId": "6ae9e352207a135a279602b7",
  "customerName": "Asha Rao",
  "customerEmail": "asha@example.com",
  "status": "Pending",
  "statusHistory": [{ "status": "Pending", "changedBy": "6ae9e352207a135a279602b7", "at": "2026-11-03T13:36:20.355Z" }],
  "items": [{ "productId": "6ae9e30fdee657e5637b92f4", "name": "Atomic Habits", "unitPrice": 499, "quantity": 2, "lineTotal": 998 }],
  "total": 998,
  "createdAt": "2026-11-03T13:36:20.357Z",
  "updatedAt": "2026-11-03T13:36:20.357Z"
}
```

Statuses: `Pending`, `Shipped`, `Delivered`, `Cancelled`.

### POST /api/orders

Role: customer (an admin gets `403`). Required header: `Idempotency-Key: <UUID>`.

Body:

```json
{
  "customerName": "Asha Rao",
  "customerEmail": "asha@example.com",
  "items": [{ "productId": "6ae9e30fdee657e5637b92f4", "quantity": 2 }]
}
```

`items`: 1 to 20 entries, `quantity` 1 to 100. Prices are never sent; they are read from the products. Repeated `productId`s are merged by summing quantities
(a merged quantity above 100 is a `400`). The order, the stock decrement and the email-outbox rows are one database transaction.

Response `201`: the order. Replaying the same key and body returns the original status and body with header `Idempotency-Replayed: true` and changes nothing.

Errors:
- `400` missing or non-UUID `Idempotency-Key`, or invalid body.
- `403 EMAIL_NOT_VERIFIED` when `REQUIRE_EMAIL_VERIFICATION=true` and the email is unverified.
- `404` a product does not exist or is archived (`details` lists the ids).
- `409 INSUFFICIENT_STOCK`; nothing is changed. Example:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock for one or more items",
    "details": [{ "productId": "6ae9e30fdee657e5637b92f4", "name": "Atomic Habits", "requested": 100, "available": 98 }]
  }
}
```

- `409` while another request with the same key is still running (retry shortly).
- `422 IDEMPOTENCY_KEY_REUSED` same key, different body (the key is in `details[0].key`).

A failed request releases its key, so it can be retried with the same key once the problem is fixed. Keys are remembered for `IDEMPOTENCY_TTL_HOURS` (default 24).

### GET /api/orders

Role: customer (own orders only) or admin (all). Newest first. Query:

| Param | Who | Meaning |
|---|---|---|
| `status` | both | one of the four statuses |
| `customerEmail` | admin | exact email |
| `from`, `to` | admin | `YYYY-MM-DD` (an **IST** day; `to` includes the whole day) or a full ISO datetime |
| `page`, `limit` | both | pagination |

Response `200`: `{ "success": true, "data": [ <order>, ... ], "meta": { ... } }`. Errors: `400` (bad status/date, or `from` after `to`), `401`.

### GET /api/orders/:id

Role: customer (own) or admin. Response `200`: the order. Errors: `400`, `401`, `404` (missing, or another customer's order).

### PATCH /api/orders/:id

Role: see the table. Body: `{ "status": "Shipped" }`.

| From | To | Who |
|---|---|---|
| Pending | Shipped | admin |
| Shipped | Delivered | admin |
| Pending | Cancelled | admin or the owning customer |

Cancelling restores stock. Every change is recorded in `statusHistory` and queues an email to the customer. Response `200`: the updated order.

Errors: `400` (unknown status), `401`, `403` (valid transition but not for your role; `details[0].allowedTransitions` lists yours), `404`,
`409 INVALID_TRANSITION` (`details[0]` has `currentStatus` and `allowedNextStatuses`; also returned when two requests race and the other won).

---

## Reports

### GET /api/reports/sales

Role: admin. Query: `from` and `to`, both required, `YYYY-MM-DD`; `from` must not be after `to`; the range is at most 366 days.

**Days are grouped in IST (Asia/Kolkata, UTC+05:30).** An order belongs to the IST calendar day of its `createdAt` (so an order placed at 20:00 UTC counts for the *next* IST day),
`from` starts at 00:00 IST and `to` ends at 24:00 IST. Cancelled orders are excluded from revenue, order count, daily revenue and top products, but appear in `ordersByStatus`.

Response `200`:

```json
{
  "success": true,
  "data": {
    "range": { "from": "2026-11-03", "to": "2026-11-03", "timezone": "Asia/Kolkata" },
    "totalRevenue": 998,
    "orderCount": 1,
    "ordersByStatus": { "Pending": 1, "Shipped": 0, "Delivered": 0, "Cancelled": 0 },
    "revenuePerDay": [{ "date": "2026-11-03", "revenue": 998, "orders": 1 }],
    "topProducts": [{ "productId": "6ae9e30fdee657e5637b92f4", "name": "Atomic Habits", "quantitySold": 2, "revenue": 998 }]
  }
}
```

`revenuePerDay` has one row for every day in the range (zeros when there were no sales); `topProducts` is the 5 best sellers by quantity.
Errors: `400` (missing or invalid dates, `from` after `to`, range over 366 days), `401`, `403`.

---

## Admin

### GET /api/admin/email-jobs

Role: admin. Lists the email outbox, newest first. Query: `status` (`pending`, `sending`, `sent`, `failed`), `event` (`ORDER_PLACED`, `STATUS_CHANGED`, `LOW_STOCK`, `EMAIL_VERIFICATION`, `PASSWORD_RESET`), `page`, `limit`.

Response `200`:

```json
{
  "success": true,
  "data": [{
    "id": "6ae9e354207a135a279602c6", "event": "ORDER_PLACED", "to": "asha@example.com",
    "subject": "Order 6ae9e354207a135a279602c5 received", "status": "pending", "attempts": 0, "lastError": null,
    "orderId": "6ae9e354207a135a279602c5", "productId": null, "userId": null,
    "nextAttemptAt": "2026-11-03T13:36:20.358Z", "sentAt": null, "messageId": null, "createdAt": "2026-11-03T13:36:20.358Z"
  }],
  "meta": { "page": 1, "limit": 10, "total": 2, "totalPages": 1 }
}
```

Errors: `400`, `401`, `403`.

### GET /api/admin/users

Role: admin. Query: `role` (`customer` / `admin`), `isActive` (`true` / `false`), `q` (substring of name or email), `page`, `limit`. Newest first.
Response `200`: `{ "success": true, "data": [ <user>, ... ], "meta": { ... } }`. Errors: `400`, `401`, `403`.

### POST /api/admin/users

Role: admin. Body: `{ "name": "Ravi Shah", "email": "ravi@example.com", "password": "secret123", "role": "customer" }` (`role` is `customer` or `admin`, default `customer`).
The account counts as email-verified. Response `201`: the user.
Errors: `400`, `401`, `403`, `409 Email already registered`.

### PATCH /api/admin/users/:id

Role: admin. Body: `{ "role": "admin" }` and/or `{ "isActive": false }` (at least one). Deactivating a user signs them out everywhere.
Response `200`: the user.
Errors: `400`, `401`, `403`, `404 User not found`, `409 You cannot change your own role or deactivate your own account`.
