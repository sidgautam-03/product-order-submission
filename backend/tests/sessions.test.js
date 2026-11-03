import request from 'supertest';
import { setup } from './helpers.js';

let t, app, User, Session;

beforeAll(async () => {
  t = await setup();
  app = t.app;
  ({ User } = t.models);
  ({ Session } = await import('../src/model/Session.js'));
}, 120000);

afterAll(() => t.teardown());

let n = 0;
const register = async () => {
  const email = `session${++n}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ name: 'Session User', email, password: 'Passw0rd123' });
  return { email, ...res.body.data };
};
const login = async (email) =>
  (await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd123' })).body.data;
const me = (token) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
const refresh = (refreshToken) => request(app).post('/api/auth/refresh').send({ refreshToken });
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

test('register and login return an access token and a refresh token that work', async () => {
  const reg = await register();
  expect(reg.token).toBeTruthy();
  expect(reg.refreshToken).toMatch(/^[\w-]{40,}$/);
  expect(reg.user.emailVerified).toBe(false);
  expect((await me(reg.token)).status).toBe(200);
  const second = await login(reg.email);
  expect(second.refreshToken).not.toBe(reg.refreshToken); // every login is its own session
  expect(await Session.countDocuments({ user: reg.user.id })).toBe(2);
});

test('refresh returns new tokens, and the old refresh token cannot be used again', async () => {
  const reg = await register();
  const res = await refresh(reg.refreshToken);
  expect(res.status).toBe(200);
  expect(res.body.data.refreshToken).not.toBe(reg.refreshToken);
  expect(res.body.data.user.email).toBe(reg.email);
  expect((await me(res.body.data.token)).status).toBe(200);
  expect((await me(reg.token)).status).toBe(200); // same session, so the first access token still lives until it expires

  // the stored value is a hash, never the token itself
  const stored = await Session.findOne({ user: reg.user.id });
  expect(JSON.stringify(stored)).not.toContain(res.body.data.refreshToken);
});

test('reusing a rotated refresh token revokes the whole session (theft detection)', async () => {
  const reg = await register();
  const rotated = (await refresh(reg.refreshToken)).body.data;
  const replay = await refresh(reg.refreshToken); // the old token shows up again
  expect(replay.status).toBe(401);
  expect((await refresh(rotated.refreshToken)).status).toBe(401); // the legitimate holder is cut off too
  expect((await me(rotated.token)).status).toBe(401);
});

test('two simultaneous refreshes with the same token: one wins, the other is rejected', async () => {
  const reg = await register();
  const results = await Promise.all([refresh(reg.refreshToken), refresh(reg.refreshToken)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
});

test('invalid, missing, expired and revoked refresh tokens are rejected', async () => {
  expect((await refresh('garbage-token')).status).toBe(401);
  expect((await request(app).post('/api/auth/refresh').send({})).status).toBe(400);
  const reg = await register();
  await Session.updateOne({ user: reg.user.id }, { expiresAt: new Date(Date.now() - 1000) });
  expect((await refresh(reg.refreshToken)).status).toBe(401);
  expect((await me(reg.token)).status).toBe(401); // an expired session also invalidates its access token
});

test('logout revokes that session at once; other sessions keep working', async () => {
  const first = await register();
  const second = await login(first.email);
  const out = await request(app).post('/api/auth/logout').set(bearer(first.token));
  expect(out.status).toBe(200);
  expect((await me(first.token)).status).toBe(401);
  expect((await refresh(first.refreshToken)).status).toBe(401);
  expect((await me(second.token)).status).toBe(200);
  expect((await request(app).post('/api/auth/logout')).status).toBe(401);
});

test('logout-all signs out every device', async () => {
  const first = await register();
  const second = await login(first.email);
  expect((await request(app).post('/api/auth/logout-all').set(bearer(first.token))).status).toBe(200);
  for (const s of [first, second]) {
    expect((await me(s.token)).status).toBe(401);
    expect((await refresh(s.refreshToken)).status).toBe(401);
  }
  const fresh = await login(first.email);
  expect((await me(fresh.token)).status).toBe(200); // logging in again works
});

test('a disabled user is cut off: access token, refresh token and login all fail', async () => {
  const reg = await register();
  await User.updateOne({ _id: reg.user.id }, { isActive: false });
  expect((await me(reg.token)).status).toBe(401);
  expect((await refresh(reg.refreshToken)).status).toBe(401);
  const res = await request(app).post('/api/auth/login').send({ email: reg.email, password: 'Passw0rd123' });
  expect(res.status).toBe(401);
  expect(res.body.error.message).toBe('Invalid email or password'); // does not reveal the account is disabled
});

test('tokens without a session id (or with a forged one) are rejected', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const reg = await register();
  const noSid = jwt.sign({ sub: reg.user.id, role: 'customer' }, process.env.JWT_SECRET);
  const forgedSid = jwt.sign({ sub: reg.user.id, role: 'customer', sid: '665f1c2e9b1d4a0012ab34cd' }, process.env.JWT_SECRET);
  const wrongAlg = jwt.sign({ sub: reg.user.id, role: 'customer', sid: 'x' }, 'other-secret');
  for (const token of [noSid, forgedSid, wrongAlg]) expect((await me(token)).status).toBe(401);
});
