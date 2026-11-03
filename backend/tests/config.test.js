import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// loads the real config module in a fresh process with the given environment
const loadConfig = (env) =>
  spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js'); console.log('loaded')"], {
    cwd: backend,
    env: { ...process.env, MONGO_URI: 'mongodb://localhost/x', ...env },
    encoding: 'utf8',
  });

test('production refuses a weak JWT secret', () => {
  for (const JWT_SECRET of ['change-me', 'short', 'please-CHANGE_ME-please-change-me-now-1234567890']) {
    const res = loadConfig({ NODE_ENV: 'production', JWT_SECRET });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/JWT_SECRET is weak/);
  }
});

test('production accepts a long random secret', () => {
  const res = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'f3a9c1e07b5d4a2e8c6f0b1d9e7a3c5f4b2d8e6a' });
  expect(res.status).toBe(0);
  expect(res.stdout).toContain('loaded');
});

test('development only warns about a weak secret', () => {
  const res = loadConfig({ NODE_ENV: 'development', JWT_SECRET: 'change-me' });
  expect(res.status).toBe(0);
  expect(res.stderr).toMatch(/WARNING: JWT_SECRET is weak/);
});
