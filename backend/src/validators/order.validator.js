import { z } from 'zod';
import { ORDER_STATUS } from '../model/Order.js';
import { OBJECT_ID_RE } from '../utils/objectId.js';
import { paginationShape } from '../utils/pagination.js';
import { addDays, daysBetween, isValidYmd } from '../utils/dates.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = Object.values(ORDER_STATUS);
const MAX_QTY = 100;

export const placeOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(100),
  customerEmail: z.string().trim().toLowerCase().pipe(z.email()),
  items: z
    .array(
      z.object({
        productId: z.string().regex(OBJECT_ID_RE, 'must be a valid ObjectId'),
        quantity: z.number().int().min(1).max(MAX_QTY),
      })
    )
    .min(1)
    .max(20),
});

export const updateStatusSchema = z.object({ status: z.enum(STATUSES) });

// Duplicate product ids are merged by summing their quantities (documented in the README).
// Output is sorted by product id so stock rows are always locked in the same order and the
// request hash does not depend on the order the client listed the items in.
export function normalizeOrder(input, ctx) {
  const merged = new Map();
  for (const { productId, quantity } of input.items) {
    const id = productId.toLowerCase();
    merged.set(id, (merged.get(id) ?? 0) + quantity);
  }
  const items = [...merged].sort(([a], [b]) => (a < b ? -1 : 1)).map(([productId, quantity]) => ({ productId, quantity }));
  const tooMany = items.filter((i) => i.quantity > MAX_QTY);
  if (tooMany.length) {
    for (const i of tooMany) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: `merged quantity for ${i.productId} exceeds ${MAX_QTY}` });
    }
    return z.NEVER;
  }
  return { customerName: input.customerName, customerEmail: input.customerEmail, items };
}

export const placeOrderBodySchema = placeOrderSchema.transform(normalizeOrder);

// a date (YYYY-MM-DD, an IST calendar day) or a full ISO datetime
const dateParam = z.string().refine(
  (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? isValidYmd(s) : /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s))),
  'must be an ISO date (YYYY-MM-DD) or datetime'
);

export const listOrdersQuerySchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    customerEmail: z.string().trim().toLowerCase().min(1).max(254).optional(),
    from: dateParam.optional(),
    to: dateParam.optional(),
    ...paginationShape,
  });

export const salesReportQuerySchema = z
  .object({
    from: z.string({ error: 'from is required' }).refine(isValidYmd, 'from must be a date in YYYY-MM-DD format'),
    to: z.string({ error: 'to is required' }).refine(isValidYmd, 'to must be a date in YYYY-MM-DD format'),
  })
  .superRefine((q, ctx) => {
    if (!isValidYmd(q.from) || !isValidYmd(q.to)) return;
    if (q.from > q.to) ctx.addIssue({ code: 'custom', path: ['from'], message: 'from must not be after to' });
    else if (daysBetween(q.from, q.to) + 1 > 366) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'the range must not exceed 366 days' });
    }
  });

export { addDays };
