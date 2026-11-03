import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { User, ROLES } from './model/User.js';

const adminSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(72),
});

async function seed() {
  const parsed = adminSchema.safeParse({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
  if (!parsed.success) {
    throw new Error('ADMIN_EMAIL must be a valid email and ADMIN_PASSWORD 8-72 characters in .env');
  }
  const { email, password } = parsed.data;

  await connectDB();

  const existing = await User.findOne({ email });
  if (existing) {
    // never overwrite an existing account's password or silently promote a customer
    if (existing.role === ROLES.ADMIN) {
      console.log(`Admin ${email} already exists, nothing to do`);
      return;
    }
    throw new Error(`${email} already exists as a ${existing.role}; use a different ADMIN_EMAIL`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({ name: 'Admin', email, passwordHash, role: ROLES.ADMIN, emailVerified: true, emailVerifiedAt: new Date() });
  console.log(`Admin ${email} created`);
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
