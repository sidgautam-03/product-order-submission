import client from './client'
import { normalizePage } from './products'

export const STATUS_FLOW = ['Pending', 'Shipped', 'Delivered']
export const ORDER_STATUSES = [...STATUS_FLOW, 'Cancelled']
export const nextStatus = (s) => STATUS_FLOW[STATUS_FLOW.indexOf(s) + 1]

export function normalizeOrder(o) {
  return {
    ...o,
    id: o.id ?? o._id,
    email: o.customer?.email ?? o.email ?? o.user?.email ?? '',
    name: o.customer?.name ?? o.name ?? o.user?.name ?? '',
    items: (o.items ?? []).map((i) => ({
      ...i,
      productId: i.productId ?? i.product?._id ?? i.product?.id ?? i.product,
      name: i.name ?? i.product?.name ?? 'Product',
      price: Number(i.price ?? i.unitPrice ?? 0),
    })),
    total: Number(o.total ?? o.totalAmount ?? 0),
    statusHistory: (o.statusHistory ?? []).map((h) => ({ ...h, date: h.date ?? h.changedAt ?? h.at ?? h.createdAt })),
  }
}

export const listOrders = (params, signal) =>
  client.get('/api/orders', { params, signal }).then((r) => normalizePage(r.data, normalizeOrder))

export const getOrder = (id, signal) =>
  client.get(`/api/orders/${id}`, { signal }).then((r) => normalizeOrder(r.data.order ?? r.data))

export const createOrder = (body, idempotencyKey) =>
  client
    .post('/api/orders', body, { headers: { 'Idempotency-Key': idempotencyKey } })
    .then((r) => normalizeOrder(r.data.order ?? r.data))

export const cancelOrder = (id) => client.patch(`/api/orders/${id}`, { status: 'Cancelled' }).then((r) => r.data)

export const updateOrderStatus = (id, status) =>
  client.patch(`/api/orders/${id}`, { status }).then((r) => r.data)

// Pulls [{productId, available, requested}] out of a 409 body, whatever key the API uses.
export function extractStockConflicts(data) {
  const body = data?.error && typeof data.error === 'object' ? data.error : data
  const list = body?.items ?? body?.insufficient ?? body?.unavailable ?? body?.details ?? body?.errors ?? []
  if (!Array.isArray(list)) return []
  return list
    .map((i) => ({
      productId: String(i.productId ?? i.product ?? i.id ?? i._id ?? ''),
      name: i.name,
      requested: i.requested ?? i.requestedQuantity ?? i.quantity,
      available: Number(i.available ?? i.availableQuantity ?? i.stock ?? 0),
    }))
    .filter((i) => i.productId)
}
