import crypto from 'node:crypto';
import request from 'supertest';
import { setup } from './helpers.js';

// the flag is read when the app is imported, so it must be set before setup()
const previous = process.env.REQUIRE_EMAIL_VERIFICATION;
process.env.REQUIRE_EMAIL_VERIFICATION = 'true';

let t, app, User;

beforeAll(async () => {
  t = await setup();
  app = t.app;
  ({ User } = t.models);
}, 120000);

afterAll(async () => {
  if (previous === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
  else process.env.REQUIRE_EMAIL_VERIFICATION = previous;
  await t.teardown();
});

test('with REQUIRE_EMAIL_VERIFICATION=true an unverified customer cannot place orders until they verify', async () => {
  const product = await t.makeProduct();
  const customer = await t.makeUser();
  const order = () =>
    request(app)
      .post('/api/orders')
      .set(customer.auth)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ customerName: 'Asha', customerEmail: 'asha@example.com', items: [{ productId: product.id, quantity: 1 }] });

  const blocked = await order();
  expect(blocked.status).toBe(403);
  expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');

  await User.updateOne({ _id: customer.user.id }, { emailVerified: true });
  expect((await order()).status).toBe(201);
});
