import axios from 'axios'
import { uuid } from '../utils/format'

const TOKEN_KEY = 'token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export const API_URL = import.meta.env.VITE_API_URL || ''

const client = axios.create({ baseURL: API_URL })

let onUnauthorized = null
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn
}

// Accepts [{field, message}], {field: 'msg'} or {field: {message}} and returns {field: 'msg'}
function toFieldErrors(raw) {
  const out = {}
  if (!raw) return out
  if (Array.isArray(raw)) {
    raw.forEach((e) => {
      const field = e.field ?? e.path ?? e.param
      if (field && !out[field]) out[field] = e.message ?? e.msg ?? 'Invalid value'
    })
  } else if (typeof raw === 'object') {
    Object.entries(raw).forEach(([k, v]) => {
      out[k] = typeof v === 'string' ? v : (v?.message ?? String(v))
    })
  }
  return out
}

// The API answers { success: true, data, meta? } or { success: false, error: { code, message, details } }.
export function normalizeError(err) {
  const res = err.response
  const body = res?.data
  const apiError = body?.error && typeof body.error === 'object' ? body.error : body
  const message =
    (typeof apiError === 'object' && (apiError?.message || (typeof apiError?.error === 'string' && apiError.error))) ||
    (res ? `Request failed (${res.status})` : 'Network error. Please check your connection.')
  return Object.assign(new Error(typeof message === 'string' ? message : 'Request failed'), {
    status: res?.status ?? 0,
    code: apiError?.code,
    fieldErrors: toFieldErrors(apiError?.details ?? apiError?.errors ?? apiError?.fieldErrors),
    data: body,
    isApiError: true,
  })
}

client.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) config.headers.Authorization = `Bearer ${token}`
  config.headers['X-Request-Id'] = uuid()
  return config
})

client.interceptors.response.use(
  (res) => {
    const body = res.data
    if (body && typeof body === 'object' && body.success === true && 'data' in body) {
      // Lists come back as data: [...] with paging in meta; expose them as { items, ...meta }.
      res.data = Array.isArray(body.data) ? { items: body.data, ...body.meta } : body.data
    }
    return res
  },
  (err) => {
    if (axios.isCancel(err)) return Promise.reject(err)
    const apiErr = normalizeError(err)
    if (apiErr.status === 401 && !err.config?.skipAuthRedirect && onUnauthorized) {
      onUnauthorized(apiErr)
    }
    return Promise.reject(apiErr)
  },
)

export const isCancel = axios.isCancel
export default client
