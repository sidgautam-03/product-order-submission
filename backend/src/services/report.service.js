import { Order, ORDER_STATUS } from '../model/Order.js';
import { addDays, istDayStart } from '../utils/dates.js';
import { paiseToRupees } from '../utils/money.js';

export const REPORT_TIMEZONE = 'Asia/Kolkata';

export async function salesReport({ from, to }) {
  const start = istDayStart(from);
  const end = istDayStart(addDays(to, 1)); // exclusive: the whole of the "to" day is included
  const notCancelled = { $match: { status: { $ne: ORDER_STATUS.CANCELLED } } };

  const [result] = await Order.aggregate([
    { $match: { createdAt: { $gte: start, $lt: end } } },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        totals: [notCancelled, { $group: { _id: null, revenuePaise: { $sum: '$totalPaise' }, orders: { $sum: 1 } } }],
        byDay: [
          notCancelled,
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: REPORT_TIMEZONE } },
              revenuePaise: { $sum: '$totalPaise' },
              orders: { $sum: 1 },
            },
          },
        ],
        topProducts: [
          notCancelled,
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.product',
              name: { $first: '$items.name' },
              quantity: { $sum: '$items.quantity' },
              revenuePaise: { $sum: '$items.lineTotalPaise' },
            },
          },
          { $sort: { quantity: -1, _id: 1 } },
          { $limit: 5 },
        ],
      },
    },
  ]);

  const statusCounts = Object.fromEntries(Object.values(ORDER_STATUS).map((s) => [s, 0]));
  for (const { _id, count } of result.byStatus) statusCounts[_id] = count;

  // days without sales are filled with zero (at most 366 iterations, over already-aggregated rows)
  const byDay = new Map(result.byDay.map((d) => [d._id, d]));
  const revenuePerDay = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const row = byDay.get(day);
    revenuePerDay.push({ date: day, revenue: paiseToRupees(row?.revenuePaise ?? 0), orders: row?.orders ?? 0 });
  }

  const totals = result.totals[0];
  return {
    range: { from, to, timezone: REPORT_TIMEZONE },
    totalRevenue: paiseToRupees(totals?.revenuePaise ?? 0),
    orderCount: totals?.orders ?? 0,
    ordersByStatus: statusCounts,
    revenuePerDay,
    topProducts: result.topProducts.map((p) => ({
      productId: String(p._id),
      name: p.name,
      quantitySold: p.quantity,
      revenue: paiseToRupees(p.revenuePaise),
    })),
  };
}
