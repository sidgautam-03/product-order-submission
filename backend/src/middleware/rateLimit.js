import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// Per-IP limiter for the auth routes: AUTH_RATE_LIMIT_MAX (default 5) requests per 15 minutes.
// Every call creates an independent counter, so each route that calls authLimiter() is limited on its own.
// Counters live in this process's memory, so restarting the API resets them.
// The 429 carries a Retry-After header (express-rate-limit sets it when the limit is hit).
export const authLimiter = (limit = env.AUTH_RATE_LIMIT_MAX) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'Too many attempts, try again later', 'RATE_LIMITED')),
  });
