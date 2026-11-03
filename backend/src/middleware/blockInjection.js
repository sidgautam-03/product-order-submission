import { AppError } from '../utils/AppError.js';

// Rejects MongoDB operator injection such as { "email": { "$gt": "" } } or ?email[$gt]=
// (express-mongo-sanitize cannot be used: it assigns req.query, which is read-only in Express 5).
const bad = (key) => key.startsWith('$') || key.includes('.') || /\[\$/.test(key);

function findBadKey(value, path = '') {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (bad(key)) return path ? `${path}.${key}` : key;
    const nested = findBadKey(child, path ? `${path}.${key}` : key);
    if (nested) return nested;
  }
  return null;
}

export function blockInjection(req, res, next) {
  for (const [where, value] of [['body', req.body], ['query', req.query]]) {
    const key = findBadKey(value);
    if (key) {
      throw new AppError(400, 'Request contains disallowed characters in field names', 'VALIDATION_ERROR', [
        { path: `${where}.${key.replaceAll('$', '')}`, message: 'Field names must not start with "$" or contain "."' },
      ]);
    }
  }
  next();
}
