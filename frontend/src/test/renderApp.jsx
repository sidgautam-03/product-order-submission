import { render } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { AuthProvider } from '../context/AuthContext'
import { CartProvider } from '../context/CartContext'
import { BASE, server } from './server'

// Signs in as `role` (if given) by seeding a token and mocking /api/auth/me.
export function renderApp(route = '/', { role } = {}) {
  if (role) {
    localStorage.setItem('token', 'test-token')
    server.use(http.get(`${BASE}/api/auth/me`, () => HttpResponse.json({ user: { id: 'u1', name: 'Test User', email: 'test@example.com', role } })))
  }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <CartProvider>
          <App />
        </CartProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}
