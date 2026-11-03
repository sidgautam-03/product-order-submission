import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as authApi from '../api/auth'
import { setUnauthorizedHandler, tokenStore } from '../api/client'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const locationRef = useRef(location)
  locationRef.current = location

  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(() => Boolean(tokenStore.get()))

  // On any 401: drop the token and send the user to login, remembering where they were.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.clear()
      setUser(null)
      setLoading(false)
      const { pathname, search } = locationRef.current
      if (pathname === '/login') return
      navigate('/login', { replace: true, state: { from: { pathname, search } } })
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate])

  useEffect(() => {
    if (!tokenStore.get()) return
    let active = true
    authApi
      .fetchMe()
      .then((u) => active && setUser(u))
      .catch(() => {}) // 401s are handled by the client interceptor
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  const authenticate = useCallback(async (request, body) => {
    const res = await request(body)
    tokenStore.set(res.token)
    setUser(await authApi.fetchMe())
  }, [])

  const login = useCallback((body) => authenticate(authApi.login, body), [authenticate])
  const register = useCallback((body) => authenticate(authApi.register, body), [authenticate])

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    navigate('/login', { replace: true })
  }, [navigate])

  const value = { user, loading, isAdmin: user?.role === 'admin', login, register, logout }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
