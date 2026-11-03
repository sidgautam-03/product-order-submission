import { env } from '../config/env.js';
import * as orderService from '../services/order.service.js';
import { salesReport } from '../services/report.service.js';
import { AppError } from '../utils/AppError.js';
import {
  UUID_RE,
  listOrdersQuerySchema,
  placeOrderBodySchema,
  salesReportQuerySchema,
} from '../validators/order.validator.js';

function idempotencyKey(req) {
  const key = req.get('Idempotency-Key')?.trim();
  const problem = !key ? 'Idempotency-Key header is required' : !UUID_RE.test(key) ? 'Idempotency-Key header must be a UUID' : null;
  if (problem) throw new AppError(400, problem, 'VALIDATION_ERROR', [{ path: 'Idempotency-Key', message: problem }]);
  return key.toLowerCase();
}

export async function place(req, res) {
  if (env.REQUIRE_EMAIL_VERIFICATION && !req.user.emailVerified) {
    throw new AppError(403, 'Verify your email address before placing orders', 'EMAIL_NOT_VERIFIED');
  }
  const key = idempotencyKey(req);
  const input = placeOrderBodySchema.parse(req.body ?? {});
  const result = await orderService.placeOrder(req.user, key, input, { requestId: req.id });
  if (result.replayed) res.set('Idempotency-Replayed', 'true');
  res.status(result.status).json({ success: true, data: result.body });
}

export async function get(req, res) {
  res.json({ success: true, data: await orderService.getOrder(req.user, req.params.id) });
}

export async function list(req, res) {
  const query = listOrdersQuerySchema.parse(req.query);
  const { orders, meta } = await orderService.listOrders(req.user, query);
  res.json({ success: true, data: orders, meta });
}

export async function updateStatus(req, res) {
  const order = await orderService.updateStatus(req.user, req.params.id, req.body.status, { requestId: req.id });
  res.json({ success: true, data: order });
}

export async function sales(req, res) {
  const query = salesReportQuerySchema.parse(req.query);
  res.json({ success: true, data: await salesReport(query) });
}
