import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email());

export const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72) // bcrypt ignores bytes past 72
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

const opaqueToken = z.string().min(1).max(200);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  password: passwordRule,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(72),
});

export const refreshSchema = z.object({ refreshToken: opaqueToken });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: passwordRule,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({ token: opaqueToken, newPassword: passwordRule });

export const verifyEmailSchema = z.object({ token: opaqueToken });
