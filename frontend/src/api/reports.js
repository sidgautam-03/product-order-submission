import client from './client'

export const getSalesReport = (params, signal) =>
  client.get('/api/reports/sales', { params, signal }).then((r) => {
    const d = r.data.report ?? r.data
    const byStatus = d.ordersByStatus ?? d.byStatus ?? {}
    return {
      totalRevenue: Number(d.totalRevenue ?? d.revenue ?? 0),
      totalOrders: Number(d.totalOrders ?? d.orderCount ?? 0),
      revenuePerDay: (d.revenuePerDay ?? d.daily ?? []).map((x) => ({
        date: x.date ?? x._id,
        revenue: Number(x.revenue ?? x.total ?? 0),
      })),
      ordersByStatus: Array.isArray(byStatus)
        ? byStatus.map((x) => ({ status: x.status ?? x._id, count: x.count }))
        : Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      topProducts: (d.topProducts ?? []).map((p) => ({
        ...p,
        id: p.id ?? p._id ?? p.productId,
        name: p.name ?? p.productName,
        quantity: p.quantity ?? p.unitsSold ?? p.totalQuantity ?? 0,
        revenue: Number(p.revenue ?? p.totalRevenue ?? 0),
      })),
    }
  })
