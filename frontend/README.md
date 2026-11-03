# Product & Order Management – React client

```
cp .env.example .env     # set VITE_API_URL (e.g. http://localhost:5000)
npm install
npm run dev              # Vite dev server
npm test                 # Vitest + React Testing Library + MSW (no backend needed)
npm run build
```

## Structure

- `src/api/` – one shared axios client (`client.js`: token, `X-Request-Id`, error normalisation, 401 hook) plus one module per resource. Components never call axios directly.
- `src/context/` – `AuthContext` (token, `/api/auth/me`, 401 → login → return), `CartContext` (localStorage; prunes archived products and caps quantities on load).
- `src/features/` – `auth`, `products`, `cart`, `orders`, `reports`.
- `src/components/` – `Pagination`, `StarRating`, `ConfirmDialog`, `DataState` (loading/empty/error), `FormField`, `ProtectedRoute`, `Layout`.
- `src/hooks/useAsync.js` – aborts and ignores superseded requests (stale-response protection).

## Routes

| Route | Access |
| --- | --- |
| `/`, `/products/:id`, `/login`, `/register` | public |
| `/cart` | customer |
| `/orders`, `/orders/:id` | customer or admin |
| `/admin/products/new`, `/admin/products/:id/edit`, `/admin/reports` | admin (customers get a 403 page) |

## API assumptions (adjust in `src/api/*` if yours differ)

Paths: `POST /api/auth/login|register` → `{ success, data: { user, token } }` (all responses use the `{ success, data, meta }` envelope, unwrapped in `src/api/client.js`), `GET /api/auth/me`, `GET /api/products` (`q, category, minPrice, maxPrice, minRating, sort, page, limit`), `GET|PUT|DELETE /api/products/:id` (DELETE = archive; PUT is multipart with `images` and `removeImages`), `GET|POST /api/products/:id/reviews`, `POST /api/orders` (`Idempotency-Key` header, body `{ customerName, customerEmail, items: [{productId, quantity}] }`, UUID key), `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/cancel`, `PATCH /api/orders/:id/status`, `GET /api/reports/sales?from&to`.

Statuses flow `Pending → Shipped → Delivered` (or `Cancelled`). A 409 on checkout should list `items: [{ productId, available }]`. Field errors are read from `errors`/`details` (array of `{field, message}` or an object). Response normalisers in `src/api` accept `_id`/`id`, `items`/`data`, etc.
