const DEFAULT_CODES = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'IDEMPOTENCY_KEY_REUSED',
  429: 'RATE_LIMITED',
};

export class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || DEFAULT_CODES[status] || 'INTERNAL_ERROR';
    this.details = details;
  }
}
