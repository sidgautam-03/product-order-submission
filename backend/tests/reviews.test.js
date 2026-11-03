import request from 'supertest';
import { setup } from './helpers.js';

let t, app, admin;

beforeAll(async () => {
  t = await setup();
  app = t.app;
  admin = await t.makeUser(t.ROLES.ADMIN);
}, 120000);

afterAll(() => t.teardown());

const post = (productId, auth, body) => request(app).post(`/api/products/${productId}/reviews`).set(auth).send(body);
const productOf = async (id) => (await request(app).get(`/api/products/${id}`)).body.data;

test('only a customer with a Delivered order containing the product can review', async () => {
  const product = await t.makeProduct();
  const other = await t.makeProduct();
  const buyer = await t.makeUser(t.ROLES.CUSTOMER, 'Real Name');
  const stranger = await t.makeUser();

  expect((await request(app).post(`/api/products/${product.id}/reviews`).send({ rating: 5 })).status).toBe(401);
  expect((await post(product.id, admin.auth, { rating: 5 })).status).toBe(403);
  expect((await post(product.id, stranger.auth, { rating: 5 })).status).toBe(403);

  await t.deliveredOrderFor(buyer.user, other);
  expect((await post(product.id, buyer.auth, { rating: 5 })).status).toBe(403); // delivered, but a different product

  await t.deliveredOrderFor(buyer.user, product);
  const res = await post(product.id, buyer.auth, { rating: 4, comment: 'Good', reviewerName: 'Hacker' });
  expect(res.status).toBe(201);
  expect(res.body.data.reviewerName).toBe('Real Name');
  expect(res.body.data.user).toBeUndefined();
});

test('a non-delivered order does not qualify', async () => {
  const product = await t.makeProduct();
  const buyer = await t.makeUser();
  const order = await t.deliveredOrderFor(buyer.user, product);
  await t.models.Order.updateOne({ _id: order._id }, { status: 'Shipped' });
  expect((await post(product.id, buyer.auth, { rating: 5 })).status).toBe(403);
});

test('second review by the same customer is 409; invalid input is 400; unknown product is 404', async () => {
  const product = await t.makeProduct();
  const buyer = await t.makeUser();
  await t.deliveredOrderFor(buyer.user, product);
  expect((await post(product.id, buyer.auth, { rating: 0 })).status).toBe(400);
  expect((await post(product.id, buyer.auth, { rating: 3.5 })).status).toBe(400);
  expect((await post(product.id, buyer.auth, { rating: 5, comment: 'x'.repeat(501) })).status).toBe(400);
  expect((await post(product.id, buyer.auth, { rating: 5 })).status).toBe(201);
  const dup = await post(product.id, buyer.auth, { rating: 1 });
  expect(dup.status).toBe(409);
  expect((await productOf(product.id)).reviewCount).toBe(1);
  expect((await post('665f1c2e9b1d4a0012ab34cd', buyer.auth, { rating: 5 })).status).toBe(404);
});

test('average is rounded half-up to one decimal and 0 with no reviews', async () => {
  const product = await t.makeProduct();
  expect((await productOf(product.id)).averageRating).toBe(0);
  const expected = [[5, 5], [4, 4.5], [4, 4.3], [4, 4.3], [5, 4.4]]; // after each review: sum/count rounded
  for (const [rating, avg] of expected) {
    const buyer = await t.makeUser();
    await t.deliveredOrderFor(buyer.user, product);
    expect((await post(product.id, buyer.auth, { rating })).status).toBe(201);
    expect((await productOf(product.id)).averageRating).toBe(avg);
  }
  // 5,4,4,4,5 = 22/5 = 4.4; add a 4 -> 26/6 = 4.333 -> 4.3 ; then 5 -> 31/7 = 4.428 -> 4.4
  expect((await productOf(product.id)).reviewCount).toBe(5);
});

test('20 simultaneous reviews leave count and average exactly right', async () => {
  const product = await t.makeProduct();
  const ratings = Array.from({ length: 20 }, (_, i) => (i % 5) + 1); // sum 60, avg 3
  const buyers = await Promise.all(ratings.map(() => t.makeUser()));
  await Promise.all(buyers.map((b) => t.deliveredOrderFor(b.user, product)));
  const results = await Promise.all(buyers.map((b, i) => post(product.id, b.auth, { rating: ratings[i] })));
  expect(results.every((r) => r.status === 201)).toBe(true);
  const p = await productOf(product.id);
  expect(p.reviewCount).toBe(20);
  expect(p.averageRating).toBe(3);
});

test('product detail shows the 5 latest reviews; reviews list is paginated newest first', async () => {
  const product = await t.makeProduct();
  for (let i = 1; i <= 7; i++) {
    const buyer = await t.makeUser(t.ROLES.CUSTOMER, `Reviewer ${i}`);
    await t.deliveredOrderFor(buyer.user, product);
    await post(product.id, buyer.auth, { rating: 5, comment: `c${i}` });
  }
  const detail = await productOf(product.id);
  expect(detail.latestReviews.map((r) => r.comment)).toEqual(['c7', 'c6', 'c5', 'c4', 'c3']);

  const page1 = await request(app).get(`/api/products/${product.id}/reviews?limit=3&page=1`);
  expect(page1.body.data.map((r) => r.comment)).toEqual(['c7', 'c6', 'c5']);
  expect(page1.body.meta).toEqual({ page: 1, limit: 3, total: 7, totalPages: 3 });
  const page3 = await request(app).get(`/api/products/${product.id}/reviews?limit=3&page=3`);
  expect(page3.body.data.map((r) => r.comment)).toEqual(['c1']);
  expect((await request(app).get(`/api/products/${product.id}/reviews?limit=0`)).status).toBe(400);
});
