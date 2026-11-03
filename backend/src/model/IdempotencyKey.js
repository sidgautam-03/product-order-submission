import mongoose from 'mongoose';
import { env } from '../config/env.js';

const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    state: { type: String, enum: ['processing', 'completed'], default: 'processing' },
    responseStatus: Number,
    responseBody: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// a key is scoped to the user; the unique index is what makes two simultaneous requests create one order
schema.index({ user: 1, key: 1 }, { unique: true });
// records are forgotten after the TTL (the order service also checks age, since the TTL monitor runs only every minute)
schema.index({ createdAt: 1 }, { expireAfterSeconds: env.IDEMPOTENCY_TTL_HOURS * 3600 });

export const IdempotencyKey = mongoose.model('IdempotencyKey', schema);
