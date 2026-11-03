# e2e: checks against a running API

These need the API running (`npm run dev`) and the admin seeded (`npm run seed`). They talk to the real server and
database, unlike the Jest tests in `tests/`, which start their own in-memory MongoDB.

| File | What it is |
|---|---|
| `parallel-orders.mjs` | `npm run e2e`. Creates its own product and customer, then checks that 20 parallel orders for 1 unit with stock 5 give exactly 5 x `201` and 15 x `409` with final stock 0, and that the same `Idempotency-Key` sent 5 times at once creates one order. Set `API_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` if they differ from the defaults. |
| `product-order.postman_collection.json` | Every endpoint in order (74 requests, 102 assertions). Import it into Postman and run the folders top to bottom, or run `npm run e2e:postman`. |
| `Local.postman_environment.json` | The `baseUrl` and admin login the collection uses. Import it and select "Local". |
| `sample.png`, `not-an-image.jpg` | Fixtures for the upload requests (a real 1x1 PNG, and a text file with a `.jpg` name that the API must reject). |

Notes
- Register and login are rate limited (5 per 15 minutes per IP and per route; see `src/middleware/rateLimit.js`). One full
  collection run uses 3 logins and 3 registrations, so it fits, but a second run within 15 minutes (or earlier logins of your
  own) can hit the limit. Restart the API between runs (that resets the in-memory counters), or start it with
  `AUTH_RATE_LIMIT_MAX=100`.
- The run stops with an explanation at the first `429`, and at the first failing request that later requests depend on
  (for example a register or login), instead of letting everything after it fail. It also clears any variables left over from
  an earlier run when it starts.
- The collection creates its own users, products and orders (names and emails include a per-run id), so it can be re-run.
- Real password-reset and email-verification tokens only arrive by email (the `emailjobs` collection or the Ethereal inbox),
  so the collection runs just their failure paths.
- Postman may ask you to re-select `sample.png` for the product upload requests: pick it from this folder.
- Node's `fetch` refuses some ports (for example 5060 and 5061), so run the API on a normal port such as 5000.
