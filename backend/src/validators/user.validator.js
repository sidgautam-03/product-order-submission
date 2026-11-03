import { z } from 'zod';
import { ROLES } from '../model/User.js';
import { paginationShape } from '../utils/pagination.js';
import { passwordRule } from './auth.validator.js';

const roles = Object.values(ROLES);

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: passwordRule,
  role: z.enum(roles).default(ROLES.CUSTOMER),
});

export const updateUserSchema = z
  .object({ role: z.enum(roles).optional(), isActive: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, { message: 'Provide role and/or isActive' });

export const listUsersQuerySchema = z.object({
  role: z.enum(roles).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  q: z.string().trim().min(1).max(100).optional(),
  ...paginationShape,
});
