import crypto from 'node:crypto';
import request from 'supertest';
import { setup } from './helpers.js';

let t, app, User;

beforeAll(async () => {
  t = await setup({ authLimit: 5 });
  app = t.app;
  ({ User } = t.models);
}, 120000);

afterAll(() => t.teardown());

describe('rate limiting (5 per 15 minutes per IP)', () => {
  test('login: the 6th request is 429 with Retry-After; register is counted separately', async () => {
    const attempt = () => request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever1' });
    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['x-request-id']).toBeTruthy();

    const register = (i) => request(app).post('/api/auth/register').send({ name: 'Rate Test', email: `rate${i}@example.com`, password: 'password1' });
    for (let i = 0; i < 5; i++) expect((await register(i)).status).toBe(201);
    const registerLimited = await register(99);
    expect(registerLimited.status).toBe(429);
    expect(registerLimited.headers['retry-after']).toBeTruthy();
  });

  test('other routes are not rate limited', async () => {
    for (let i = 0; i < 8; i++) expect((await request(app).get('/api/products')).status).toBe(200);
  });
});

describe('registration', () => {
  // the register limiter is exhausted by now, so these call the validator through a fresh app instance
  test('password needs 8+ characters with a letter and a number', async () => {
    const { registerSchema } = await import('../src/validators/auth.validator.js');
    const check = (password) => registerSchema.safeParse({ name: 'Asha', email: 'a@example.com', password });
    expect(check('abcdefg1').success).toBe(true);
    expect(check('abc1').success).toBe(false); // too short
    expect(check('abcdefgh').success).toBe(false); // no number
    expect(check('12345678').success).toBe(false); // no letter
    const messages = check('abcdefgh').error.issues.map((i) => i.message);
    expect(messages).toContain('Password must contain at least one number');
  });

  test('email is unique ignoring case, and the response never includes the password or hash', async () => {
    await User.create({ name: 'Existing', email: 'case@example.com', passwordHash: 'x' });
    await expect(User.create({ name: 'Dup', email: 'CASE@Example.com', passwordHash: 'x' })).rejects.toThrow(/duplicate key/);
    const user = await User.findOne({ email: 'case@example.com' }).select('+passwordHash');
    const json = JSON.stringify(user);
    expect(json).not.toMatch(/passwordHash|password/i);
  });
});

describe('MongoDB operator injection', () => {
  test('operators in bodies are blocked with 400', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(login.status).toBe(400);
    expect(login.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('nested operators and dotted keys in any JSON body are blocked', async () => {
    const admin = await t.makeUser(t.ROLES.ADMIN);
    const key = crypto.randomUUID();
    const nested = await request(app).post('/api/orders').set(admin.auth).set('Idempotency-Key', key).send({ items: [{ productId: { $ne: null } }] });
    expect(nested.status).toBe(400);
    expect(nested.body.error.details[0].message).toMatch(/Field names/);
    const dotted = await request(app).patch('/api/products/665f1c2e9b1d4a0012ab34cd').set(admin.auth).send({ 'a.b': 1 });
    expect(dotted.status).toBe(400);
  });

  test('operators in query strings are blocked with 400', async () => {
    for (const qs of ['?category[$ne]=x', '?$where=1', '?q[$regex]=.*']) {
      const res = await request(app).get(`/api/products${qs}`);
      expect([qs, res.status]).toEqual([qs, 400]);
    }
    expect((await request(app).get('/api/products?category=gadgets')).status).toBe(200);
  });
});

describe('security headers and CORS', () => {
  test('helmet headers are present and CORS allows CLIENT_URL', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-expose-headers']).toMatch(/X-Request-Id/);
  });
});
