import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// logging is configured from the environment at import time, so this file sets it up itself
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-logs-'));
let mongod, app, User, EmailJob, processPending, startSession, logger;

const read = (name) => {
  const file = path.join(logDir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, {
    MONGO_URI: mongod.getUri(),
    JWT_SECRET: 'test-secret',
    AUTH_RATE_LIMIT_MAX: '1000',
    LOG_LEVEL: 'info',
    LOG_DIR: logDir,
    SMTP_PASS: 'super-secret-smtp-pass',
  });
  app = (await import('../src/app.js')).default;
  logger = (await import('../src/utils/logger.js')).logger;
  ({ User } = await import('../src/model/User.js'));
  ({ EmailJob } = await import('../src/model/EmailJob.js'));
  ({ processPending } = await import('../src/services/email.service.js'));
  ({ startSession } = await import('../src/services/auth.service.js'));
  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all([User.init(), EmailJob.init()]);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
  fs.rmSync(logDir, { recursive: true, force: true });
});

describe('request logs', () => {
  test('every request is logged as JSON with timestamp, level, requestId, message, method, path, status, duration', async () => {
    await request(app).get('/health').set('X-Request-Id', 'req-log-1');
    const line = read('app.log').find((l) => l.requestId === 'req-log-1');
    expect(line).toMatchObject({ level: 'info', message: 'HTTP request', method: 'GET', path: '/health', statusCode: 200, requestId: 'req-log-1' });
    expect(Date.parse(line.timestamp)).not.toBeNaN();
    expect(typeof line.durationMs).toBe('number');
    expect(line.userId).toBeUndefined();
  });

  test('the path has no query string, and the user id is logged when logged in', async () => {
    const user = await User.create({ name: 'Logger', email: 'logger@example.com', passwordHash: 'x' });
    await request(app).get('/api/auth/me?secret=abc').set('Authorization', `Bearer ${(await startSession(user)).token}`).set('X-Request-Id', 'req-log-2');
    const line = read('app.log').find((l) => l.requestId === 'req-log-2');
    expect(line).toMatchObject({ path: '/api/auth/me', statusCode: 200, userId: user.id });
    expect(JSON.stringify(line)).not.toContain('secret=abc');
  });

  test('lines logged from a handler carry the same request id; errors are logged too', async () => {
    await request(app).get('/api/nope').set('X-Request-Id', 'req-log-3');
    expect(read('app.log').filter((l) => l.requestId === 'req-log-3')).toHaveLength(1);
    expect(read('app.log').find((l) => l.requestId === 'req-log-3').statusCode).toBe(404);
  });

  test('passwords, tokens and auth request bodies never reach any log file', async () => {
    const password = 'Sup3rSecretPassw0rd';
    const reg = await request(app).post('/api/auth/register').send({ name: 'Secret Person', email: 'secret@example.com', password });
    const login = await request(app).post('/api/auth/login').send({ email: 'secret@example.com', password });
    await request(app).post('/api/auth/login').send({ email: 'secret@example.com', password: 'WrongPassw0rd' });
    const token = login.body.data.token;
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(reg.status).toBe(201);

    const everything = fs.readdirSync(logDir).map((f) => fs.readFileSync(path.join(logDir, f), 'utf8')).join('\n');
    for (const secret of [password, 'WrongPassw0rd', token, 'Secret Person', 'super-secret-smtp-pass', 'test-secret']) {
      expect(everything).not.toContain(secret);
    }
  });

  test('redaction masks sensitive keys if they are ever logged by mistake', () => {
    logger.info({ user: { password: 'oops', token: 'oops-token' } }, 'accident');
    const line = read('app.log').find((l) => l.message === 'accident');
    expect(JSON.stringify(line)).not.toContain('oops');
  });
});

describe('email logs', () => {
  const job = (over = {}) =>
    EmailJob.create({ event: 'ORDER_PLACED', to: 'buyer@example.com', subject: 's', text: 't', order: new mongoose.Types.ObjectId(), requestId: 'req-mail-1', ...over });

  test('a successful send is logged to email.log only, with job, entity, recipient, attempt, result and message id', async () => {
    const j = await job();
    await processPending(async () => ({ messageId: '<abc@mail>', previewUrl: 'https://ethereal.email/message/xyz' }));
    const line = read('email.log').find((l) => l.jobId === String(j._id));
    expect(line).toMatchObject({
      level: 'info',
      message: 'Email sent',
      event: 'ORDER_PLACED',
      orderId: String(j.order),
      recipient: 'buyer@example.com',
      attempt: 1,
      result: 'sent',
      messageId: '<abc@mail>',
      requestId: 'req-mail-1',
      previewUrl: 'https://ethereal.email/message/xyz',
    });
    expect(Date.parse(line.timestamp)).not.toBeNaN();
    expect(read('email-error.log').find((l) => l.jobId === String(j._id))).toBeUndefined();
  });

  test('a failed attempt is logged to email-error.log only, with the error and attempt number', async () => {
    const j = await job({ event: 'LOW_STOCK', order: undefined, product: new mongoose.Types.ObjectId() });
    await processPending(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:587');
    });
    const line = read('email-error.log').find((l) => l.jobId === String(j._id));
    expect(line).toMatchObject({
      level: 'error',
      event: 'LOW_STOCK',
      productId: String(j.product),
      recipient: 'buyer@example.com',
      attempt: 1,
      result: 'failed',
      error: 'connect ECONNREFUSED 127.0.0.1:587',
      willRetry: true,
    });
    expect(read('email.log').find((l) => l.jobId === String(j._id))).toBeUndefined();
  });
});
