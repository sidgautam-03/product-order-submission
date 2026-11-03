import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

let mongod, app, User, ROLES, startSession, guarded;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URI = mongod.getUri();
  process.env.JWT_SECRET = 'test-secret';
  process.env.LOG_LEVEL = 'silent';
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
  process.env.LOG_DIR = '';
  app = (await import('../src/app.js')).default;
  ({ User, ROLES } = await import('../src/model/User.js'));
  ({ startSession } = await import('../src/services/auth.service.js'));
  const { authenticate, authorize } = await import('../src/middleware/auth.js');
  const { errorHandler } = await import('../src/middleware/errorHandler.js');

  // throwaway app exposing an admin-only route to exercise authorize()
  guarded = express();
  guarded.get('/admin-only', authenticate, authorize(ROLES.ADMIN), (req, res) => res.json({ success: true }));
  guarded.use(errorHandler);
  await mongoose.connect(process.env.MONGO_URI);
  await User.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const creds = { name: 'Asha', email: 'Asha@Example.com', password: 'password123' };

test('register creates a customer and ignores a supplied role', async () => {
  const res = await request(app).post('/api/auth/register').send({ ...creds, role: 'admin' });
  expect(res.status).toBe(201);
  expect(res.body.data.user.role).toBe('customer');
  expect(res.body.data.user.email).toBe('asha@example.com');
  expect(res.body.data.user.passwordHash).toBeUndefined();
  expect(res.body.data.token).toBeTruthy();
});

test('duplicate email is rejected with 409', async () => {
  const res = await request(app).post('/api/auth/register').send(creds);
  expect(res.status).toBe(409);
});

test('invalid input is rejected with 400', async () => {
  const res = await request(app).post('/api/auth/register').send({ name: 'A', email: 'x', password: '1' });
  expect(res.status).toBe(400);
});

test('login succeeds, wrong password and unknown email both 401', async () => {
  const ok = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });
  expect(ok.status).toBe(200);
  const bad = await request(app).post('/api/auth/login').send({ email: creds.email, password: 'wrongpass1' });
  expect(bad.status).toBe(401);
  const unknown = await request(app).post('/api/auth/login').send({ email: 'no@one.com', password: 'password123' });
  expect(unknown.status).toBe(401);
  expect(unknown.body.error.message).toBe(bad.body.error.message);
});

test('/me requires a valid token', async () => {
  expect((await request(app).get('/api/auth/me')).status).toBe(401);
  expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer junk')).status).toBe(401);
  const { body } = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${body.data.token}`);
  expect(me.status).toBe(200);
  expect(me.body.data.user.email).toBe('asha@example.com');
});

test('authorize(ROLES.ADMIN) blocks customers with 403 and lets admins through', async () => {
  const customer = await User.findOne({ email: 'asha@example.com' });
  const admin = await User.create({
    name: 'Boss',
    email: 'admin@example.com',
    passwordHash: 'not-used',
    role: ROLES.ADMIN,
  });

  expect((await request(guarded).get('/admin-only')).status).toBe(401);
  const asCustomer = await request(guarded).get('/admin-only').set('Authorization', `Bearer ${(await startSession(customer)).token}`);
  expect(asCustomer.status).toBe(403);
  const asAdmin = await request(guarded).get('/admin-only').set('Authorization', `Bearer ${(await startSession(admin)).token}`);
  expect(asAdmin.status).toBe(200);
});

test('expired token is rejected with 401 at the route', async () => {
  const user = await User.findOne({ email: 'asha@example.com' });
  const { session } = await startSession(user);
  const expired = jwt.sign({ sub: user.id, role: user.role, sid: session.id }, process.env.JWT_SECRET, { expiresIn: -10 });
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
  expect(res.status).toBe(401);
});

test('valid token for a deleted user is rejected with 401', async () => {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Temp', email: 'temp@example.com', password: 'password123' });
  const { token, user } = reg.body.data;
  await User.deleteOne({ _id: user.id });
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(401);
});
