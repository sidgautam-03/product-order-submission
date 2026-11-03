// Live concurrency check against a RUNNING API (and its real MongoDB):
//   1. 20 parallel orders for 1 unit of a product with stock 5  -> exactly 5 x 201, 15 x 409, final stock 0
//   2. the same Idempotency-Key sent at the same moment          -> one order, stock reduced once, identical responses
//
//   node e2e/parallel-orders.mjs
//
// Environment (all optional):
//   API_URL         default http://localhost:5000
//   ADMIN_EMAIL     default admin@example.com        (the seeded admin)
//   ADMIN_PASSWORD  default change-me-123
//
// It creates its own product and customer, so it is safe to run repeatedly. Note that register/login are rate
// limited (5 per 15 minutes per IP by default); each run uses 1 admin login and 1 register (+1 login on re-runs).
import crypto from 'node:crypto';

const API = (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-123';
const PARALLEL = 20;
const STOCK = 5;

// 1x1 PNG, enough for the API's magic-byte check
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

async function call(method, url, { token, json, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (form) body = form;
  const res = await fetch(API + url, { method, headers: h, body });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, body: data, data: data?.data };
}

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

async function createProduct(adminToken, name, stock) {
  const form = new FormData();
  const fields = { name, description: 'Created by e2e/parallel-orders.mjs', price: '10.00', category: 'E2E', stock };
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append('images', new Blob([PNG], { type: 'image/png' }), 'e2e.png');
  const res = await call('POST', '/api/products', { token: adminToken, form });
  if (res.status !== 201) throw new Error(`could not create the product: ${res.status} ${JSON.stringify(res.body)}`);
  return res.data;
}

async function main() {
  console.log(`API: ${API}\n`);
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`the API is not reachable at ${API}; start it first (npm run dev)`);

  const admin = await call('POST', '/api/auth/login', { json: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (admin.status !== 200) throw new Error(`admin login failed (${admin.status}); run "npm run seed" and check ADMIN_EMAIL / ADMIN_PASSWORD`);

  const email = 'e2e.parallel@example.com';
  const password = 'Passw0rd123';
  let customer = await call('POST', '/api/auth/register', { json: { name: 'E2E Parallel', email, password } });
  if (customer.status === 409) customer = await call('POST', '/api/auth/login', { json: { email, password } });
  if (![200, 201].includes(customer.status)) throw new Error(`customer setup failed: ${customer.status} ${JSON.stringify(customer.body)}`);
  const token = customer.data.token;

  const order = (productId, key = crypto.randomUUID(), quantity = 1) =>
    call('POST', '/api/orders', {
      token,
      headers: { 'Idempotency-Key': key },
      json: { customerName: 'E2E Parallel', customerEmail: email, items: [{ productId, quantity }] },
    });
  const stockOf = async (id) => (await call('GET', `/api/products/${id}`)).data.stock;

  // ---- 1. parallel orders ----
  console.log(`1. ${PARALLEL} parallel orders for 1 unit, stock ${STOCK}`);
  const racer = await createProduct(admin.data.token, `E2E Race ${Date.now()}`, STOCK);
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: PARALLEL }, () => order(racer.id)));
  const elapsed = Date.now() - started;
  const created = results.filter((r) => r.status === 201).length;
  const conflicts = results.filter((r) => r.status === 409).length;
  const others = results.filter((r) => r.status !== 201 && r.status !== 409).map((r) => r.status);
  check(created === STOCK, `exactly ${STOCK} orders returned 201`, `got ${created}`);
  check(conflicts === PARALLEL - STOCK, `exactly ${PARALLEL - STOCK} orders returned 409`, `got ${conflicts}`);
  check(others.length === 0, 'no other status codes', others.join(','));
  const finalStock = await stockOf(racer.id);
  check(finalStock === 0, 'final stock is 0 (never negative)', `got ${finalStock}`);
  const detail = results.find((r) => r.status === 409)?.body?.error;
  check(detail?.code === 'INSUFFICIENT_STOCK' && detail.details?.[0]?.available === 0, '409 body lists the failing item with its available quantity');
  console.log(`   all ${PARALLEL} requests finished in ${elapsed} ms\n`);

  // ---- 2. same Idempotency-Key at the same moment ----
  console.log('2. the same Idempotency-Key sent 5 times at once');
  const idem = await createProduct(admin.data.token, `E2E Idempotent ${Date.now()}`, 10);
  const key = crypto.randomUUID();
  const burst = await Promise.all(Array.from({ length: 5 }, () => order(idem.id, key, 2)));
  check(burst.every((r) => r.status === 201), 'every response is 201', burst.map((r) => r.status).join(','));
  check(burst.every((r) => JSON.stringify(r.body) === JSON.stringify(burst[0].body)), 'all responses are identical (same order)');
  check((await stockOf(idem.id)) === 8, 'stock was reduced once (10 -> 8)');
  const different = await order(idem.id, key, 3);
  check(different.status === 422, 'the same key with a different body returns 422', `got ${different.status}`);
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(`\nERROR: ${err.message}`);
}
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
