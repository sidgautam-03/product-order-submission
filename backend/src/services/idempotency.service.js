import { setTimeout as sleep } from 'node:timers/promises';
import { env } from '../config/env.js';
import { IdempotencyKey } from '../model/IdempotencyKey.js';
import { AppError } from '../utils/AppError.js';

const TTL_MS = env.IDEMPOTENCY_TTL_HOURS * 3600 * 1000;
const STALE_IN_FLIGHT_MS = 60 * 1000; // a "processing" record older than this belongs to a crashed request
const WAIT_STEP_MS = 50;
const WAIT_MAX_MS = 15 * 1000;

const reused = (key) =>
  new AppError(422, 'Idempotency-Key was already used with a different request body', 'IDEMPOTENCY_KEY_REUSED', [
    { path: 'Idempotency-Key', key, message: 'This key was already used with a different request body' },
  ]);

// Claim the key for this request. Resolves to { record } when the caller should do the work,
// or { replay: { status, body } } when an earlier request already finished it.
export async function claim(userId, key, requestHash) {
  for (let round = 0; round < 5; round++) {
    try {
      return { record: await IdempotencyKey.create({ user: userId, key, requestHash }) };
    } catch (err) {
      if (err.code !== 11000) throw err;
    }

    let existing = await IdempotencyKey.findOne({ user: userId, key });
    if (!existing) continue; // removed in the meantime, try to claim again

    if (Date.now() - existing.createdAt.getTime() > TTL_MS) {
      await IdempotencyKey.deleteOne({ _id: existing._id });
      continue;
    }
    if (existing.requestHash !== requestHash) throw reused(key);

    // same body: wait for the in-flight request to finish, then return its response
    const deadline = Date.now() + WAIT_MAX_MS;
    while (existing && existing.state !== 'completed') {
      if (Date.now() - existing.createdAt.getTime() > STALE_IN_FLIGHT_MS) {
        await IdempotencyKey.deleteOne({ _id: existing._id, state: 'processing' });
        break;
      }
      if (Date.now() > deadline) {
        throw new AppError(409, 'A request with this Idempotency-Key is still being processed, retry shortly');
      }
      await sleep(WAIT_STEP_MS);
      existing = await IdempotencyKey.findById(existing._id);
    }
    if (existing?.state === 'completed') {
      return { replay: { status: existing.responseStatus, body: existing.responseBody } };
    }
    // the in-flight request failed (record deleted) or was stale: loop and claim it ourselves
  }
  throw new AppError(409, 'Could not acquire the Idempotency-Key, retry shortly');
}

// a failed request must not burn the key: the client can fix the problem and retry with it
export const release = (record) => IdempotencyKey.deleteOne({ _id: record._id });
