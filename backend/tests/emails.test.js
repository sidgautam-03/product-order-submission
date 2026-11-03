import request from 'supertest';
import { setup } from './helpers.js';

let t, EmailJob, processPending, env, admin, customer;

beforeAll(async () => {
  t = await setup();
  ({ EmailJob } = t.models);
  ({ processPending } = await import('../src/services/email.service.js'));
  ({ env } = await import('../src/config/env.js'));
  admin = await t.makeUser(t.ROLES.ADMIN);
  customer = await t.makeUser();
}, 120000);

afterAll(() => t.teardown());

const job = (over = {}) =>
  EmailJob.create({ event: 'LOW_STOCK', to: 'admin@example.com', subject: 'Low stock', text: 'body', ...over });

beforeEach(() => EmailJob.deleteMany({}));

test('sends pending jobs and marks them sent', async () => {
  await job();
  await job();
  const sent = [];
  expect(await processPending(async (m) => sent.push(m))).toBe(2);
  expect(sent[0]).toEqual({ to: 'admin@example.com', subject: 'Low stock', text: 'body' });
  expect(await EmailJob.countDocuments({ status: 'sent' })).toBe(2);
  expect(await processPending(async () => {})).toBe(0); // nothing is sent twice
});

test('a failing send is retried later with backoff, and marked failed after the max attempts', async () => {
  const j = await job();
  const boom = async () => {
    throw new Error('smtp down');
  };
  await processPending(boom);
  let doc = await EmailJob.findById(j._id);
  expect(doc).toMatchObject({ status: 'pending', attempts: 1, lastError: 'smtp down' });
  expect(doc.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  expect(await processPending(boom)).toBe(0); // not due yet

  let now = new Date();
  for (let i = 0; i < 6; i++) {
    now = new Date(now.getTime() + 2 * 3600 * 1000);
    await processPending(boom, now);
  }
  doc = await EmailJob.findById(j._id);
  expect(doc.status).toBe('failed');
  expect(doc.attempts).toBe(env.EMAIL_MAX_ATTEMPTS);
});

test('a job stuck in "sending" by a crashed worker is picked up again', async () => {
  const j = await job({ status: 'sending', lockedAt: new Date(Date.now() - 10 * 60 * 1000), attempts: 1 });
  const sent = [];
  await processPending(async (m) => sent.push(m));
  expect(sent).toHaveLength(1);
  expect((await EmailJob.findById(j._id)).status).toBe('sent');
});

test('two workers never send the same job twice', async () => {
  for (let i = 0; i < 10; i++) await job();
  const sent = [];
  await Promise.all([processPending(async (m) => sent.push(m)), processPending(async (m) => sent.push(m))]);
  expect(sent).toHaveLength(10);
});

describe('GET /api/admin/email-jobs', () => {
  const list = (qs = '', auth = admin.auth) => request(t.app).get(`/api/admin/email-jobs${qs}`).set(auth);

  test('admin only', async () => {
    expect((await request(t.app).get('/api/admin/email-jobs')).status).toBe(401);
    expect((await list('', customer.auth)).status).toBe(403);
  });

  test('lists jobs with attempt count and last error, filtered by status, paginated', async () => {
    await job({ status: 'failed', attempts: 3, lastError: 'connect ECONNREFUSED' });
    await job({ status: 'sent', attempts: 1 });
    await job({ status: 'pending' });

    const failed = await list('?status=failed');
    expect(failed.status).toBe(200);
    expect(failed.body.data).toHaveLength(1);
    expect(failed.body.data[0]).toMatchObject({ status: 'failed', attempts: 3, lastError: 'connect ECONNREFUSED', event: 'LOW_STOCK' });
    expect(failed.body.data[0].text).toBeUndefined();
    expect(failed.body.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });

    expect((await list()).body.meta.total).toBe(3);
    expect((await list('?limit=2&page=2')).body.data).toHaveLength(1);
    expect((await list('?status=bogus')).status).toBe(400);
  });
});
