import request from 'supertest';
import { setup } from './helpers.js';

let t, app, admin, customer, Order, products;

beforeAll(async () => {
  t = await setup();
  app = t.app;
  ({ Order } = t.models);
  admin = await t.makeUser(t.ROLES.ADMIN);
  customer = await t.makeUser();
  products = [];
  for (let i = 0; i < 7; i++) products.push(await t.makeProduct({ name: `Report Product ${i}`, pricePaise: 10000 }));
}, 120000);

afterAll(() => t.teardown());

const mk = (items, status, createdAt) =>
  Order.create({
    user: customer.user._id,
    customerName: 'N',
    customerEmail: 'n@example.com',
    items: items.map(([p, quantity, unit]) => ({ product: p._id, name: p.name, unitPricePaise: unit, quantity, lineTotalPaise: unit * quantity })),
    totalPaise: items.reduce((s, [, q, unit]) => s + q * unit, 0),
    status,
    createdAt: new Date(createdAt),
  });

const report = (qs, auth = admin.auth) => request(app).get(`/api/reports/sales${qs}`).set(auth);

describe('sales report', () => {
  beforeAll(async () => {
    await Order.deleteMany({});
    const [p1, p2] = products;
    await mk([[p1, 2, 10000]], 'Delivered', '2026-10-01T10:00:00Z'); // 1 Oct 15:30 IST, 200.00
    await mk([[p2, 3, 5000]], 'Pending', '2026-10-01T20:00:00Z'); // 2 Oct 01:30 IST, 150.00
    await mk([[p1, 10, 10000]], 'Cancelled', '2026-10-05T05:00:00Z'); // excluded from revenue
    await mk([[p2, 1, 5000]], 'Shipped', '2026-10-31T18:29:00Z'); // 31 Oct 23:59 IST, 50.00
    await mk([[p1, 1, 10000]], 'Pending', '2026-10-31T18:31:00Z'); // 1 Nov IST: outside the range
    await mk([[p1, 1, 10000]], 'Pending', '2026-09-30T18:29:00Z'); // 30 Sep IST: outside the range
  });

  test('totals, per-status counts, daily revenue (IST, zero-filled) and top products', async () => {
    const res = await report('?from=2026-10-01&to=2026-10-31');
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.range).toEqual({ from: '2026-10-01', to: '2026-10-31', timezone: 'Asia/Kolkata' });
    expect(r.totalRevenue).toBe(400);
    expect(r.orderCount).toBe(3);
    expect(r.ordersByStatus).toEqual({ Pending: 1, Shipped: 1, Delivered: 1, Cancelled: 1 });

    expect(r.revenuePerDay).toHaveLength(31);
    const day = Object.fromEntries(r.revenuePerDay.map((d) => [d.date, d]));
    expect(day['2026-10-01']).toEqual({ date: '2026-10-01', revenue: 200, orders: 1 });
    expect(day['2026-10-02']).toEqual({ date: '2026-10-02', revenue: 150, orders: 1 }); // 20:00 UTC is already the 2nd in IST
    expect(day['2026-10-31']).toEqual({ date: '2026-10-31', revenue: 50, orders: 1 });
    expect(day['2026-10-05']).toEqual({ date: '2026-10-05', revenue: 0, orders: 0 }); // cancelled order, no sales
    expect(r.revenuePerDay.reduce((s, d) => s + d.revenue, 0)).toBe(400);

    expect(r.topProducts).toEqual([
      { productId: products[1].id, name: products[1].name, quantitySold: 4, revenue: 200 },
      { productId: products[0].id, name: products[0].name, quantitySold: 2, revenue: 200 },
    ]);
  });

  test('a single day and an empty range return zeros', async () => {
    const one = (await report('?from=2026-11-01&to=2026-11-01')).body.data;
    expect(one.revenuePerDay).toEqual([{ date: '2026-11-01', revenue: 0 + 100, orders: 1 }]);
    const empty = (await report('?from=2025-01-01&to=2025-01-03')).body.data;
    expect(empty).toMatchObject({
      totalRevenue: 0,
      orderCount: 0,
      ordersByStatus: { Pending: 0, Shipped: 0, Delivered: 0, Cancelled: 0 },
      topProducts: [],
    });
    expect(empty.revenuePerDay.map((d) => d.revenue)).toEqual([0, 0, 0]);
  });

  test('top products are the 5 best sellers by quantity', async () => {
    await Order.deleteMany({});
    await mk(products.map((p, i) => [p, i + 1, 100]), 'Pending', '2026-03-10T10:00:00Z');
    const top = (await report('?from=2026-03-01&to=2026-03-31')).body.data.topProducts;
    expect(top.map((p) => p.quantitySold)).toEqual([7, 6, 5, 4, 3]);
    expect(top[0]).toMatchObject({ name: products[6].name, revenue: 7 });
  });

  test('validation: required, valid, ordered, at most 366 days', async () => {
    for (const qs of ['', '?from=2026-10-01', '?to=2026-10-01', '?from=2026-10-05&to=2026-10-01', '?from=2026-02-30&to=2026-03-01', '?from=abc&to=def', '?from=2024-01-01&to=2025-01-01']) {
      const res = await report(qs);
      expect([qs, res.status]).toEqual([qs, 400]);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await report('?from=2024-01-01&to=2024-12-31')).status).toBe(200); // exactly 366 days
  });

  test('admin only', async () => {
    expect((await request(app).get('/api/reports/sales?from=2026-10-01&to=2026-10-31')).status).toBe(401);
    expect((await report('?from=2026-10-01&to=2026-10-31', customer.auth)).status).toBe(403);
  });
});
