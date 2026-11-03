import fs from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// 1x1 PNG, plus minimal JPEG / WEBP headers: enough for magic-byte detection
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(32)]);
export const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32)]);

export async function setup({ authLimit = 1000 } = {}) {
  process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL || 'silent';
  process.env.LOG_DIR = '';
  process.env.JWT_SECRET = 'test-secret';
  process.env.AUTH_RATE_LIMIT_MAX = String(authLimit);
  process.env.ADMIN_EMAIL = 'admin@example.com';
  // orders use transactions, which need a replica set
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URI = mongod.getUri();

  const app = (await import('../src/app.js')).default;
  const { UPLOADS_DIR } = await import('../src/config/paths.js');
  const { User, ROLES } = await import('../src/model/User.js');
  const { Product } = await import('../src/model/Product.js');
  const { Review } = await import('../src/model/Review.js');
  const { Order, ORDER_STATUS } = await import('../src/model/Order.js');
  const { EmailJob } = await import('../src/model/EmailJob.js');
  const { IdempotencyKey } = await import('../src/model/IdempotencyKey.js');
  const { startSession } = await import('../src/services/auth.service.js');

  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all([User, Product, Review, Order, EmailJob, IdempotencyKey].map((m) => m.init()));

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const before = new Set(fs.readdirSync(UPLOADS_DIR));
  const uploadFiles = () => fs.readdirSync(UPLOADS_DIR).filter((f) => !before.has(f));

  let n = 0;
  const makeUser = async (role = ROLES.CUSTOMER, name = `User ${++n}`) => {
    const user = await User.create({ name, email: `u${++n}-${Date.now()}@example.com`, passwordHash: 'x', role });
    const { token } = await startSession(user);
    return { user, auth: { Authorization: `Bearer ${token}` } };
  };

  const makeProduct = (over = {}) =>
    Product.create({
      name: `Product ${++n}`,
      description: 'A product',
      pricePaise: 10000,
      category: 'Gadgets',
      stock: 10,
      images: [{ filename: 'seed.png', path: 'uploads/seed.png', size: 1, mimeType: 'image/png' }],
      ...over,
    });

  const deliveredOrderFor = (user, product) =>
    Order.create({
      user: user._id,
      customerName: user.name,
      customerEmail: user.email,
      items: [{ product: product._id, name: product.name, unitPricePaise: product.pricePaise, quantity: 1, lineTotalPaise: product.pricePaise }],
      totalPaise: product.pricePaise,
      status: ORDER_STATUS.DELIVERED,
    });

  const teardown = async () => {
    for (const f of uploadFiles()) fs.rmSync(`${UPLOADS_DIR}/${f}`, { force: true });
    await mongoose.disconnect();
    await mongod.stop();
  };

  return { app, UPLOADS_DIR, uploadFiles, makeUser, makeProduct, deliveredOrderFor, teardown, models: { User, Product, Review, Order, EmailJob, IdempotencyKey }, ROLES };
}
