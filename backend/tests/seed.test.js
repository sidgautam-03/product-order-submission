import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import { setup } from './helpers.js';

let t, User;

beforeAll(async () => {
  t = await setup();
  ({ User } = t.models);
}, 120000);

afterAll(() => t.teardown());

const seedScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/seed.js');
const runSeed = (env = {}) =>
  spawnSync(process.execPath, [seedScript], {
    env: { ...process.env, LOG_DIR: '', ADMIN_EMAIL: 'Seeded.Admin@Example.com', ADMIN_PASSWORD: 'seed-pass-123', ...env },
    encoding: 'utf8',
  });

test('creates the admin from the environment and is safe to run twice', async () => {
  const first = runSeed();
  expect(first.status).toBe(0);
  expect(first.stdout).toMatch(/created/);

  const second = runSeed();
  expect(second.status).toBe(0);
  expect(second.stdout).toMatch(/already exists/);

  const admins = await User.find({ email: 'seeded.admin@example.com' }).select('+passwordHash');
  expect(admins).toHaveLength(1);
  expect(admins[0].role).toBe('admin');
  expect(admins[0].passwordHash).not.toBe('seed-pass-123'); // bcrypt hash, not the password
  expect(await bcrypt.compare('seed-pass-123', admins[0].passwordHash)).toBe(true);
}, 60000);

test('refuses to touch an existing customer account and rejects weak config', async () => {
  await User.create({ name: 'Cust', email: 'cust@example.com', passwordHash: 'x' });
  const clash = runSeed({ ADMIN_EMAIL: 'cust@example.com' });
  expect(clash.status).toBe(1);
  expect((await User.findOne({ email: 'cust@example.com' })).role).toBe('customer');

  const weak = runSeed({ ADMIN_PASSWORD: 'short' });
  expect(weak.status).toBe(1);
}, 60000);
