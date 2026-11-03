import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { IdempotencyKey } from '../model/IdempotencyKey.js';
import { Order, ORDER_STATUS } from '../model/Order.js';
import { Product } from '../model/Product.js';
import { ROLES } from '../model/User.js';
import { AppError } from '../utils/AppError.js';
import { addDays, istDayStart } from '../utils/dates.js';
import { buildMeta, pageParams } from '../utils/pagination.js';
import { enqueueLowStock, enqueueOrderPlaced, enqueueStatusChanged } from './email.service.js';
import * as idempotency from './idempotency.service.js';

const { PENDING, SHIPPED, DELIVERED, CANCELLED } = ORDER_STATUS;

export const TRANSITIONS = Object.freeze([
  { from: PENDING, to: SHIPPED, roles: [ROLES.ADMIN] },
  { from: SHIPPED, to: DELIVERED, roles: [ROLES.ADMIN] },
  { from: PENDING, to: CANCELLED, roles: [ROLES.ADMIN, ROLES.CUSTOMER] },
]);

const nextStatuses = (from) => TRANSITIONS.filter((t) => t.from === from).map((t) => t.to);

const notFound = () => new AppError(404, 'Order not found');

// ---------- placing an order ----------

const hashRequest = (input) => crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');

async function createOrderInTransaction(user, input, requestId, session) {
  const ids = input.items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: ids } }).session(session);
  const known = new Map(products.map((p) => [String(p._id), p]));

  const missing = ids.filter((id) => !known.get(id) || known.get(id).isArchived);
  if (missing.length) {
    throw new AppError(404, `Product not found: ${missing.join(', ')}`, 'NOT_FOUND',
      missing.map((id) => ({ productId: id, message: 'Product does not exist or is archived' })));
  }

  // items arrive sorted by product id: every transaction touches stock rows in the same order
  const lines = [];
  const failures = [];
  for (const { productId, quantity } of input.items) {
    // the stock check and the decrement are one atomic conditional update, so stock can never go negative
    const updated = await Product.findOneAndUpdate(
      { _id: productId, isArchived: false, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { session, returnDocument: 'after' }
    );
    if (!updated) {
      const current = known.get(productId);
      const fresh = await Product.findById(productId).session(session).select('stock');
      failures.push({ productId, name: current.name, requested: quantity, available: fresh?.stock ?? 0 });
      continue;
    }
    lines.push({
      product: updated._id,
      name: updated.name,
      unitPricePaise: updated.pricePaise,
      quantity,
      lineTotalPaise: updated.pricePaise * quantity,
    });

    if (env.ADMIN_EMAIL && updated.stock <= updated.lowStockThreshold && !updated.lowStockAlerted) {
      // the flag flip is conditional, so concurrent orders crossing the threshold queue exactly one email
      const flipped = await Product.updateOne({ _id: updated._id, lowStockAlerted: false }, { lowStockAlerted: true }, { session });
      if (flipped.modifiedCount === 1) await enqueueLowStock(updated, requestId, session);
    }
  }
  // reporting every failing item; throwing aborts the transaction, undoing the other items' decrements
  if (failures.length) throw new AppError(409, 'Insufficient stock for one or more items', 'INSUFFICIENT_STOCK', failures);

  const now = new Date();
  const [order] = await Order.create(
    [
      {
        user: user._id,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        items: lines,
        totalPaise: lines.reduce((sum, l) => sum + l.lineTotalPaise, 0),
        status: PENDING,
        statusHistory: [{ status: PENDING, changedBy: user._id, at: now }],
      },
    ],
    { session }
  );
  await enqueueOrderPlaced(order, requestId, session); // outbox row commits with the order
  return order;
}

export async function placeOrder(user, key, input, { requestId } = {}) {
  const claim = await idempotency.claim(user._id, key, hashRequest(input));
  if (claim.replay) return { ...claim.replay, replayed: true };

  try {
    const body = await mongoose.connection.transaction(async (session) => {
      const order = await createOrderInTransaction(user, input, requestId, session);
      const json = JSON.parse(JSON.stringify(order));
      // stored in the same transaction as the order: either both exist or neither does
      await IdempotencyKey.updateOne(
        { _id: claim.record._id },
        { state: 'completed', responseStatus: 201, responseBody: json },
        { session }
      );
      return json;
    });
    return { status: 201, body };
  } catch (err) {
    await idempotency.release(claim.record);
    throw err;
  }
}

// ---------- reading orders ----------

// a customer's lookup is scoped to their own orders, so another customer's order is indistinguishable from a missing one
const visibleTo = (user) => (user.role === ROLES.ADMIN ? {} : { user: user._id });

export async function getOrder(user, id) {
  const order = await Order.findOne({ _id: id, ...visibleTo(user) });
  if (!order) throw notFound();
  return order;
}

// date-only values are IST calendar days; "to" includes the whole day
function createdAtRange({ from, to }) {
  const range = {};
  if (from) range.$gte = /^\d{4}-\d{2}-\d{2}$/.test(from) ? istDayStart(from) : new Date(from);
  if (to) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) range.$lt = istDayStart(addDays(to, 1));
    else range.$lte = new Date(to);
  }
  return range;
}

export async function listOrders(user, query) {
  const isAdmin = user.role === ROLES.ADMIN;
  const { page, limit, skip } = pageParams(query);

  const filter = { ...visibleTo(user) };
  if (query.status) filter.status = query.status;
  if (isAdmin) {
    if (query.customerEmail) filter.customerEmail = query.customerEmail;
    if (query.from || query.to) {
      const range = createdAtRange(query);
      const inverted = range.$gte && (range.$lt ? range.$gte >= range.$lt : range.$lte && range.$gte > range.$lte);
      if (inverted) {
        throw new AppError(400, 'from must not be after to', 'VALIDATION_ERROR', [
          { path: 'from', message: 'from must not be after to' },
        ]);
      }
      filter.createdAt = range;
    }
  }

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  return { orders, meta: buildMeta(page, limit, total) };
}

// ---------- changing status ----------

async function restoreStock(order, session) {
  const items = [...order.items].sort((a, b) => (String(a.product) < String(b.product) ? -1 : 1));
  for (const item of items) {
    const product = await Product.findOneAndUpdate(
      { _id: item.product },
      { $inc: { stock: item.quantity } },
      { session, returnDocument: 'after' }
    );
    // back above the threshold: the next drop may queue a fresh low-stock email
    if (product?.lowStockAlerted && product.stock > product.lowStockThreshold) {
      await Product.updateOne({ _id: product._id }, { lowStockAlerted: false }, { session });
    }
  }
}

export async function updateStatus(user, id, status, { requestId } = {}) {
  const order = await getOrder(user, id);

  const rule = TRANSITIONS.find((t) => t.from === order.status && t.to === status);
  if (!rule) {
    throw new AppError(409, `Cannot change an order from ${order.status} to ${status}`, 'INVALID_TRANSITION', [
      { currentStatus: order.status, allowedNextStatuses: nextStatuses(order.status) },
    ]);
  }
  if (!rule.roles.includes(user.role)) {
    const allowed = TRANSITIONS.filter((t) => t.roles.includes(user.role)).map(({ from, to }) => ({ from, to }));
    throw new AppError(403, `Your role is not allowed to change an order from ${order.status} to ${status}`, 'FORBIDDEN', [
      { allowedTransitions: allowed },
    ]);
  }

  return mongoose.connection.transaction(async (session) => {
    // compare-and-set on the status we validated against: of two simultaneous changes, only one matches
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status },
      { $set: { status }, $push: { statusHistory: { status, changedBy: user._id, at: new Date() } } },
      { session, returnDocument: 'after' }
    );
    if (!updated) {
      const current = await Order.findById(order._id).session(session).select('status');
      throw new AppError(409, 'The order was changed by another request', 'INVALID_TRANSITION', [
        { currentStatus: current.status, allowedNextStatuses: nextStatuses(current.status) },
      ]);
    }
    if (status === CANCELLED) await restoreStock(updated, session);
    await enqueueStatusChanged(updated, order.status, requestId, session); // every change, cancellation included
    return updated;
  });
}
