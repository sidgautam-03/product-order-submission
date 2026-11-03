import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderApp } from './renderApp'
import { BASE, server } from './server'

const product = (over = {}) => ({ _id: 'p1', name: 'Widget', price: 10, stock: 5, category: 'Tools', images: [], averageRating: 4, reviewCount: 2, ...over })

describe('routing', () => {
  it('shows the 403 page when a customer opens an admin route', async () => {
    renderApp('/admin/reports', { role: 'customer' })
    expect(await screen.findByText(/403/)).toBeInTheDocument()
  })

  it('redirects logged-out users to /login', async () => {
    renderApp('/orders')
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
  })

  it.each(['/', '/products/p1'])('asks logged-out users to log in before viewing %s', async (route) => {
    renderApp(route)
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Search')).not.toBeInTheDocument()
  })

  it('renders the register form in the centred auth layout', async () => {
    const { container } = renderApp('/register')
    expect(await screen.findByRole('heading', { name: 'Create account' })).toBeInTheDocument()
    expect(container.querySelector('.auth-wrap .auth-card')).toBeInTheDocument()
  })
})

describe('product search', () => {
  it('does not let a slow, stale response replace a newer one', async () => {
    server.use(
      http.get(`${BASE}/api/products`, async ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        if (q === 'slow') {
          await delay(700)
          return HttpResponse.json({ items: [product({ _id: 's', name: 'Slow result' })], total: 1, pages: 1 })
        }
        return HttpResponse.json({ items: [product({ _id: 'f', name: 'Fast result' })], total: 1, pages: 1 })
      }),
    )
    const user = userEvent.setup()
    renderApp('/', { role: 'customer' })
    const search = await screen.findByLabelText('Search')

    await user.type(search, 'slow')
    await new Promise((r) => setTimeout(r, 400)) // debounce fires, slow request is in flight
    await user.clear(search)
    await user.type(search, 'fast')

    expect(await screen.findByText('Fast result', {}, { timeout: 2000 })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 900)) // slow response has now arrived
    expect(screen.getByText('Fast result')).toBeInTheDocument()
    expect(screen.queryByText('Slow result')).not.toBeInTheDocument()
  })
})

describe('checkout', () => {
  it("shows each item's available quantity when the API returns 409", async () => {
    localStorage.setItem('cart', JSON.stringify([{ productId: 'p1', name: 'Widget', price: 10, stock: 5, quantity: 4 }]))
    const keys = []
    server.use(
      http.get(`${BASE}/api/products/p1`, () => HttpResponse.json(product())),
      http.post(`${BASE}/api/orders`, ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'))
        return HttpResponse.json({ message: 'Insufficient stock', items: [{ productId: 'p1', name: 'Widget', requested: 4, available: 2 }] }, { status: 409 })
      }),
    )
    const user = userEvent.setup()
    renderApp('/cart', { role: 'customer' })

    await screen.findByText('Checkout')
    await user.click(screen.getByRole('button', { name: 'Place order' }))
    expect(await screen.findByText(/Widget: 2 available/)).toBeInTheDocument()

    // retry with an unchanged cart reuses the same Idempotency-Key
    await user.click(screen.getByRole('button', { name: 'Place order' }))
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])

    // adjusting the cart caps the quantity
    await user.click(screen.getByRole('button', { name: /Adjust cart/ }))
    expect(screen.getByLabelText('Quantity for Widget')).toHaveValue(2)
  })
})
