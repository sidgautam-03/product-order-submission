import request from 'supertest';
import { setup } from './helpers.js';

let t, app, User, EmailJob, AuthToken;

beforeAll(async () => {
  t = await setup();
  app = t.app;
  ({ User, EmailJob } = t.models);
  ({ AuthToken } = await import('../src/model/AuthToken.js'));
}, 120000);

afterAll(() => t.teardown());

let n = 0;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const register = async () => {
  const email = `acct${++n}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ name: 'Account User', email, password: 'Passw0rd123' });
  return { email, ...res.body.data };
};
const login = (email, password = 'Passw0rd123') => request(app).post('/api/auth/login').send({ email, password });
const me = (token) => request(app).get('/api/auth/me').set(bearer(token));
const tokenFromEmail = async (event, to) => {
  const jobs = await EmailJob.find({ event, to }).sort({ createdAt: -1, _id: -1 });
  return jobs[0]?.text.match(/token=([\w-]+)/)?.[1];
};

describe('change password', () => {
  test('rejects a wrong current password, the same password and a weak one; needs a token', async () => {
    const reg = await register();
    const change = (body, token = reg.token) => request(app).post('/api/auth/change-password').set(bearer(token)).send(body);
    const wrong = await change({ currentPassword: 'Wrong1234', newPassword: 'NewPassw0rd1' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].path).toBe('currentPassword');
    expect((await change({ currentPassword: 'Passw0rd123', newPassword: 'Passw0rd123' })).status).toBe(400);
    expect((await change({ currentPassword: 'Passw0rd123', newPassword: 'short1' })).status).toBe(400);
    expect((await change({ currentPassword: 'Passw0rd123', newPassword: 'onlyletters' })).status).toBe(400);
    expect((await request(app).post('/api/auth/change-password').send({})).status).toBe(401);
    expect((await login(reg.email)).status).toBe(200); // nothing changed
  });

  test('changes the password, keeps this device signed in and signs the others out', async () => {
    const reg = await register();
    const other = (await login(reg.email)).body.data;
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(reg.token))
      .send({ currentPassword: 'Passw0rd123', newPassword: 'NewPassw0rd1' });
    expect(res.status).toBe(200);
    expect((await me(reg.token)).status).toBe(200);
    expect((await me(other.token)).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: other.refreshToken })).status).toBe(401);
    expect((await login(reg.email)).status).toBe(401);
    expect((await login(reg.email, 'NewPassw0rd1')).status).toBe(200);
  });
});

describe('forgot and reset password', () => {
  test('the response is identical for known and unknown emails, and only a real account gets an email', async () => {
    const reg = await register();
    const known = await request(app).post('/api/auth/forgot-password').send({ email: reg.email });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect([known.status, unknown.status]).toEqual([200, 200]);
    expect(known.body).toEqual(unknown.body);
    expect(await EmailJob.countDocuments({ event: 'PASSWORD_RESET', to: reg.email })).toBe(1);
    expect(await EmailJob.countDocuments({ event: 'PASSWORD_RESET', to: 'nobody@example.com' })).toBe(0);
    expect((await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' })).status).toBe(400);
  });

  test('the token resets the password once, signs out every device, and the new password works', async () => {
    const reg = await register();
    const other = (await login(reg.email)).body.data;
    await request(app).post('/api/auth/forgot-password').send({ email: reg.email });
    const token = await tokenFromEmail('PASSWORD_RESET', reg.email);
    expect(token).toBeTruthy();
    expect(await AuthToken.countDocuments({ tokenHash: token })).toBe(0); // only a hash is stored

    const weak = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'weak' });
    expect(weak.status).toBe(400); // rejected before the token is consumed

    const ok = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'ResetPassw0rd1' });
    expect(ok.status).toBe(200);
    expect((await login(reg.email)).status).toBe(401);
    expect((await login(reg.email, 'ResetPassw0rd1')).status).toBe(200);
    for (const s of [reg, other]) {
      expect((await me(s.token)).status).toBe(401);
      expect((await request(app).post('/api/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401);
    }
    const again = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'AnotherPassw0rd1' });
    expect(again.status).toBe(400); // single use
  });

  test('invalid and expired tokens are rejected, and a new request invalidates the previous link', async () => {
    const reg = await register();
    expect((await request(app).post('/api/auth/reset-password').send({ token: 'nonsense', newPassword: 'ResetPassw0rd1' })).status).toBe(400);
    expect((await request(app).post('/api/auth/reset-password').send({ newPassword: 'ResetPassw0rd1' })).status).toBe(400);

    await request(app).post('/api/auth/forgot-password').send({ email: reg.email });
    const first = await tokenFromEmail('PASSWORD_RESET', reg.email);
    await request(app).post('/api/auth/forgot-password').send({ email: reg.email });
    const second = await tokenFromEmail('PASSWORD_RESET', reg.email);
    expect(second).not.toBe(first);
    expect((await request(app).post('/api/auth/reset-password').send({ token: first, newPassword: 'ResetPassw0rd1' })).status).toBe(400);

    await AuthToken.updateMany({ user: reg.user.id, usedAt: null }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).post('/api/auth/reset-password').send({ token: second, newPassword: 'ResetPassw0rd1' })).status).toBe(400);
  });

  test('two simultaneous uses of one token: exactly one succeeds', async () => {
    const reg = await register();
    await request(app).post('/api/auth/forgot-password').send({ email: reg.email });
    const token = await tokenFromEmail('PASSWORD_RESET', reg.email);
    const results = await Promise.all([1, 2, 3].map((i) => request(app).post('/api/auth/reset-password').send({ token, newPassword: `ResetPassw0rd${i}` })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
  });

  test('a reset also clears an account lockout', async () => {
    const reg = await register();
    await User.updateOne({ _id: reg.user.id }, { lockUntil: new Date(Date.now() + 600000) });
    await request(app).post('/api/auth/forgot-password').send({ email: reg.email });
    const token = await tokenFromEmail('PASSWORD_RESET', reg.email);
    await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'ResetPassw0rd1' });
    expect((await login(reg.email, 'ResetPassw0rd1')).status).toBe(200);
  });
});

describe('accounts created before the new fields existed', () => {
  test('a legacy user document (no isActive / emailVerified) can still log in and reset a password', async () => {
    const bcrypt = (await import('bcrypt')).default;
    const email = 'legacy@example.com';
    await User.collection.insertOne({
      name: 'Legacy User', email, role: 'customer', passwordHash: await bcrypt.hash('Passw0rd123', 4),
      createdAt: new Date(), updatedAt: new Date(),
    });
    const legacy = await login(email);
    expect(legacy.status).toBe(200);
    expect(legacy.body.data.user).toMatchObject({ isActive: true, emailVerified: false });
    await request(app).post('/api/auth/forgot-password').send({ email });
    expect(await EmailJob.countDocuments({ event: 'PASSWORD_RESET', to: email })).toBe(1);
  });
});

describe('email verification', () => {
  test('registration queues a verification email; the token verifies the account once', async () => {
    const reg = await register();
    expect((await me(reg.token)).body.data.user.emailVerified).toBe(false);
    const token = await tokenFromEmail('EMAIL_VERIFICATION', reg.email);
    expect(token).toBeTruthy();

    const ok = await request(app).post('/api/auth/verify-email').send({ token });
    expect(ok.status).toBe(200);
    const user = (await me(reg.token)).body.data.user;
    expect(user.emailVerified).toBe(true);
    expect(user.emailVerifiedAt).toEqual(expect.any(String));
    expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(400);
    expect((await request(app).post('/api/auth/verify-email').send({ token: 'junk' })).status).toBe(400);
  });

  test('resend issues a fresh token and invalidates the old one; verified accounts get 409', async () => {
    const reg = await register();
    const oldToken = await tokenFromEmail('EMAIL_VERIFICATION', reg.email);
    expect((await request(app).post('/api/auth/resend-verification')).status).toBe(401);
    expect((await request(app).post('/api/auth/resend-verification').set(bearer(reg.token))).status).toBe(200);
    expect(await EmailJob.countDocuments({ event: 'EMAIL_VERIFICATION', to: reg.email })).toBe(2);
    const newToken = await tokenFromEmail('EMAIL_VERIFICATION', reg.email);
    expect((await request(app).post('/api/auth/verify-email').send({ token: oldToken })).status).toBe(400);
    expect((await request(app).post('/api/auth/verify-email').send({ token: newToken })).status).toBe(200);
    expect((await request(app).post('/api/auth/resend-verification').set(bearer(reg.token))).status).toBe(409);
  });

  test('an expired verification token is rejected', async () => {
    const reg = await register();
    const token = await tokenFromEmail('EMAIL_VERIFICATION', reg.email);
    await AuthToken.updateMany({ user: reg.user.id }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(400);
  });
});

describe('account lockout', () => {
  test('5 wrong passwords lock the account: even the right password is refused, with the same generic error', async () => {
    const reg = await register();
    for (let i = 0; i < 5; i++) {
      const res = await login(reg.email, 'Wrong1234');
      expect(res.status).toBe(401);
    }
    const locked = await login(reg.email); // correct password, but locked
    expect(locked.status).toBe(401);
    expect(locked.body.error.message).toBe('Invalid email or password');
    expect((await User.findById(reg.user.id).select('+lockUntil')).lockUntil.getTime()).toBeGreaterThan(Date.now());
    expect((await me(reg.token)).status).toBe(200); // existing sessions are not affected
  });

  test('the lock expires, and a successful login resets the failure counter', async () => {
    const reg = await register();
    for (let i = 0; i < 5; i++) await login(reg.email, 'Wrong1234');
    await User.updateOne({ _id: reg.user.id }, { lockUntil: new Date(Date.now() - 1000) });
    expect((await login(reg.email)).status).toBe(200);
    const after = await User.findById(reg.user.id).select('+failedLoginAttempts +lockUntil');
    expect(after.failedLoginAttempts).toBe(0);
    expect(after.lockUntil).toBeUndefined();

    // failures are consecutive: 3 + success + 4 never reaches 5
    const other = await register();
    for (let i = 0; i < 3; i++) await login(other.email, 'Wrong1234');
    expect((await login(other.email)).status).toBe(200);
    for (let i = 0; i < 4; i++) await login(other.email, 'Wrong1234');
    expect((await login(other.email)).status).toBe(200);
  });

  test('unknown emails are not tracked and look identical to a wrong password', async () => {
    const reg = await register();
    const wrong = await login(reg.email, 'Wrong1234');
    const ghost = await login('ghost@example.com', 'Wrong1234');
    expect(ghost.status).toBe(wrong.status);
    expect(ghost.body).toEqual(wrong.body);
  });
});
