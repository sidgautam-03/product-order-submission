import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { Product } from './model/Product.js';
import { User, ROLES } from './model/User.js';
import { deleteImages, storeImages } from './utils/images.js';
import { rupeesToPaise } from './utils/money.js';
import { PRODUCTS, makePng } from './seedData.js';

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

  await seedAdmin(email, password);
  await seedProducts();
}

async function seedAdmin(email, password) {
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

// a product is skipped when a live one with the same name (ignoring case) exists, so re-running adds nothing
async function seedProducts() {
  let created = 0;
  for (const p of PRODUCTS) {
    const exists = await Product.exists({ name: p.name, isArchived: false }).collation({ locale: 'en', strength: 2 });
    if (exists) continue;
    const images = [0, 1].map((variant) => {
      const buffer = makePng(p.color, variant);
      return { buffer, mimeType: 'image/png', ext: 'png', size: buffer.length };
    });
    const stored = await storeImages(images);
    try {
      await Product.create({
        name: p.name,
        description: p.description,
        pricePaise: rupeesToPaise(p.price),
        category: p.category,
        stock: p.stock,
        images: stored,
      });
      created++;
    } catch (err) {
      await deleteImages(stored);
      throw err;
    }
  }
  console.log(`Products: ${created} created, ${PRODUCTS.length - created} already existed`);
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
