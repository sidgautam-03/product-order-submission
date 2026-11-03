import fs from 'node:fs';
import request from 'supertest';
import { JPEG, PNG, WEBP, setup } from './helpers.js';

let t, app, admin, customer;

beforeAll(async () => {
  t = await setup();
  app = t.app;
  admin = await t.makeUser(t.ROLES.ADMIN);
  customer = await t.makeUser();
}, 120000);

afterAll(() => t.teardown());

const fields = { name: 'Wireless Mouse', description: 'Smooth', price: '499.99', category: 'Electronics', stock: '10' };

function createReq(over = {}, files = [[PNG, 'a.png', 'image/png']], auth = admin.auth) {
  let r = request(app).post('/api/products').set(auth);
  for (const [k, v] of Object.entries({ ...fields, ...over })) if (v !== undefined) r = r.field(k, v);
  for (const [buf, filename, contentType] of files) r = r.attach('images', buf, { filename, contentType });
  return r;
}

describe('create', () => {
  test('creates with images, price in rupees, generated file names on disk', async () => {
    const res = await createReq({}, [[PNG, 'evil name.png', 'image/png'], [JPEG, 'b.jpg', 'image/jpeg'], [WEBP, 'c.webp', 'image/webp']]);
    expect(res.status).toBe(201);
    const p = res.body.data;
    expect(p.price).toBe(499.99);
    expect(p.pricePaise).toBeUndefined();
    expect(p.lowStockThreshold).toBe(5);
    expect(p.averageRating).toBe(0);
    expect(p.reviewCount).toBe(0);
    expect(p.images).toHaveLength(3);
    for (const img of p.images) {
      expect(img.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp)$/);
      expect(fs.existsSync(`${t.UPLOADS_DIR}/${img.url.split('/').pop()}`)).toBe(true);
    }
    const served = await request(app).get(p.images[0].url);
    expect(served.status).toBe(200);
  });

  test('401 without token, 403 for a customer', async () => {
    expect((await request(app).post('/api/products')).status).toBe(401);
    expect((await createReq({}, undefined, customer.auth)).status).toBe(403);
  });

  test('field validation returns details', async () => {
    const res = await createReq({ price: '1.234', stock: '-1', name: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path).sort()).toEqual(['name', 'price', 'stock']);
    expect((await createReq({ price: '0' })).status).toBe(400);
  });

  test('rejects missing, fake, svg, oversized and too many images; nothing is left on disk', async () => {
    const before = t.uploadFiles().length;
    expect((await createReq({ name: 'No Img' }, [])).status).toBe(400);
    const fake = await createReq({ name: 'Fake' }, [[Buffer.from('just some text'), 'x.jpg', 'image/jpeg']]);
    expect(fake.status).toBe(400);
    expect(fake.body.error.message).toMatch(/valid image/i);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await createReq({ name: 'Svg' }, [[svg, 'x.svg', 'image/svg+xml']])).status).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const tooBig = await createReq({ name: 'Big' }, [[big, 'big.png', 'image/png']]);
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.message).toMatch(/2 MB/);
    const six = Array.from({ length: 6 }, (_, i) => [PNG, `${i}.png`, 'image/png']);
    expect((await createReq({ name: 'Six' }, six)).status).toBe(400);
    // one bad file among good ones: the good ones must not be kept
    const mixed = await createReq({ name: 'Mixed' }, [[PNG, 'ok.png', 'image/png'], [Buffer.from('nope'), 'bad.png', 'image/png']]);
    expect(mixed.status).toBe(400);
    expect(t.uploadFiles().length).toBe(before);
  });

  test('duplicate name (case-insensitive) is 409 and its files are cleaned up', async () => {
    const before = t.uploadFiles().length;
    const res = await createReq({ name: 'wireless MOUSE' });
    expect(res.status).toBe(409);
    expect(t.uploadFiles().length).toBe(before);
  });
});

describe('update and archive', () => {
  let product;
  beforeAll(async () => {
    const res = await createReq({ name: 'Patch Me' }, [[PNG, '1.png', 'image/png'], [JPEG, '2.jpg', 'image/jpeg']]);
    product = res.body.data;
  });

  const patch = (id, over = {}, files = [], auth = admin.auth) => {
    let r = request(app).patch(`/api/products/${id}`).set(auth);
    for (const [k, v] of Object.entries(over)) r = r.field(k, v);
    for (const [buf, filename, contentType] of files) r = r.attach('images', buf, { filename, contentType });
    return r;
  };

  test('partial update of fields', async () => {
    const res = await patch(product.id, { price: '10.50', stock: '3' });
    expect(res.status).toBe(200);
    expect(res.body.data.price).toBe(10.5);
    expect(res.body.data.stock).toBe(3);
    expect(res.body.data.name).toBe('Patch Me');
  });

  test('JSON body works without files; empty update is 400; customer is 403', async () => {
    const ok = await request(app).patch(`/api/products/${product.id}`).set(admin.auth).send({ description: 'New text' });
    expect(ok.status).toBe(200);
    expect((await request(app).patch(`/api/products/${product.id}`).set(admin.auth).send({})).status).toBe(400);
    expect((await patch(product.id, { stock: '1' }, [], customer.auth)).status).toBe(403);
  });

  test('add and remove images together, removed file leaves disk', async () => {
    const current = (await request(app).get(`/api/products/${product.id}`)).body.data;
    const removeId = current.images[0].id;
    const removedFile = `${t.UPLOADS_DIR}/${current.images[0].url.split('/').pop()}`;
    expect(fs.existsSync(removedFile)).toBe(true);
    const res = await patch(product.id, { removeImageIds: removeId }, [[WEBP, 'n.webp', 'image/webp']]);
    expect(res.status).toBe(200);
    expect(res.body.data.images).toHaveLength(2);
    expect(res.body.data.images.map((i) => i.id)).not.toContain(removeId);
    expect(fs.existsSync(removedFile)).toBe(false);
  });

  test('image count must stay between 1 and 5; unknown ids rejected', async () => {
    const current = (await request(app).get(`/api/products/${product.id}`)).body.data;
    const ids = current.images.map((i) => i.id).join(',');
    expect((await patch(product.id, { removeImageIds: ids })).status).toBe(400);
    expect((await patch(product.id, { removeImageIds: '665f1c2e9b1d4a0012ab34cd' })).status).toBe(400);
    const four = Array.from({ length: 4 }, (_, i) => [PNG, `${i}.png`, 'image/png']);
    const before = t.uploadFiles().length;
    expect((await patch(product.id, {}, four)).status).toBe(400);
    expect(t.uploadFiles().length).toBe(before);
    expect((await patch('665f1c2e9b1d4a0012ab34cd', { stock: '1' })).status).toBe(404);
  });

  test('renaming onto an existing name is 409 and cleans up new files', async () => {
    const before = t.uploadFiles().length;
    const res = await patch(product.id, { name: 'WIRELESS mouse' }, [[PNG, 'x.png', 'image/png']]);
    expect(res.status).toBe(409);
    expect(t.uploadFiles().length).toBe(before);
  });

  test('archive hides the product, admin can still see it, name becomes reusable', async () => {
    const created = (await createReq({ name: 'To Archive' })).body.data;
    expect((await request(app).delete(`/api/products/${created.id}`).set(customer.auth)).status).toBe(403);
    const del = await request(app).delete(`/api/products/${created.id}`).set(admin.auth);
    expect(del.status).toBe(200);
    expect(del.body.data.isArchived).toBe(true);

    expect((await request(app).get(`/api/products/${created.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/products/${created.id}`).set(admin.auth)).status).toBe(200);
    const list = await request(app).get('/api/products?q=Archive&limit=50');
    expect(list.body.data.map((p) => p.id)).not.toContain(created.id);
    const adminList = await request(app).get('/api/products?q=Archive&includeArchived=true').set(admin.auth);
    expect(adminList.body.data.map((p) => p.id)).toContain(created.id);
    const asCustomer = await request(app).get('/api/products?q=Archive&includeArchived=true').set(customer.auth);
    expect(asCustomer.body.data.map((p) => p.id)).not.toContain(created.id);

    expect((await request(app).delete(`/api/products/${created.id}`).set(admin.auth)).status).toBe(404);
    expect((await createReq({ name: 'to archive' })).status).toBe(201);
  });
});

describe('listing', () => {
  beforeAll(async () => {
    await t.models.Product.deleteMany({});
    const rows = [
      { name: 'Wireless Keyboard', category: 'Electronics', pricePaise: 150000, averageRating: 4.5, reviewCount: 2 },
      { name: 'Wireless Earbuds', category: 'ELECTRONICS', pricePaise: 300000, averageRating: 3.5, reviewCount: 2 },
      { name: 'Desk Lamp', category: 'Home', pricePaise: 150000, averageRating: 4.1, reviewCount: 1, description: 'Wireless charging base' },
      { name: 'Notebook', category: 'Stationery', pricePaise: 5000 },
      { name: 'Pen', category: 'Stationery', pricePaise: 5000 },
      { name: 'Stapler', category: 'Stationery', pricePaise: 5000 },
    ];
    for (const r of rows) await t.makeProduct(r);
  });

  const names = (res) => res.body.data.map((p) => p.name);

  test('search covers name and description', async () => {
    const res = await request(app).get('/api/products?q=wireless');
    expect(res.status).toBe(200);
    expect(names(res).sort()).toEqual(['Desk Lamp', 'Wireless Earbuds', 'Wireless Keyboard']);
  });

  test('category is case-insensitive and filters combine', async () => {
    expect(names(await request(app).get('/api/products?category=electronics')).sort()).toEqual(['Wireless Earbuds', 'Wireless Keyboard']);
    const combo = await request(app).get('/api/products?category=electronics&minPrice=1000&maxPrice=2000&minRating=4');
    expect(names(combo)).toEqual(['Wireless Keyboard']);
    expect(names(await request(app).get('/api/products?q=wireless&minRating=4')).sort()).toEqual(['Desk Lamp', 'Wireless Keyboard']);
  });

  test('price bounds are inclusive and decimals work', async () => {
    expect(names(await request(app).get('/api/products?minPrice=50&maxPrice=50.00')).sort()).toEqual(['Notebook', 'Pen', 'Stapler']);
  });

  test('sorting, with ties broken by _id', async () => {
    expect(names(await request(app).get('/api/products?sort=price_desc')).slice(0, 1)).toEqual(['Wireless Earbuds']);
    const asc = await request(app).get('/api/products?sort=price_asc');
    expect(asc.body.data.map((p) => p.price)).toEqual([50, 50, 50, 1500, 1500, 3000]);
    const ratings = (await request(app).get('/api/products?sort=rating_desc')).body.data.map((p) => p.averageRating);
    expect(ratings.slice(0, 3)).toEqual([4.5, 4.1, 3.5]);
    const newest = await request(app).get('/api/products');
    expect(names(newest)[0]).toBe('Stapler');
  });

  test('pagination covers every item exactly once, meta is correct', async () => {
    const seen = [];
    for (const page of [1, 2, 3]) {
      const res = await request(app).get(`/api/products?sort=price_asc&limit=2&page=${page}`);
      expect(res.body.meta).toEqual({ page, limit: 2, total: 6, totalPages: 3 });
      seen.push(...res.body.data.map((p) => p.id));
    }
    expect(new Set(seen).size).toBe(6);
    expect((await request(app).get('/api/products?page=9')).body.data).toEqual([]);
    expect((await request(app).get('/api/products')).body.meta.limit).toBe(10);
    expect((await request(app).get('/api/products?limit=500')).body.meta.limit).toBe(50);
  });

  test('invalid query values are 400', async () => {
    for (const q of ['sort=bogus', 'minPrice=500&maxPrice=100', 'minPrice=abc', 'minRating=9', 'page=0', 'limit=-1', 'page=x']) {
      const res = await request(app).get(`/api/products?${q}`);
      expect([q, res.status]).toEqual([q, 400]);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('invalid ObjectIds are 400 not 500', async () => {
    expect((await request(app).get('/api/products/not-an-id')).status).toBe(400);
    expect((await request(app).get('/api/products/not-an-id/reviews')).status).toBe(400);
    expect((await request(app).patch('/api/products/123').set(admin.auth).send({ stock: 1 })).status).toBe(400);
    expect((await request(app).get('/api/products/665f1c2e9b1d4a0012ab34cd')).status).toBe(404);
  });

  test('every response carries X-Request-Id', async () => {
    const res = await request(app).get('/api/products').set('X-Request-Id', 'trace-me-1');
    expect(res.headers['x-request-id']).toBe('trace-me-1');
    expect((await request(app).get('/api/products')).headers['x-request-id']).toBeTruthy();
  });
});
