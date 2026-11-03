import { setTimeout as sleep } from 'node:timers/promises';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { logger } from './utils/logger.js';
import { processPending } from './services/email.service.js';

if (!env.SMTP_HOST) throw new Error('Missing env variable: SMTP_HOST');

// With the Ethereal host and no credentials, create a throwaway Ethereal account so test emails work out of the box.
// Each sent message is then viewable through the previewUrl in the email log.
let { SMTP_USER: user, SMTP_PASS: pass } = env;
if (!user && env.SMTP_HOST === 'smtp.ethereal.email') {
  try {
    ({ user, pass } = await nodemailer.createTestAccount());
    logger.info({ user }, 'Created a temporary Ethereal account; open the previewUrl logged for each sent email to read it');
  } catch (err) {
    logger.warn({ err }, 'Could not create an Ethereal account; set SMTP_USER and SMTP_PASS');
  }
}

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: user ? { user, pass } : undefined,
});

async function send(mail) {
  const info = await transporter.sendMail({ from: env.EMAIL_FROM, ...mail });
  // for Ethereal this is a link to view the sent message; false for real SMTP servers
  return { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || undefined };
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => (stopping = true));

await connectDB();
logger.info({ intervalMs: env.EMAIL_WORKER_INTERVAL_MS }, 'Email worker started');

while (!stopping) {
  try {
    await processPending(send);
  } catch (err) {
    logger.error({ err }, 'Email worker loop failed');
  }
  await sleep(env.EMAIL_WORKER_INTERVAL_MS);
}

await mongoose.disconnect();
