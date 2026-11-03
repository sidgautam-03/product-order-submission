import client from './client'

const opts = { skipAuthRedirect: true }

export const login = (body) => client.post('/api/auth/login', body, opts).then((r) => r.data)
export const register = (body) => client.post('/api/auth/register', body, opts).then((r) => r.data)
export const fetchMe = () => client.get('/api/auth/me').then((r) => r.data.user ?? r.data)
