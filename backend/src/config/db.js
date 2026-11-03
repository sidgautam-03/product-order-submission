import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  await mongoose.connect(env.MONGO_URI);
  console.log('MongoDB connected');

  // orders use multi-document transactions, which MongoDB only supports on a replica set
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    console.warn('WARNING: MongoDB is not a replica set; placing and cancelling orders will fail');
  }
}
