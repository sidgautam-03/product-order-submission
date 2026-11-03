import crypto from 'node:crypto';
import request from 'supertest';
import { setup } from './helpers.js';

let t, app, admin, customer, other, Product, Order, EmailJob, IdempotencyKey;

beforeAll(async () => {
  t = await setup();
  app = t.app;
  ({ Product, Order, EmailJob, IdempotencyKey } = t.models);
  admin = await t.makeUser(t.ROLES.ADMIN);
  customer = await t.makeUser();
  other = await t.makeUser();
}, 120000);

afterAll(() => t.teardown());

const newKey = () => crypto.randomUUID();
const body = (items, over = {}) => ({
  customerName: 'Asha Patel',
  customerEmail: 'Asha@Example.com',
  items: items.map(([p, quantity]) => ({ productId: String(p.id), quantity })),
  ...over,
});
const place = (auth, payload, key = newKey()) =>
  request(app).post('/api/orders').set(auth).set('Idempotency-Key', key).send(payload);
const stockOf = async (p) => (await Product.findById(p.id)).stock;
const patchStatus = (auth, id, status) => request(app).patch(`/api/orders/${id}`).set(auth).send({ status });

describe('placing an order', () => {
  test('creates a Pending order with server-calculated totals in rupees and decrements stock', async () => {
    const a = await t.makeProduct({ pricePaise: 49999, stock: 10 });
    const b = await t.makeProduct({ pricePaise: 1050, stock: 5 });
    const res = await place(customer.auth, { ...body([[a, 2], [b, 1]]), items: [{ productId: a.id, quantity: 2, price: 1 }, { productId: b.id, quantity: 1 }], total: 1 });
    expect(res.status).toBe(201);
    const o = res.body.data;
    expect(o.status).toBe('Pending');
    expect(o.customerEmail).toBe('asha@example.com');
    expect(o.customerId).toBe(customer.user.id);
    expect(o.total).toBe(1010.48); // 2 x 499.99 + 10.50, client price ignored
    const line = o.items.find((i) => i.productId === a.id);
    expect(line).toEqual({ productId: a.id, name: a.name, unitPrice: 499.99, quantity: 2, lineTotal: 999.98 });
    expect(o.statusHistory).toEqual([{ status: 'Pending', changedBy: customer.user.id, at: expect.any(String) }]);
    expect(await stockOf(a)).toBe(8);
    expect(await stockOf(b)).toBe(4);
  });

  test('only customers can place orders; token required', async () => {
    const p = await t.makeProduct();
    expect((await request(app).post('/api/orders').set('Idempotency-Key', newKey()).send(body([[p, 1]]))).status).toBe(401);
    expect((await place(admin.auth, body([[p, 1]]))).status).toBe(403);
  });

  test('Idempotency-Key header is required and must be a UUID', async () => {
    const p = await t.makeProduct();
    const missing = await request(app).post('/api/orders').set(customer.auth).send(body([[p, 1]]));
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].path).toBe('Idempotency-Key');
    const bad = await place(customer.auth, body([[p, 1]]), 'not-a-uuid');
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/UUID/);
    expect(await stockOf(p)).toBe(10);
  });

  test('body validation returns field-level details', async () => {
    const p = await t.makeProduct();
    const cases = {
      customerName: body([[p, 1]], { customerName: '' }),
      'customerName ': body([[p, 1]], { customerName: 'x'.repeat(101) }),
      customerEmail: body([[p, 1]], { customerEmail: 'nope' }),
      items: body([], {}),
      'items.0.quantity': { ...body([[p, 1]]), items: [{ productId: p.id, quantity: 0 }] },
      'items.0.quantity ': { ...body([[p, 1]]), items: [{ productId: p.id, quantity: 101 }] },
      'items.0.quantity  ': { ...body([[p, 1]]), items: [{ productId: p.id, quantity: 1.5 }] },
      'items.0.productId': { ...body([[p, 1]]), items: [{ productId: 'abc', quantity: 1 }] },
    };
    for (const [path, payload] of Object.entries(cases)) {
      const res = await place(customer.auth, payload);
      expect([path, res.status]).toEqual([path, 400]);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d) => d.path)).toContain(path.trim());
    }
    const many = Array.from({ length: 21 }, () => [p, 1]);
    expect((await place(customer.auth, body(many))).status).toBe(400);
    expect(await stockOf(p)).toBe(10);
  });

  test('duplicate product ids are merged by summing quantities; merged total above 100 is rejected', async () => {
    const p = await t.makeProduct({ stock: 200 });
    const res = await place(customer.auth, { ...body([[p, 1]]), items: [{ productId: p.id, quantity: 2 }, { productId: p.id, quantity: 3 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].quantity).toBe(5);
    const tooMany = await place(customer.auth, { ...body([[p, 1]]), items: [{ productId: p.id, quantity: 60 }, { productId: p.id, quantity: 60 }] });
    expect(tooMany.status).toBe(400);
  });

  test('unknown or archived product is 404 with the product id and changes nothing', async () => {
    const ok = await t.makeProduct();
    const archived = await t.makeProduct({ isArchived: true });
    const res = await place(customer.auth, body([[ok, 1], [archived, 1]]));
    expect(res.status).toBe(404);
    expect(res.body.error.details.map((d) => d.productId)).toEqual([archived.id]);
    const ghost = await place(customer.auth, { ...body([[ok, 1]]), items: [{ productId: '665f1c2e9b1d4a0012ab34cd', quantity: 1 }] });
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.details[0].productId).toBe('665f1c2e9b1d4a0012ab34cd');
    expect(await stockOf(ok)).toBe(10);
  });

  test('insufficient stock is 409 listing every failing item, and nothing is saved or decremented', async () => {
    const fine = await t.makeProduct({ stock: 10 });
    const low = await t.makeProduct({ stock: 2 });
    const none = await t.makeProduct({ stock: 0 });
    const before = await Order.countDocuments();
    const res = await place(customer.auth, body([[fine, 3], [low, 5], [none, 1]]));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    const byId = Object.fromEntries(res.body.error.details.map((d) => [d.productId, d]));
    expect(Object.keys(byId).sort()).toEqual([low.id, none.id].sort());
    expect(byId[low.id]).toEqual({ productId: low.id, name: low.name, requested: 5, available: 2 });
    expect(byId[none.id]).toMatchObject({ requested: 1, available: 0 });
    expect(await stockOf(fine)).toBe(10); // the item that would have succeeded was rolled back
    expect(await Order.countDocuments()).toBe(before);
  });

  test('order prices, names and total do not change when the product changes or is archived', async () => {
    const p = await t.makeProduct({ pricePaise: 20000, name: 'Original Name' });
    const placed = (await place(customer.auth, body([[p, 2]]))).body.data;
    await Product.updateOne({ _id: p.id }, { pricePaise: 99900, name: 'Renamed', isArchived: true });
    const fetched = (await request(app).get(`/api/orders/${placed.id}`).set(customer.auth)).body.data;
    expect(fetched.total).toBe(400);
    expect(fetched.items[0]).toMatchObject({ name: 'Original Name', unitPrice: 200, lineTotal: 400 });
  });

  test('stock 5 and 20 parallel single-unit orders: exactly 5 succeed, 15 get 409', async () => {
    const p = await t.makeProduct({ stock: 5 });
    const results = await Promise.all(Array.from({ length: 20 }, () => place(customer.auth, body([[p, 1]]))));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(15);
    expect(await stockOf(p)).toBe(0);
    expect(await Order.countDocuments({ 'items.product': p._id })).toBe(5);
  }, 60000);
});

describe('idempotency', () => {
  test('same key and body replays the original response without touching stock again', async () => {
    const p = await t.makeProduct({ stock: 10 });
    const key = newKey();
    const first = await place(customer.auth, body([[p, 2]]), key);
    const second = await place(customer.auth, body([[p, 2]]), key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(await stockOf(p)).toBe(8);
    expect(await Order.countDocuments({ 'items.product': p._id })).toBe(1);
  });

  test('item order and duplicate-splitting do not change the request identity', async () => {
    const a = await t.makeProduct();
    const b = await t.makeProduct();
    const key = newKey();
    const first = await place(customer.auth, body([[a, 1], [b, 2]]), key);
    const swapped = await place(customer.auth, body([[b, 2], [a, 1]]), key);
    expect(swapped.status).toBe(201);
    expect(swapped.body.data.id).toBe(first.body.data.id);
  });

  test('same key with a different body is 422 and includes the key', async () => {
    const p = await t.makeProduct({ stock: 10 });
    const key = newKey();
    await place(customer.auth, body([[p, 1]]), key);
    const res = await place(customer.auth, body([[p, 2]]), key);
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].key).toBe(key);
    expect(await stockOf(p)).toBe(9);
  });

  test('keys are scoped per user', async () => {
    const p = await t.makeProduct({ stock: 10 });
    const key = newKey();
    const a = await place(customer.auth, body([[p, 1]]), key);
    const b = await place(other.auth, body([[p, 1]]), key);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });

  test('two simultaneous requests with the same key create exactly one order', async () => {
    const p = await t.makeProduct({ stock: 10 });
    const key = newKey();
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => place(customer.auth, body([[p, 2]]), key)));
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(c.body.data.id).toBe(a.body.data.id);
    expect(await Order.countDocuments({ 'items.product': p._id })).toBe(1);
    expect(await stockOf(p)).toBe(8);
  });

  test('a failed request does not burn the key; it can be retried once the problem is fixed', async () => {
    const p = await t.makeProduct({ stock: 1 });
    const key = newKey();
    expect((await place(customer.auth, body([[p, 3]]), key)).status).toBe(409);
    await Product.updateOne({ _id: p.id }, { stock: 5 });
    const retry = await place(customer.auth, body([[p, 3]]), key);
    expect(retry.status).toBe(201);
    expect(await stockOf(p)).toBe(2);
  });

  test('a key older than the TTL is treated as new', async () => {
    const p = await t.makeProduct({ stock: 10 });
    const key = newKey();
    const first = await place(customer.auth, body([[p, 1]]), key);
    await IdempotencyKey.collection.updateOne({ key }, { $set: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    const again = await place(customer.auth, body([[p, 1]]), key);
    expect(again.status).toBe(201);
    expect(again.body.data.id).not.toBe(first.body.data.id);
    expect(await stockOf(p)).toBe(8);
  });
});

describe('status changes', () => {
  const orderOf = async (p, qty = 2, who = customer) => (await place(who.auth, body([[p, qty]]))).body.data;

  test('admin moves Pending to Shipped to Delivered; each change is recorded', async () => {
    const o = await orderOf(await t.makeProduct());
    const shipped = await patchStatus(admin.auth, o.id, 'Shipped');
    expect(shipped.status).toBe(200);
    expect(shipped.body.data.status).toBe('Shipped');
    const delivered = await patchStatus(admin.auth, o.id, 'Delivered');
    expect(delivered.body.data.statusHistory.map((h) => h.status)).toEqual(['Pending', 'Shipped', 'Delivered']);
    expect(delivered.body.data.statusHistory[1].changedBy).toBe(admin.user.id);
    expect(delivered.body.data.statusHistory[2].at).toEqual(expect.any(String));
  });

  test('any other transition is 409 with the current and allowed statuses; final states stay final', async () => {
    const o = await orderOf(await t.makeProduct());
    const skip = await patchStatus(admin.auth, o.id, 'Delivered');
    expect(skip.status).toBe(409);
    expect(skip.body.error.details[0]).toEqual({ currentStatus: 'Pending', allowedNextStatuses: ['Shipped', 'Cancelled'] });
    expect((await patchStatus(admin.auth, o.id, 'Pending')).status).toBe(409); // repeating the current status
    await patchStatus(admin.auth, o.id, 'Shipped');
    expect((await patchStatus(admin.auth, o.id, 'Cancelled')).status).toBe(409);
    await patchStatus(admin.auth, o.id, 'Delivered');
    const final = await patchStatus(admin.auth, o.id, 'Shipped');
    expect(final.status).toBe(409);
    expect(final.body.error.details[0].allowedNextStatuses).toEqual([]);
  });

  test('an unknown status value is 400', async () => {
    const o = await orderOf(await t.makeProduct());
    expect((await patchStatus(admin.auth, o.id, 'Teleported')).status).toBe(400);
    expect((await request(app).patch(`/api/orders/${o.id}`).set(admin.auth).send({})).status).toBe(400);
    expect((await patchStatus(admin.auth, 'bad-id', 'Shipped')).status).toBe(400);
  });

  test('a customer cannot make admin-only transitions (403 lists what they may do)', async () => {
    const o = await orderOf(await t.makeProduct());
    const res = await patchStatus(customer.auth, o.id, 'Shipped');
    expect(res.status).toBe(403);
    expect(res.body.error.details[0].allowedTransitions).toEqual([{ from: 'Pending', to: 'Cancelled' }]);
    await patchStatus(admin.auth, o.id, 'Shipped');
    expect((await patchStatus(customer.auth, o.id, 'Delivered')).status).toBe(403);
    expect((await patchStatus(customer.auth, o.id, 'Cancelled')).status).toBe(409); // not a valid transition at all
  });

  test('a missing order and another customer\'s order give the same 404', async () => {
    const o = await orderOf(await t.makeProduct());
    const theirs = await patchStatus(other.auth, o.id, 'Cancelled');
    const ghost = await patchStatus(other.auth, '665f1c2e9b1d4a0012ab34cd', 'Cancelled');
    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual(ghost.body);
    const getTheirs = await request(app).get(`/api/orders/${o.id}`).set(other.auth);
    const getGhost = await request(app).get('/api/orders/665f1c2e9b1d4a0012ab34cd').set(other.auth);
    expect([getTheirs.status, getGhost.status]).toEqual([404, 404]);
    expect(getTheirs.body).toEqual(getGhost.body);
    expect((await request(app).get(`/api/orders/${o.id}`).set(admin.auth)).status).toBe(200);
  });

  test('cancelling restores stock in the same step; the owner and the admin may cancel', async () => {
    const p = await t.makeProduct({ stock: 10 });
    const o = await orderOf(p, 4);
    expect(await stockOf(p)).toBe(6);
    const res = await patchStatus(customer.auth, o.id, 'Cancelled');
    expect(res.status).toBe(200);
    expect(res.body.data.statusHistory.at(-1)).toMatchObject({ status: 'Cancelled', changedBy: customer.user.id });
    expect(await stockOf(p)).toBe(10);
    const o2 = await orderOf(p, 1);
    expect((await patchStatus(admin.auth, o2.id, 'Cancelled')).status).toBe(200);
    expect(await stockOf(p)).toBe(10);
  });

  test('two simultaneous changes from the same starting status: one wins, the other gets 409', async () => {
    const o = await orderOf(await t.makeProduct());
    const [ship, cancel] = await Promise.all([patchStatus(admin.auth, o.id, 'Shipped'), patchStatus(customer.auth, o.id, 'Cancelled')]);
    expect([ship.status, cancel.status].sort()).toEqual([200, 409]);
    const loser = ship.status === 409 ? ship : cancel;
    expect(loser.body.error.details[0].currentStatus).toMatch(/Shipped|Cancelled/);
  });

  test('racing cancellations restore stock exactly once', async () => {
    const p = await t.makeProduct({ stock: 10 });
    const o = await orderOf(p, 3);
    const results = await Promise.all([1, 2, 3, 4].map((i) => patchStatus(i % 2 ? admin.auth : customer.auth, o.id, 'Cancelled')));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stockOf(p)).toBe(10);
  }, 60000);
});

describe('reading orders', () => {
  beforeAll(async () => {
    await Order.deleteMany({});
    const p = await t.makeProduct({ stock: 1000 });
    const mk = (user, over) =>
      Order.create({
        user: user.user._id, customerName: 'N', customerEmail: `${over.email ?? 'x'}@example.com`,
        items: [{ product: p._id, name: p.name, unitPricePaise: 100, quantity: 1, lineTotalPaise: 100 }], totalPaise: 100,
        status: over.status ?? 'Pending', createdAt: over.createdAt,
      });
    await mk(customer, { email: 'a', createdAt: new Date('2026-10-30T10:00:00Z') });
    await mk(customer, { email: 'a', status: 'Shipped', createdAt: new Date('2026-10-31T18:29:00Z') }); // 31 Oct 23:59 IST
    await mk(other, { email: 'b', status: 'Shipped', createdAt: new Date('2026-10-31T18:31:00Z') }); // 1 Nov 00:01 IST
    await mk(other, { email: 'b', status: 'Delivered', createdAt: new Date('2026-11-02T10:00:00Z') });
  });

  const list = (auth, qs = '') => request(app).get(`/api/orders${qs}`).set(auth);

  test('customers see only their own orders, newest first, with meta', async () => {
    const res = await list(customer.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((o) => o.customerId === customer.user.id)).toBe(true);
    expect(res.body.data[0].createdAt > res.body.data[1].createdAt).toBe(true);
    expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect((await request(app).get('/api/orders')).status).toBe(401);
  });

  test('status filter works; unknown status is 400', async () => {
    expect((await list(admin.auth, '?status=Shipped')).body.data).toHaveLength(2);
    expect((await list(customer.auth, '?status=Shipped')).body.data).toHaveLength(1);
    expect((await list(admin.auth, '?status=Nope')).status).toBe(400);
  });

  test('admin sees everything and can filter by customerEmail and date range (IST days)', async () => {
    expect((await list(admin.auth)).body.meta.total).toBe(4);
    expect((await list(admin.auth, '?customerEmail=B@Example.com')).body.data).toHaveLength(2);
    expect((await list(admin.auth, '?from=2026-10-31&to=2026-10-31')).body.data).toHaveLength(1);
    expect((await list(admin.auth, '?from=2026-11-01&to=2026-11-01')).body.data).toHaveLength(1);
    expect((await list(admin.auth, '?from=2026-10-31T18:30:00Z')).body.data).toHaveLength(2);
    expect((await list(admin.auth, '?from=2026-11-02&to=2026-10-01')).status).toBe(400);
    expect((await list(admin.auth, '?from=yesterday')).status).toBe(400);
    expect((await list(admin.auth, '?customerEmail=a@example.com&status=Shipped')).body.data).toHaveLength(1);
  });

  test('pagination', async () => {
    const p1 = await list(admin.auth, '?limit=3&page=1');
    const p2 = await list(admin.auth, '?limit=3&page=2');
    expect(p1.body.data).toHaveLength(3);
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.meta).toEqual({ page: 2, limit: 3, total: 4, totalPages: 2 });
  });

  test('order detail has customer details, items, history and timestamps', async () => {
    const o = (await list(customer.auth)).body.data[0];
    const res = await request(app).get(`/api/orders/${o.id}`).set(customer.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({ customerName: 'N', status: expect.any(String), statusHistory: expect.any(Array), total: 1, createdAt: expect.any(String), updatedAt: expect.any(String) })
    );
    expect(res.body.data.items[0]).toEqual(expect.objectContaining({ unitPrice: 1, lineTotal: 1, quantity: 1 }));
  });
});

describe('low-stock emails', () => {
  const queued = (p) => EmailJob.countDocuments({ product: p._id, event: 'LOW_STOCK' });
  const order = (p, qty = 1) => place(customer.auth, body([[p, qty]]));

  test('queues one email when stock reaches the threshold and not again until stock recovers', async () => {
    const p = await t.makeProduct({ stock: 7, lowStockThreshold: 5 });
    await order(p); // 6, above
    expect(await queued(p)).toBe(0);
    const crossing = await order(p); // 5, at the threshold
    expect(await queued(p)).toBe(1);
    const job = await EmailJob.findOne({ product: p._id });
    expect(job).toMatchObject({ to: 'admin@example.com', status: 'pending' });
    await order(p); // 4
    await order(p); // 3
    expect(await queued(p)).toBe(1);

    // stock goes back above the threshold (cancelled orders restore it), re-arming the alert
    const orders = await Order.find({ 'items.product': p._id });
    for (const o of orders) await patchStatus(admin.auth, o.id, 'Cancelled');
    expect(await stockOf(p)).toBe(7);
    await order(p, 2); // 5 again
    expect(await queued(p)).toBe(2);
    expect(crossing.status).toBe(201);
  });

  test('simultaneous orders crossing the threshold queue exactly one email', async () => {
    const p = await t.makeProduct({ stock: 10, lowStockThreshold: 5 });
    const results = await Promise.all(Array.from({ length: 8 }, () => order(p)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await stockOf(p)).toBe(2);
    expect(await queued(p)).toBe(1);
  }, 60000);

  test('a failed order queues nothing', async () => {
    const p = await t.makeProduct({ stock: 6, lowStockThreshold: 5 });
    const other = await t.makeProduct({ stock: 0 });
    const res = await place(customer.auth, body([[p, 3], [other, 1]]));
    expect(res.status).toBe(409);
    expect(await queued(p)).toBe(0);
    expect(await stockOf(p)).toBe(6);
  });

  test('an admin raising stock above the threshold re-arms the alert', async () => {
    const p = await t.makeProduct({ stock: 6, lowStockThreshold: 5 });
    await order(p);
    expect(await queued(p)).toBe(1);
    await Product.updateOne({ _id: p.id }, { stock: 2 }); // still alerted: no second email from the order below
    await order(p);
    expect(await queued(p)).toBe(1);
    const patch = await request(app).patch(`/api/products/${p.id}`).set(admin.auth).send({ stock: 50 });
    expect(patch.status).toBe(200);
    await order(p, 46); // 4
    expect(await queued(p)).toBe(2);
  });
});

describe('customer emails (outbox)', () => {
  const jobsFor = (orderId, event) => EmailJob.find({ order: orderId, ...(event && { event }) });

  test('placing an order queues an ORDER_PLACED email with the order id, items, quantities and total', async () => {
    const a = await t.makeProduct({ pricePaise: 49999, name: 'Mouse', stock: 10 });
    const b = await t.makeProduct({ pricePaise: 1050, name: 'Cable', stock: 10 });
    const res = await place(customer.auth, body([[a, 2], [b, 3]], { customerEmail: 'Buyer@Example.com' }));
    const [job] = await jobsFor(res.body.data.id, 'ORDER_PLACED');
    expect(job).toMatchObject({ to: 'buyer@example.com', status: 'pending', attempts: 0 });
    expect(job.text).toContain(res.body.data.id);
    expect(job.text).toContain('Mouse x 2');
    expect(job.text).toContain('Cable x 3');
    expect(job.text).toContain('Total: Rs 1031.48'); // 2 x 499.99 + 3 x 10.50
    expect(job.requestId).toBe(res.headers['x-request-id']);
  });

  test('every status change, including cancellation, queues a STATUS_CHANGED email', async () => {
    const p = await t.makeProduct();
    const o = (await place(customer.auth, body([[p, 1]]))).body.data;
    await patchStatus(admin.auth, o.id, 'Shipped');
    await patchStatus(admin.auth, o.id, 'Delivered');
    const cancelled = (await place(customer.auth, body([[p, 1]]))).body.data;
    await patchStatus(customer.auth, cancelled.id, 'Cancelled');

    const subjects = (await jobsFor(o.id, 'STATUS_CHANGED')).map((j) => j.subject).sort();
    expect(subjects).toEqual([`Order ${o.id} is now Delivered`, `Order ${o.id} is now Shipped`].sort());
    const [cancelJob] = await jobsFor(cancelled.id, 'STATUS_CHANGED');
    expect(cancelJob.text).toContain('from Pending to Cancelled');
    expect(cancelJob.to).toBe('asha@example.com');
  });

  test('rejected changes, failed orders and idempotent replays queue nothing extra', async () => {
    const p = await t.makeProduct({ stock: 1 });
    const key = newKey();
    const first = await place(customer.auth, body([[p, 1]]), key);
    await place(customer.auth, body([[p, 1]]), key); // replay
    expect(await jobsFor(first.body.data.id, 'ORDER_PLACED')).toHaveLength(1);

    await patchStatus(admin.auth, first.body.data.id, 'Delivered'); // invalid transition: 409
    await patchStatus(customer.auth, first.body.data.id, 'Shipped'); // forbidden: 403
    expect(await jobsFor(first.body.data.id, 'STATUS_CHANGED')).toHaveLength(0);

    const before = await EmailJob.countDocuments();
    expect((await place(customer.auth, body([[p, 1]]))).status).toBe(409); // out of stock
    expect(await EmailJob.countDocuments()).toBe(before);
  });
});
