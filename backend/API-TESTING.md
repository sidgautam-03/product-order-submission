# Postman test guide

Base URL: `http://localhost:5000` (the `PORT` in `.env`). Make a Postman **collection variable** `baseUrl` and use
`{{baseUrl}}/api/...`. Other variables used below: `adminToken`, `customerToken`, `customer2Token`, `productId`,
`product2Id`, `imageId`, `orderId`, `order2Id`.

Auth header on protected requests: `Authorization: Bearer {{adminToken}}` (or `{{customerToken}}`).
Tip, in the **Tests** tab of login/register requests, to save the token automatically:

```js
pm.collectionVariables.set("customerToken", pm.response.json().data.token);   // adminToken for the admin login
```

Every response has `X-Request-Id`; errors look like `{ "success": false, "error": { "code", "message", "details" } }`.

> **Rate limit:** register and login allow **5 requests per 15 minutes per IP each**, so do the 429 test **last** (restarting the
> API server resets it). Set `AUTH_RATE_LIMIT_MAX=100` in `.env` if you want to repeat auth tests freely.

---

## Suggested order

1. Seed + admin login  2. Register customers  3. Create products  4. Browse products  5. Place orders  6. Idempotency
7. Order status + cancel (stock restore)  8. Reviews  9. Sales report  10. Emails  11. Negative / security cases  12. Rate limit (last)

---

## 0. Before you start

Run `npm run seed` once (creates the admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`). Running it again prints "already exists".
Run the API (`npm run dev`) and the worker (`npm run worker`, needs `SMTP_USER` / `SMTP_PASS` from Ethereal).

---

## 1. Authentication

### 1.1 Admin login: `POST /api/auth/login`
```json
{ "email": "<ADMIN_EMAIL from .env>", "password": "<ADMIN_PASSWORD from .env>" }
```
Expect **200**, `data.token`, `data.user.role = "admin"`, no password/hash in the response. Save as `adminToken`.

### 1.2 Register customers: `POST /api/auth/register`
```json
{ "name": "Asha Patel", "email": "asha@example.com", "password": "Passw0rd123" }
```
Expect **201**, `role: "customer"`, token. Save as `customerToken`. Register a second one (`customer2Token`):
```json
{ "name": "Ravi Shah", "email": "ravi@example.com", "password": "Passw0rd123" }
```

| Scenario | Body | Expect |
|---|---|---|
| Role is ignored | `{ "name": "Sneaky", "email": "sneaky@example.com", "password": "Passw0rd123", "role": "admin" }` | 201, `role: "customer"` |
| Same email, different case | `{ "name": "Asha 2", "email": "ASHA@Example.com", "password": "Passw0rd123" }` | 409 |
| No number in password | `{ "name": "Test", "email": "t1@example.com", "password": "onlyletters" }` | 400 + detail |
| No letter in password | `{ "name": "Test", "email": "t2@example.com", "password": "12345678" }` | 400 |
| Too short | `{ "name": "Test", "email": "t3@example.com", "password": "ab1" }` | 400 |
| Bad email / short name | `{ "name": "A", "email": "nope", "password": "Passw0rd123" }` | 400 with 2 details |
| Missing fields | `{}` | 400 |

### 1.3 Login scenarios: `POST /api/auth/login`
| Scenario | Body | Expect |
|---|---|---|
| Valid customer | `{ "email": "asha@example.com", "password": "Passw0rd123" }` | 200 |
| Wrong password | `{ "email": "asha@example.com", "password": "Wrong123" }` | 401 `Invalid email or password` |
| Unknown email | `{ "email": "ghost@example.com", "password": "Passw0rd123" }` | 401, **same message** as above |
| Operator injection | `{ "email": { "$gt": "" }, "password": { "$gt": "" } }` | 400 (blocked) |

### 1.4 Current user: `GET /api/auth/me`
| Scenario | Header | Expect |
|---|---|---|
| Valid | `Authorization: Bearer {{customerToken}}` | 200 |
| No header | (none) | 401 |
| Garbage token | `Authorization: Bearer abc` | 401 |
| Wrong scheme | `Authorization: {{customerToken}}` | 401 |

---

## 2. Products (admin): `POST /api/products`

Body type **form-data** (not raw JSON), header `Authorization: Bearer {{adminToken}}`. Do not set Content-Type manually.

| Key | Type | Value |
|---|---|---|
| name | text | `Wireless Mouse` |
| description | text | `Ergonomic 2.4GHz wireless mouse` |
| price | text | `499.99` |
| category | text | `Electronics` |
| stock | text | `6` |
| lowStockThreshold | text | `5` |
| images | **File** | a real JPG/PNG/WEBP under 2 MB (add the key `images` several times for several files, max 5) |

Expect **201**: `price: 499.99`, `images: [{ id, url, size, mimeType }]`, `averageRating: 0`, `reviewCount: 0`. Save `data.id` as
`productId` and `data.images[0].id` as `imageId`. Open `{{baseUrl}}{{url}}` (for example `http://localhost:5000/uploads/<uuid>.png`) in a
browser to see the image. Create a second product the same way (`product2Id`): name `Phone Case`, price `150`, category `electronics`, stock `50`.

| Scenario | How | Expect |
|---|---|---|
| Customer token | use `{{customerToken}}` | 403 |
| No token | remove header | 401 |
| No image | omit `images` | 400 `At least 1 image is required` |
| Fake image | attach a `.txt` renamed to `.jpg` | 400 `not a valid image` |
| SVG | attach an `.svg` | 400 |
| Oversized | attach a file > 2 MB | 400 `2 MB or smaller` |
| 6 images | attach 6 files | 400 `At most 5 images` |
| Duplicate name | name `wireless MOUSE` | 409 |
| Bad price | `price` = `1.234`, `0`, `abc` | 400 |
| Bad stock | `stock` = `-1` or `1.5` | 400 |

### 2.1 Update: `PATCH /api/products/:id` (admin)
JSON is fine when there are no files: header `Content-Type: application/json`
```json
{ "price": 599.5, "stock": 10, "description": "Updated description" }
```
Expect 200, `price: 599.5`. To add and remove images together use **form-data**: key `images` (File) + key `removeImageIds` (text) = `{{imageId}}`.

| Scenario | Body | Expect |
|---|---|---|
| Remove the only image | form-data `removeImageIds={{imageId}}`, no new file | 400 (must keep 1 to 5) |
| Remove + add | `removeImageIds={{imageId}}` + one new `images` file | 200, old file gone from `uploads/` |
| Unknown image id | `removeImageIds=665f1c2e9b1d4a0012ab34cd` | 400 |
| Empty update | `{}` | 400 `Nothing to update` |
| Rename onto existing | `{ "name": "Phone Case" }` on the mouse | 409 |
| Bad id | `PATCH /api/products/123` | 400 |
| Unknown id | `PATCH /api/products/665f1c2e9b1d4a0012ab34cd` | 404 |

### 2.2 Archive: `DELETE /api/products/:id` (admin)
Do this on a throwaway product. Expect 200 with `isArchived: true`. Again → 404. `GET /api/products/:id` as public → 404,
as admin → 200. The name can then be reused.

---

## 3. Browse products (public, no token)

`GET /api/products` and `GET /api/products/{{productId}}` (includes `latestReviews`, up to 5).

| Request | Expect |
|---|---|
| `/api/products?q=wireless` | text search on name + description |
| `/api/products?category=ELECTRONICS` | case-insensitive |
| `/api/products?minPrice=100&maxPrice=5000&minRating=0` | filters combine |
| `/api/products?sort=price_asc` / `price_desc` / `rating_desc` / `newest` | sorted |
| `/api/products?page=1&limit=2` | `meta: { page, limit, total, totalPages }` |
| `/api/products?limit=500` | `meta.limit = 50` |
| `/api/products?includeArchived=true` + admin token | includes archived; customers/public never see them |
| `/api/products?sort=bogus` | 400 |
| `/api/products?minPrice=500&maxPrice=100` | 400 |
| `/api/products?page=0` | 400 |
| `/api/products?category[$ne]=x` | 400 (injection blocked) |
| `/api/products/abc` | 400 invalid id |
| `/api/products/665f1c2e9b1d4a0012ab34cd` | 404 |

---

## 4. Place orders: `POST /api/orders` (customer)

Headers: `Authorization: Bearer {{customerToken}}`, `Idempotency-Key: 7c9e6679-7425-40de-944b-e07fc1f90ae7` (any UUID; in Postman you can
use `{{$guid}}` for a fresh one), `Content-Type: application/json`.
```json
{
  "customerName": "Asha Patel",
  "customerEmail": "asha@example.com",
  "items": [
    { "productId": "{{productId}}", "quantity": 2 },
    { "productId": "{{product2Id}}", "quantity": 1 }
  ]
}
```
Expect **201**, `status: "Pending"`, `total` computed by the server (e.g. 2 x 499.99 + 150 = 1149.98), `statusHistory` with one entry.
Save `data.id` as `orderId`. Check `GET /api/products/{{productId}}`: `stock` dropped by 2. (Mouse stock 6 and threshold 5, so stock is now 4: a
**low-stock email** is queued for the admin.)

| Scenario | Change | Expect |
|---|---|---|
| Missing key header | remove `Idempotency-Key` | 400, `details[0].path = "Idempotency-Key"` |
| Bad key | `Idempotency-Key: abc` | 400 `must be a UUID` |
| Admin places order | admin token | 403 |
| No token | remove header | 401 |
| Not enough stock | `quantity: 100` on the mouse | 409 `INSUFFICIENT_STOCK`, details list `requested` / `available` |
| Two failing items | two products, both over stock | 409 listing **both** |
| Archived / unknown product | `productId` of an archived or random id | 404 with the product id |
| Quantity 0 / 101 / 1.5 | in `items[0].quantity` | 400 |
| Empty / 21 items | `"items": []` | 400 |
| Bad email or name > 100 | | 400 |
| Bad product id | `"productId": "abc"` | 400 |
| Duplicate product lines | same `productId` twice (2 + 3) | 201, merged into one line of quantity 5 |
| Client price | add `"price": 1` or `"total": 1` to an item/body | ignored |

---

## 5. Idempotency

1. Send the order in section 4 with a fixed key, say `11111111-1111-4111-8111-111111111111`. -> 201.
2. Send the **exact same request** again. -> **201, same order id**, header `Idempotency-Replayed: true`, stock unchanged.
3. Same key, **different body** (change a quantity). -> **422**, `details[0].key` shows the key.
4. Same key with `{{customer2Token}}`. -> 201, a different order (keys are per user).
5. Failed request frees the key: send a too-large quantity with a new key (409), then fix the quantity and reuse that key -> 201.

---

## 6. Order status and cancellation

`PATCH /api/orders/{{orderId}}` body `{ "status": "Shipped" }`

| Who | Request | Expect |
|---|---|---|
| Admin | Pending -> `Shipped` | 200, `statusHistory` has 2 entries with `changedBy` |
| Admin | Shipped -> `Delivered` | 200 |
| Customer | Pending -> `Shipped` | 403, `details[0].allowedTransitions = [{from: "Pending", to: "Cancelled"}]` |
| Admin | `Pending` -> `Delivered` (skip) | 409, `currentStatus` + `allowedNextStatuses` |
| Admin | repeat the same status | 409 |
| Anyone | change a `Delivered` or `Cancelled` order | 409, `allowedNextStatuses: []` |
| Customer | Pending -> `Cancelled` (own order) | 200, **stock restored** (check the product) |
| Customer 2 | any change on the first customer's order | **404** (same as a missing order) |
| Admin | `{ "status": "Teleported" }` or `{}` | 400 |
| Admin | `PATCH /api/orders/abc` | 400 |

Place a new order for the cancel test (cancelling your `orderId` first would stop you reviewing). Cancel the second order (`order2Id`).

**Reads:** `GET /api/orders/{{orderId}}` (owner or admin, else 404). `GET /api/orders`: customers see only their own;
`?status=Shipped`, `?page=1&limit=10`; admin only: `?customerEmail=asha@example.com`, `?from=2026-11-01&to=2026-11-30`
(IST days). `?status=Nope` -> 400.

---

## 7. Reviews

Needs a **Delivered** order, so finish section 6 for `orderId` first (Pending -> Shipped -> Delivered).

`POST /api/products/{{productId}}/reviews` with `{{customerToken}}`:
```json
{ "rating": 5, "comment": "Great mouse" }
```
Expect **201**, `reviewerName: "Asha Patel"` (from the account; an extra `"reviewerName": "x"` in the body is ignored).
Then `GET /api/products/{{productId}}`: `averageRating: 5`, `reviewCount: 1`, `latestReviews`.

| Scenario | Expect |
|---|---|
| Review again with the same customer | 409 |
| Customer 2 (no delivered order) | 403 |
| Admin posts a review | 403 |
| Delivered, but a different product | 403 |
| `{ "rating": 0 }`, `{ "rating": 6 }`, `{ "rating": 3.5 }` | 400 |
| `comment` over 500 characters | 400 |
| No token | 401 |

`GET /api/products/{{productId}}/reviews?page=1&limit=10` is public, newest first, with `meta`.

---

## 8. Sales report (admin): `GET /api/reports/sales?from=2026-11-01&to=2026-11-30`

Expect `totalRevenue`, `orderCount` (cancelled excluded), `ordersByStatus` (all four statuses), `revenuePerDay` (one entry per day, zero when
no sales; **days are IST**), `topProducts` (up to 5). Errors: missing `from`/`to`, `from` after `to`, `2026-02-30`, a range over 366 days -> 400.
Customer token -> 403, no token -> 401.

---

## 9. Emails

| What | Where |
|---|---|
| Customer: order placed + every status change (incl. cancel) | Ethereal inbox: https://ethereal.email/messages (log in with `SMTP_USER` / `SMTP_PASS`) |
| Admin: low stock | same inbox (recipient is `ADMIN_EMAIL`) |
| Outbox rows | `GET /api/admin/email-jobs` (admin) with `?status=pending`, `sent`, `failed`, `?event=ORDER_PLACED` |
| Logs | `logs/email.log` (sent, with `previewUrl`), `logs/email-error.log` (failures) |

Low-stock check: with threshold 5, an order that takes stock to 5 or below queues one `LOW_STOCK` email; more orders do **not** queue another until
stock is back above 5 (for example by cancelling, or `PATCH` stock to 50).
Failure check: stop the worker, set a wrong `SMTP_PASS`, restart it, place an order: the job shows `attempts` rising up to `EMAIL_MAX_ATTEMPTS`,
then `failed` with `lastError`.

---

## 10. Security and error checks

| Request | Expect |
|---|---|
| `POST /api/orders` body `{ "items": [{ "productId": { "$ne": null }, "quantity": 1 }] }` | 400 (injection blocked) |
| `GET /api/products?$where=1` | 400 |
| `GET /api/nope` | 404 `NOT_FOUND` |
| `POST /api/auth/login` with broken JSON `{bad` | 400 |
| Send header `X-Request-Id: my-trace-1` on any request | same value returned in the response header and in the log line |
| `GET /health` | 200 with helmet headers |

## 11. Rate limit (do last)

Send `POST /api/auth/login` 6 times in a row (any body). The 6th returns **429** with a `Retry-After` header and
`error.code = "RATE_LIMITED"`. Register has its own counter. Restart the API to reset.
