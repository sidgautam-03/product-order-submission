import { Router } from 'express';
import * as controller from '../controllers/auth.controller.js';
import { env } from '../config/env.js';
import { authenticate } from '../middleware/auth.js';
import { authLimiter as limiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../validators/auth.validator.js';

const router = Router();

router.post('/register', limiter(), validate(registerSchema), controller.register);
router.post('/login', limiter(), validate(loginSchema), controller.login);
// clients refresh about once per access-token lifetime, so this limit is more generous
router.post('/refresh', limiter(Math.max(30, env.AUTH_RATE_LIMIT_MAX)), validate(refreshSchema), controller.refresh);

router.get('/me', authenticate, controller.me);
router.post('/logout', authenticate, controller.logout);
router.post('/logout-all', authenticate, controller.logoutAll);

router.post('/change-password', authenticate, limiter(), validate(changePasswordSchema), controller.changePassword);
router.post('/forgot-password', limiter(), validate(forgotPasswordSchema), controller.forgotPassword);
router.post('/reset-password', limiter(), validate(resetPasswordSchema), controller.resetPassword);

router.post('/verify-email', limiter(), validate(verifyEmailSchema), controller.verifyEmail);
router.post('/resend-verification', authenticate, limiter(), controller.resendVerification);

export default router;
