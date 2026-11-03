import mongoose from 'mongoose';

export const EMAIL_EVENTS = Object.freeze({
  ORDER_PLACED: 'ORDER_PLACED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  LOW_STOCK: 'LOW_STOCK',
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
});

export const EMAIL_STATUS = Object.freeze({
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
});

// the outbox: rows are written in the same transaction as the change that caused them
const schema = new mongoose.Schema(
  {
    event: { type: String, enum: Object.values(EMAIL_EVENTS), required: true },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    text: { type: String, required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestId: String, // the API request that queued the email, so its log lines can be correlated
    status: { type: String, enum: Object.values(EMAIL_STATUS), default: EMAIL_STATUS.PENDING },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedAt: Date,
    sentAt: Date,
    messageId: String,
    lastError: String,
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        return {
          id: String(ret._id),
          event: ret.event,
          to: ret.to,
          subject: ret.subject,
          status: ret.status,
          attempts: ret.attempts,
          lastError: ret.lastError ?? null,
          orderId: ret.order ? String(ret.order) : null,
          productId: ret.product ? String(ret.product) : null,
          userId: ret.user ? String(ret.user) : null,
          nextAttemptAt: ret.nextAttemptAt,
          sentAt: ret.sentAt ?? null,
          messageId: ret.messageId ?? null,
          createdAt: ret.createdAt,
        };
      },
    },
  }
);

schema.index({ status: 1, nextAttemptAt: 1 });
schema.index({ status: 1, createdAt: -1, _id: -1 });

export const EmailJob = mongoose.model('EmailJob', schema);
