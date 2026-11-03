import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { AuthToken, TOKEN_TYPES } from '../model/AuthToken.js';
import { Session } from '../model/Session.js';
import { User, ROLES } from '../model/User.js';
import { AppError } from '../utils/AppError.js';
import { enqueuePasswordReset, enqueueVerificationEmail } from './email.service.js';

const SALT_ROUNDS = 12;
// compared against when the email is unknown so login timing doesn't reveal which emails exist
const DUMMY_HASH = bcrypt.hashSync('dummy-password', SALT_ROUNDS);
const DAY_MS = 24 * 60 * 60 * 1000;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const newSecret = () => crypto.randomBytes(32).toString('base64url');
const invalidCredentials = () => new AppError(401, 'Invalid email or password');
const invalidRefresh = () => new AppError(401, 'Invalid or expired refresh token');

export function signToken(user, sessionId) {
  return jwt.sign({ sub: user.id, role: user.role, sid: String(sessionId) }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

// ---------- sessions ----------

export async function startSession(user, userAgent) {
  const refreshToken = newSecret();
  const session = await Session.create({
    user: user._id,
    refreshHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * DAY_MS),
    lastUsedAt: new Date(),
    userAgent: userAgent?.slice(0, 200),
  });
  return { token: signToken(user, session.id), refreshToken, session };
}

export const revokeSession = (sessionId) =>
  Session.updateOne({ _id: sessionId, revokedAt: null }, { revokedAt: new Date() });

export const revokeAllSessions = (userId, { except, session } = {}) =>
  Session.updateMany(
    { user: userId, revokedAt: null, ...(except && { _id: { $ne: except } }) },
    { revokedAt: new Date() },
    { session }
  );

// Rotation with reuse detection: every refresh swaps in a new refresh token. Presenting one that was
// already rotated out means it was copied, so the whole session is revoked.
export async function refresh(rawToken) {
  const hash = sha256(rawToken);
  const session = await Session.findOne({ $or: [{ refreshHash: hash }, { previousRefreshHash: hash }] });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw invalidRefresh();

  if (session.previousRefreshHash === hash) {
    await revokeSession(session._id);
    throw invalidRefresh();
  }

  const user = await User.findById(session.user);
  if (!user || !user.isActive) {
    await revokeSession(session._id);
    throw invalidRefresh();
  }

  const refreshToken = newSecret();
  // compare-and-set on the hash we validated: of two simultaneous refreshes with the same token only one wins
  const rotated = await Session.findOneAndUpdate(
    { _id: session._id, refreshHash: hash, revokedAt: null },
    {
      refreshHash: sha256(refreshToken),
      previousRefreshHash: hash,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * DAY_MS),
      lastUsedAt: new Date(),
    },
    { returnDocument: 'after' }
  );
  if (!rotated) throw invalidRefresh();
  return { user, token: signToken(user, session.id), refreshToken };
}

// ---------- register / login ----------

async function issueToken(user, type, ttlMs, requestId, session, enqueue) {
  const raw = newSecret();
  await AuthToken.create([{ user: user._id, type, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) }], { session });
  await enqueue(user, raw, requestId, session);
}

const issueVerification = (user, requestId, session) =>
  issueToken(user, TOKEN_TYPES.EMAIL_VERIFICATION, env.EMAIL_VERIFY_HOURS * 3600 * 1000, requestId, session, enqueueVerificationEmail);

export async function register({ name, email, password }, { requestId, userAgent } = {}) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  let user;
  try {
    // role is never taken from input: public signup is always a customer.
    // the verification email is queued in the same transaction as the account
    user = await mongoose.connection.transaction(async (session) => {
      const [created] = await User.create([{ name, email, passwordHash, role: ROLES.CUSTOMER }], { session });
      await issueVerification(created, requestId, session);
      return created;
    });
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'Email already registered');
    throw err;
  }
  const { token, refreshToken } = await startSession(user, userAgent);
  return { user, token, refreshToken };
}

// Account lockout: LOGIN_MAX_ATTEMPTS consecutive failures lock the account for LOGIN_LOCK_MINUTES.
// A locked (or disabled) account gets the same generic 401 as a wrong password, so lockout cannot be
// used to discover which emails are registered.
async function recordFailedLogin(user) {
  const updated = await User.findOneAndUpdate(
    { _id: user._id },
    { $inc: { failedLoginAttempts: 1 } },
    { returnDocument: 'after' }
  ).select('+failedLoginAttempts');
  if (updated.failedLoginAttempts >= env.LOGIN_MAX_ATTEMPTS) {
    await User.updateOne(
      { _id: user._id },
      { lockUntil: new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60 * 1000), failedLoginAttempts: 0 }
    );
  }
}

export async function login({ email, password }, { userAgent } = {}) {
  const user = await User.findOne({ email }).select('+passwordHash +failedLoginAttempts +lockUntil');
  const passwordOk = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  const locked = Boolean(user?.lockUntil && user.lockUntil > new Date());

  if (!user || !user.isActive || locked) throw invalidCredentials();
  if (!passwordOk) {
    await recordFailedLogin(user);
    throw invalidCredentials();
  }
  if (user.failedLoginAttempts || user.lockUntil) {
    await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, $unset: { lockUntil: 1 } });
  }
  const { token, refreshToken } = await startSession(user, userAgent);
  return { user, token, refreshToken };
}

// ---------- password change / reset ----------

const setPassword = async (userId, password, session) =>
  User.updateOne(
    { _id: userId },
    { passwordHash: await bcrypt.hash(password, SALT_ROUNDS), failedLoginAttempts: 0, $unset: { lockUntil: 1 } },
    { session }
  );

export async function changePassword(user, currentSessionId, { currentPassword, newPassword }) {
  const full = await User.findById(user._id).select('+passwordHash');
  if (!(await bcrypt.compare(currentPassword, full.passwordHash))) {
    throw new AppError(400, 'Current password is incorrect', 'VALIDATION_ERROR', [
      { path: 'currentPassword', message: 'Current password is incorrect' },
    ]);
  }
  if (currentPassword === newPassword) {
    throw new AppError(400, 'New password must be different', 'VALIDATION_ERROR', [
      { path: 'newPassword', message: 'New password must be different from the current one' },
    ]);
  }
  await setPassword(user._id, newPassword);
  // every other device is signed out; this one stays signed in
  await revokeAllSessions(user._id, { except: currentSessionId });
}

// always succeeds silently, so the response never reveals whether an email is registered
export async function forgotPassword({ email }, { requestId } = {}) {
  const user = await User.findOne({ email, isActive: { $ne: false } }) // $ne: accounts created before the field existed have none;
  if (!user) return;
  await mongoose.connection.transaction(async (session) => {
    await AuthToken.updateMany(
      { user: user._id, type: TOKEN_TYPES.PASSWORD_RESET, usedAt: null },
      { usedAt: new Date() },
      { session }
    ); // an older link stops working when a new one is requested
    await issueToken(user, TOKEN_TYPES.PASSWORD_RESET, env.PASSWORD_RESET_MINUTES * 60 * 1000, requestId, session, enqueuePasswordReset);
  });
}

async function consumeToken(rawToken, type, session) {
  const record = await AuthToken.findOneAndUpdate(
    { tokenHash: sha256(rawToken), type, usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
    { session, returnDocument: 'after' }
  );
  return record;
}

export async function resetPassword({ token, newPassword }) {
  await mongoose.connection.transaction(async (session) => {
    const record = await consumeToken(token, TOKEN_TYPES.PASSWORD_RESET, session); // atomic: usable once
    if (!record) throw new AppError(400, 'Invalid or expired reset token', 'VALIDATION_ERROR');
    await setPassword(record.user, newPassword, session);
    await revokeAllSessions(record.user, { session }); // a reset signs out every device
  });
}

// ---------- email verification ----------

export async function verifyEmail({ token }) {
  await mongoose.connection.transaction(async (session) => {
    const record = await consumeToken(token, TOKEN_TYPES.EMAIL_VERIFICATION, session);
    if (!record) throw new AppError(400, 'Invalid or expired verification token', 'VALIDATION_ERROR');
    await User.updateOne({ _id: record.user }, { emailVerified: true, emailVerifiedAt: new Date() }, { session });
  });
}

export async function resendVerification(user, { requestId } = {}) {
  if (user.emailVerified) throw new AppError(409, 'Email is already verified');
  await mongoose.connection.transaction(async (session) => {
    await AuthToken.updateMany(
      { user: user._id, type: TOKEN_TYPES.EMAIL_VERIFICATION, usedAt: null },
      { usedAt: new Date() },
      { session }
    );
    await issueVerification(user, requestId, session);
  });
}
