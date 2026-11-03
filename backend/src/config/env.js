import 'dotenv/config';

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 5000,
  MONGO_URI: process.env.MONGO_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1h',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  REFRESH_TOKEN_DAYS: Number(process.env.REFRESH_TOKEN_DAYS) || 7,
  LOGIN_MAX_ATTEMPTS: Number(process.env.LOGIN_MAX_ATTEMPTS) || 5,
  LOGIN_LOCK_MINUTES: Number(process.env.LOGIN_LOCK_MINUTES) || 15,
  PASSWORD_RESET_MINUTES: Number(process.env.PASSWORD_RESET_MINUTES) || 30,
  EMAIL_VERIFY_HOURS: Number(process.env.EMAIL_VERIFY_HOURS) || 24,
  REQUIRE_EMAIL_VERIFICATION: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  AUTH_RATE_LIMIT_MAX: Number(process.env.AUTH_RATE_LIMIT_MAX) || 5,
  IDEMPOTENCY_TTL_HOURS: Number(process.env.IDEMPOTENCY_TTL_HOURS) || 24,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  EMAIL_FROM: process.env.EMAIL_FROM,
  EMAIL_MAX_ATTEMPTS: Number(process.env.EMAIL_MAX_ATTEMPTS) || 5,
  EMAIL_WORKER_INTERVAL_MS: Number(process.env.EMAIL_WORKER_INTERVAL_MS) || 5000,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_DIR: process.env.LOG_DIR,
};

for (const key of ['MONGO_URI', 'JWT_SECRET']) {
  if (!env[key]) throw new Error(`Missing env variable: ${key}`);
}
// a guessable signing secret lets anyone forge tokens: refuse to run with one in production
if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /change-?me/i.test(env.JWT_SECRET)) {
  const message = 'JWT_SECRET is weak: use at least 32 random characters (for example: openssl rand -hex 32)';
  if (env.NODE_ENV === 'production') throw new Error(message);
  if (env.NODE_ENV === 'development') console.warn(`WARNING: ${message}`);
}
