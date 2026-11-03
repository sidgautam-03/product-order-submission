import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export function notFound(req, res) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

function normalize(err) {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new AppError(400, 'Validation failed', 'VALIDATION_ERROR', details);
  }
  if (err.type === 'entity.parse.failed') return new AppError(400, 'Request body is not valid JSON');
  if (err.type === 'entity.too.large') return new AppError(400, 'Request body is too large');
  if (err.name === 'CastError') return new AppError(400, `Invalid ${err.path}`);
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return new AppError(400, 'Validation failed', 'VALIDATION_ERROR', details);
  }
  if (err.name === 'VersionError') return new AppError(409, 'Resource was modified by another request, retry');
  if (err.code === 11000) return new AppError(409, 'Already exists');
  return null;
}

// Express 5 forwards rejected async handlers here automatically
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const known = normalize(err);
  if (!known) {
    (req.log || console).error({ err }, 'Unhandled error');
    const message = env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
  }

  res.status(known.status).json({
    success: false,
    error: { code: known.code, message: known.message, ...(known.details && { details: known.details }) },
  });
}
