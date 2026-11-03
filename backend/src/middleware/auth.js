import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Session } from '../model/Session.js';
import { User } from '../model/User.js';
import { AppError } from '../utils/AppError.js';
import { OBJECT_ID_RE } from '../utils/objectId.js';

const invalid = () => new AppError(401, 'Invalid or expired token');

export async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError(401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw invalid();
  }
  if (!OBJECT_ID_RE.test(payload.sub ?? '') || !OBJECT_ID_RE.test(payload.sid ?? '')) throw invalid();

  // Both are loaded fresh on every request: a deleted or disabled user, a changed role, and a revoked
  // session (logout, password reset, ...) all take effect immediately instead of when the token expires.
  const [user, session] = await Promise.all([
    User.findById(payload.sub),
    Session.findOne({ _id: payload.sid, user: payload.sub, revokedAt: null, expiresAt: { $gt: new Date() } }),
  ]);
  if (!user || !user.isActive || !session) throw invalid();

  req.user = user;
  req.authSession = session;
  next();
}

// for public routes that behave differently for logged-in users (a bad token is still a 401)
export async function optionalAuthenticate(req, res, next) {
  if (!req.headers.authorization) return next();
  return authenticate(req, res, next);
}

export const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) throw new AppError(403, 'Forbidden');
    next();
  };
