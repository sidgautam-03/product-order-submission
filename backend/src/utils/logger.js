import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { env } from '../config/env.js';

// Every line is JSON with timestamp, level, message (and requestId when it belongs to a request).
const options = {
  level: env.LOG_LEVEL,
  base: undefined, // no pid / hostname noise
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  messageKey: 'message',
  formatters: { level: (label) => ({ level: label }) },
  // belt and braces: request bodies are never logged, but if one of these keys ever shows up it is masked
  redact: { paths: ['*.password', '*.token', '*.authorization', '*.SMTP_PASS', '*.JWT_SECRET'], censor: '[Redacted]' },
};

function fileStream(name) {
  if (!env.LOG_DIR) return null;
  fs.mkdirSync(env.LOG_DIR, { recursive: true });
  // sync writes: log volume is low and lines are never lost on a crash or an exit
  return { stream: pino.destination({ dest: path.join(env.LOG_DIR, name), sync: true }) };
}

const build = (streams) => pino(options, pino.multistream(streams));

// application log: console always, plus logs/app.log when LOG_DIR is set
export const logger = build([{ stream: process.stdout }, fileStream('app.log')].filter(Boolean));

// email attempts: successes go to logs/email.log, failures to logs/email-error.log; console in development
const devConsole = env.NODE_ENV === 'development' ? [{ stream: process.stdout }] : [];
const emailOk = build([...devConsole, fileStream('email.log')].filter(Boolean));
const emailFailed = build([...devConsole, fileStream('email-error.log')].filter(Boolean));

// fields: event (ORDER_PLACED | STATUS_CHANGED | LOW_STOCK), jobId, orderId / productId, recipient,
// attempt, result ('sent' | 'failed'), messageId or error, requestId of the request that queued it
export function logEmailAttempt(fields) {
  if (fields.result === 'sent') emailOk.info(fields, 'Email sent');
  else emailFailed.error(fields, 'Email attempt failed');
}
