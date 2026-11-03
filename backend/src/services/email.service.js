import { env } from '../config/env.js';
import { EMAIL_EVENTS, EMAIL_STATUS, EmailJob } from '../model/EmailJob.js';
import { paiseToRupees } from '../utils/money.js';
import { logEmailAttempt } from '../utils/logger.js';

const NL = String.fromCharCode(10);
const inr = (paise) => `Rs ${paiseToRupees(paise).toFixed(2)}`;

// All enqueue* functions take the transaction session: the email row commits or rolls back together
// with the order / stock change, and the API never waits for SMTP.
const queue = (job, session) => EmailJob.create([job], { session });

export function enqueueOrderPlaced(order, requestId, session) {
  const lines = order.items.map((i) => `- ${i.name} x ${i.quantity} @ ${inr(i.unitPricePaise)} = ${inr(i.lineTotalPaise)}`);
  return queue(
    {
      event: EMAIL_EVENTS.ORDER_PLACED,
      to: order.customerEmail,
      subject: `Order ${order.id} received`,
      text: [`Hi ${order.customerName},`, '', 'Thanks for your order.', '', `Order ID: ${order.id}`, '', 'Items:', ...lines, '', `Total: ${inr(order.totalPaise)}`].join('\n'),
      order: order._id,
      requestId,
    },
    session
  );
}

export function enqueueStatusChanged(order, previousStatus, requestId, session) {
  return queue(
    {
      event: EMAIL_EVENTS.STATUS_CHANGED,
      to: order.customerEmail,
      subject: `Order ${order.id} is now ${order.status}`,
      text: [`Hi ${order.customerName},`, '', `The status of your order ${order.id} changed from ${previousStatus} to ${order.status}.`].join('\n'),
      order: order._id,
      requestId,
    },
    session
  );
}

export function enqueueLowStock(product, requestId, session) {
  return queue(
    {
      event: EMAIL_EVENTS.LOW_STOCK,
      to: env.ADMIN_EMAIL,
      subject: `Low stock: ${product.name}`,
      text: `"${product.name}" is down to ${product.stock} in stock (alert threshold ${product.lowStockThreshold}).`,
      product: product._id,
      requestId,
    },
    session
  );
}

const linkFor = (path, token) => `${env.CLIENT_URL}/${path}?token=${token}`;

export function enqueueVerificationEmail(user, rawToken, requestId, session) {
  return queue(
    {
      event: EMAIL_EVENTS.EMAIL_VERIFICATION,
      to: user.email,
      subject: 'Confirm your email address',
      text: [
        `Hi ${user.name},`, '', 'Please confirm your email address:', linkFor('verify-email', rawToken), '',
        `Or send this token to POST /api/auth/verify-email: ${rawToken}`, '', `The link expires in ${env.EMAIL_VERIFY_HOURS} hours.`,
      ].join(NL),
      user: user._id,
      requestId,
    },
    session
  );
}

export function enqueuePasswordReset(user, rawToken, requestId, session) {
  return queue(
    {
      event: EMAIL_EVENTS.PASSWORD_RESET,
      to: user.email,
      subject: 'Reset your password',
      text: [
        `Hi ${user.name},`, '', 'Use this link to choose a new password:', linkFor('reset-password', rawToken), '',
        `Or send this token to POST /api/auth/reset-password: ${rawToken}`, '',
        `It expires in ${env.PASSWORD_RESET_MINUTES} minutes and works once. If you did not ask for this, ignore this email.`,
      ].join(NL),
      user: user._id,
      requestId,
    },
    session
  );
}

const STUCK_AFTER_MS = 5 * 60 * 1000;
const backoffMs = (attempts) => Math.min(30 * 1000 * 2 ** (attempts - 1), 60 * 60 * 1000);

// Sends every due job through `send({ to, subject, text })`, which may resolve to { messageId, previewUrl }.
// Jobs are claimed with an atomic findOneAndUpdate (pending -> sending), so any number of workers can run
// side by side and a job is never handed to two of them.
export async function processPending(send, now = new Date()) {
  await EmailJob.updateMany(
    { status: EMAIL_STATUS.SENDING, lockedAt: { $lt: new Date(now - STUCK_AFTER_MS) } },
    { status: EMAIL_STATUS.PENDING }
  );

  let processed = 0;
  for (;;) {
    const job = await EmailJob.findOneAndUpdate(
      { status: EMAIL_STATUS.PENDING, nextAttemptAt: { $lte: now } },
      { $set: { status: EMAIL_STATUS.SENDING, lockedAt: now }, $inc: { attempts: 1 } },
      { sort: { nextAttemptAt: 1, _id: 1 }, returnDocument: 'after' }
    );
    if (!job) return processed;
    processed++;

    const entry = {
      event: job.event,
      jobId: String(job._id),
      ...(job.order && { orderId: String(job.order) }),
      ...(job.product && { productId: String(job.product) }),
      ...(job.user && { userId: String(job.user) }),
      recipient: job.to,
      attempt: job.attempts,
      requestId: job.requestId,
    };

    try {
      const info = (await send({ to: job.to, subject: job.subject, text: job.text })) ?? {};
      await EmailJob.updateOne(
        { _id: job._id },
        { status: EMAIL_STATUS.SENT, sentAt: new Date(), messageId: info.messageId, lastError: null }
      );
      logEmailAttempt({ ...entry, result: 'sent', messageId: info.messageId, ...(info.previewUrl && { previewUrl: info.previewUrl }) });
    } catch (err) {
      const exhausted = job.attempts >= env.EMAIL_MAX_ATTEMPTS;
      const error = String(err.message).slice(0, 500);
      await EmailJob.updateOne(
        { _id: job._id },
        {
          status: exhausted ? EMAIL_STATUS.FAILED : EMAIL_STATUS.PENDING,
          lastError: error,
          nextAttemptAt: new Date(now.getTime() + backoffMs(job.attempts)),
        }
      );
      logEmailAttempt({ ...entry, result: 'failed', error, willRetry: !exhausted });
    }
  }
}
