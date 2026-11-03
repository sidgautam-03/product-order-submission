import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { UPLOADS_DIR } from './config/paths.js';
import authRoutes from './routes/auth.routes.js';
import productRoutes from './routes/product.routes.js';
import { orderRouter, reportRouter } from './routes/order.routes.js';
import { requestLogger } from './middleware/requestLogger.js';
import { blockInjection } from './middleware/blockInjection.js';
import adminRoutes from './routes/admin.routes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(requestLogger);
// cross-origin resource policy relaxed so the React app (another origin) can display uploaded images
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.CLIENT_URL, exposedHeaders: ['X-Request-Id'] }));
app.use(express.json());
app.use(blockInjection);

app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRouter);
app.use('/api/reports', reportRouter);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
