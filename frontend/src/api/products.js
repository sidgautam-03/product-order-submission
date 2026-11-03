import client, { API_URL } from './client'

const imageUrl = (img) => {
  const u = typeof img === 'string' ? img : (img?.url ?? img?.path ?? '')
  return /^(https?:|blob:|data:)/.test(u) ? u : `${API_URL}${u.startsWith('/') ? '' : '/'}${u}`
}

export function normalizeProduct(p) {
  if (!p) return p
  return {
    ...p,
    id: p.id ?? p._id,
    images: (p.images ?? []).map((img, i) => ({
      id: (typeof img === 'object' && (img.id ?? img._id)) || (typeof img === 'string' ? img : img.url) || i,
      url: imageUrl(img),
    })),
    price: Number(p.price) || 0,
    stock: Number(p.stock) || 0,
    rating: Number(p.averageRating ?? p.rating ?? 0) || 0,
    reviewCount: Number(p.reviewCount ?? p.numReviews ?? p.ratingCount ?? 0) || 0,
    archived: Boolean(p.archived ?? p.isArchived ?? p.status === 'archived'),
  }
}

export function normalizePage(body, map = (x) => x) {
  const items = body.items ?? body.data ?? body.products ?? body.orders ?? body.reviews ?? (Array.isArray(body) ? body : [])
  const total = body.total ?? body.totalItems ?? body.count ?? items.length
  const limit = body.limit ?? body.pageSize ?? 10
  const page = Number(body.page ?? 1)
  const pages = body.pages ?? body.totalPages ?? Math.max(1, Math.ceil(total / limit))
  return { items: items.map(map), total, page, pages }
}

export const listProducts = (params, signal) =>
  client.get('/api/products', { params, signal }).then((r) => normalizePage(r.data, normalizeProduct))

export const getProduct = (id, signal) =>
  client.get(`/api/products/${id}`, { signal }).then((r) => normalizeProduct(r.data.product ?? r.data))

export const saveProduct = (id, formData) =>
  (id ? client.put(`/api/products/${id}`, formData) : client.post('/api/products', formData)).then(
    (r) => normalizeProduct(r.data.product ?? r.data),
  )

export const archiveProduct = (id) => client.delete(`/api/products/${id}`).then((r) => r.data)

const normalizeReview = (r) => ({
  ...r,
  id: r.id ?? r._id,
  author: r.user?.name ?? r.userName ?? r.author ?? 'Customer',
})

export const listReviews = (id, params, signal) =>
  client.get(`/api/products/${id}/reviews`, { params, signal }).then((r) => normalizePage(r.data, normalizeReview))

export const createReview = (id, body) => client.post(`/api/products/${id}/reviews`, body).then((r) => r.data)
