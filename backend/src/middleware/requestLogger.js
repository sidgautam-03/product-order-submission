import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

// only reuse an incoming id if it is a short safe token (keeps log lines clean)
const SAFE_ID = /^[\w.-]{1,128}$/;

// Sets req.id / X-Request-Id and a request-bound logger (req.log) that stamps requestId on every line,
// then logs one line per finished request. Bodies, headers and query strings are never logged.
export function requestLogger(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  req.log = logger.child({ requestId: req.id });

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    req.log.info(
      {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        statusCode: res.statusCode,
        durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100,
        ...(req.user && { userId: req.user.id }),
      },
      'HTTP request'
    );
  });
  next();
}
