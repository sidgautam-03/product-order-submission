import request from 'supertest';
import { setup } from './helpers.js';

let t, app, admin, customer, User;

beforeAll(async () => {
  t = await setup();
  app = t.app;
  ({ User } = t.models);
  admin = await t.makeUser(t.ROLES.ADMIN, 'Main Admin');
  customer = await t.makeUser(t.ROLES.CUSTOMER, 'Plain Customer');
}, 120000);

afterAll(() => t.teardown());

const create = (body, auth = admin.auth) => request(app).post('/api/admin/users').set(auth).send(body);
const patch = (id, body, auth = admin.auth) => request(app).patch(`/api/admin/users/${id}`).set(auth).send(body);
const list = (qs = '', auth = admin.auth) => request(app).get(`/api/admin/users${qs}`).set(auth);

test('all user-management routes are admin only', async () => {
  expect((await request(app).get('/api/admin/users')).status).toBe(401);
  expect((await list('', customer.auth)).status).toBe(403);
  expect((await create({ name: 'X Y', email: 'x@example.com', password: 'Passw0rd123' }, customer.auth)).status).toBe(403);
  expect((await patch(customer.user.id, { role: 'admin' }, customer.auth)).status).toBe(403);
});

test('create user: role defaults to customer, admins can be created, email counts as verified, no password in the response', async () => {
  const c = await create({ name: 'New Customer', email: 'newc@example.com', password: 'Passw0rd123' });
  expect(c.status).toBe(201);
  expect(c.body.data).toMatchObject({ role: 'customer', emailVerified: true, isActive: true });
  expect(JSON.stringify(c.body)).not.toMatch(/password/i);

  const a = await create({ name: 'Second Admin', email: 'admin2@example.com', password: 'Passw0rd123', role: 'admin' });
  expect(a.status).toBe(201);
  expect(a.body.data.role).toBe('admin');
  const login = await request(app).post('/api/auth/login').send({ email: 'admin2@example.com', password: 'Passw0rd123' });
  expect(login.status).toBe(200);
  expect(login.body.data.user.role).toBe('admin');
});

test('create user validation: duplicate email, weak password, bad role, bad email', async () => {
  expect((await create({ name: 'Dup', email: 'NEWC@example.com', password: 'Passw0rd123' })).status).toBe(409);
  expect((await create({ name: 'Weak', email: 'weak@example.com', password: 'password' })).status).toBe(400);
  expect((await create({ name: 'Role', email: 'role@example.com', password: 'Passw0rd123', role: 'superuser' })).status).toBe(400);
  expect((await create({ name: 'Mail', email: 'nope', password: 'Passw0rd123' })).status).toBe(400);
  expect((await create({})).status).toBe(400);
});

test('list users with filters, search and pagination', async () => {
  const all = await list();
  expect(all.status).toBe(200);
  expect(all.body.meta.total).toBeGreaterThanOrEqual(4);
  expect(all.body.data.every((u) => u.passwordHash === undefined && u.lockUntil === undefined)).toBe(true);
  expect((await list('?role=admin')).body.data.every((u) => u.role === 'admin')).toBe(true);
  expect((await list('?q=newc')).body.data.map((u) => u.email)).toEqual(['newc@example.com']);
  expect((await list('?q=PLAIN%20customer')).body.data).toHaveLength(1);
  expect((await list('?q=a.b')).body.data).toHaveLength(0); // "." is literal, not a wildcard
  expect((await list('?limit=2&page=1')).body.data).toHaveLength(2);
  expect((await list('?role=boss')).status).toBe(400);
  expect((await list('?isActive=maybe')).status).toBe(400);
});

test('the isActive filter treats legacy documents without the field as active', async () => {
  await User.collection.insertOne({ name: 'Old Timer', email: 'oldtimer@example.com', role: 'customer', passwordHash: 'x', createdAt: new Date(), updatedAt: new Date() });
  expect((await list('?isActive=true&q=oldtimer')).body.data).toHaveLength(1);
  expect((await list('?isActive=false&q=oldtimer')).body.data).toHaveLength(0);
});

test('change a role: effective immediately, because the role is read on every request', async () => {
  const user = await t.makeUser();
  expect((await request(app).get('/api/admin/users').set(user.auth)).status).toBe(403);
  const res = await patch(user.user.id, { role: 'admin' });
  expect(res.status).toBe(200);
  expect(res.body.data.role).toBe('admin');
  expect((await request(app).get('/api/admin/users').set(user.auth)).status).toBe(200); // same token, new power
  await patch(user.user.id, { role: 'customer' });
  expect((await request(app).get('/api/admin/users').set(user.auth)).status).toBe(403);
});

test('deactivate signs the user out everywhere and blocks login; reactivating restores it', async () => {
  const reg = (await request(app).post('/api/auth/register').send({ name: 'To Disable', email: 'disable@example.com', password: 'Passw0rd123' })).body.data;
  const res = await patch(reg.user.id, { isActive: false });
  expect(res.status).toBe(200);
  expect(res.body.data.isActive).toBe(false);
  expect((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${reg.token}` })).status).toBe(401);
  expect((await request(app).post('/api/auth/refresh').send({ refreshToken: reg.refreshToken })).status).toBe(401);
  expect((await request(app).post('/api/auth/login').send({ email: 'disable@example.com', password: 'Passw0rd123' })).status).toBe(401);

  await patch(reg.user.id, { isActive: true });
  expect((await request(app).post('/api/auth/login').send({ email: 'disable@example.com', password: 'Passw0rd123' })).status).toBe(200);
});

test('an admin cannot demote or deactivate themselves', async () => {
  expect((await patch(admin.user.id, { role: 'customer' })).status).toBe(409);
  expect((await patch(admin.user.id, { isActive: false })).status).toBe(409);
  expect((await patch(admin.user.id, { role: 'admin' })).status).toBe(200); // a no-op change is fine
  expect((await User.findById(admin.user.id)).role).toBe('admin');
});

test('patch validation: empty body, bad values, bad and unknown ids', async () => {
  expect((await patch(customer.user.id, {})).status).toBe(400);
  expect((await patch(customer.user.id, { role: 'boss' })).status).toBe(400);
  expect((await patch(customer.user.id, { isActive: 'no' })).status).toBe(400);
  expect((await patch('abc', { role: 'admin' })).status).toBe(400);
  expect((await patch('665f1c2e9b1d4a0012ab34cd', { role: 'admin' })).status).toBe(404);
});
