import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createOrder, extractStockConflicts } from '../../api/orders'
import FormField from '../../components/FormField'
import { useAuth } from '../../context/AuthContext'
import { useCart } from '../../context/CartContext'
import { money, uuid } from '../../utils/format'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function CartPage() {
  const { user } = useAuth()
  const { items, total, setQuantity, remove, clear, adjustToAvailability } = useCart()
  const [customer, setCustomer] = useState({ name: user?.name ?? '', email: user?.email ?? '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [conflicts, setConflicts] = useState([])
  const [orderId, setOrderId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)

  // One Idempotency-Key per checkout attempt: reused for retries and double-clicks of the
  // same request, replaced only when the request body changes or the order succeeds.
  const attempt = useRef({ key: null, signature: null })
  const keyFor = (body) => {
    const signature = JSON.stringify(body)
    if (!attempt.current.key || attempt.current.signature !== signature) {
      attempt.current = { key: uuid(), signature }
    }
    return attempt.current.key
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (inFlight.current) return
    const errs = {}
    if (customer.name.trim().length < 2) errs.name = 'Enter your name'
    if (!EMAIL_RE.test(customer.email)) errs.email = 'Enter a valid email'
    setErrors(errs)
    setFormError('')
    if (Object.keys(errs).length) return

    const body = {
      customerName: customer.name.trim(),
      customerEmail: customer.email.trim(),
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    }
    const key = keyFor(body)

    inFlight.current = true
    setSubmitting(true)
    setConflicts([])
    try {
      const order = await createOrder(body, key)
      attempt.current = { key: null, signature: null }
      setOrderId(order.id)
      clear()
    } catch (err) {
      if (err.status === 409) {
        const found = extractStockConflicts(err.data)
        setConflicts(found)
        setFormError(err.message || 'Some items are no longer available in the requested quantity.')
      } else {
        setErrors(err.fieldErrors ?? {})
        setFormError(err.message)
      }
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  if (orderId) {
    return (
      <div className="state success" role="status">
        <h1>Thank you!</h1>
        <p>
          Your order <strong>{orderId}</strong> has been placed.
        </p>
        <Link to={`/orders/${orderId}`}>View order</Link>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="state">
        <p>Your cart is empty.</p>
        <Link to="/">Browse products</Link>
      </div>
    )
  }

  const nameOf = (c) => c.name ?? items.find((i) => String(i.productId) === c.productId)?.name ?? 'Item'

  return (
    <section>
      <h1>Cart</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Price</th>
            <th>Quantity</th>
            <th>Subtotal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.productId}>
              <td>{i.name}</td>
              <td>{money(i.price)}</td>
              <td>
                <input
                  type="number"
                  min="1"
                  max={i.stock}
                  aria-label={`Quantity for ${i.name}`}
                  value={i.quantity}
                  onChange={(e) => setQuantity(i.productId, e.target.value)}
                />
              </td>
              <td>{money(i.price * i.quantity)}</td>
              <td>
                <button type="button" onClick={() => remove(i.productId)} aria-label={`Remove ${i.name}`}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={3}>Total</th>
            <th>{money(total)}</th>
            <th />
          </tr>
        </tfoot>
      </table>

      {conflicts.length > 0 && (
        <div className="card error" role="alert">
          <p>{formError}</p>
          <ul>
            {conflicts.map((c) => (
              <li key={c.productId}>
                {nameOf(c)}: {c.available} available{c.requested != null ? ` (you requested ${c.requested})` : ''}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              adjustToAvailability(conflicts)
              setConflicts([])
              setFormError('')
            }}
          >
            Adjust cart to available quantities
          </button>
        </div>
      )}

      <form className="card form narrow" onSubmit={onSubmit} noValidate>
        <h2>Checkout</h2>
        {formError && conflicts.length === 0 && (
          <p className="error" role="alert">
            {formError}
          </p>
        )}
        <FormField label="Name" error={errors.name ?? errors.customerName}>
          <input value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} />
        </FormField>
        <FormField label="Email" error={errors.email ?? errors.customerEmail}>
          <input type="email" value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} />
        </FormField>
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Placing order…' : 'Place order'}
        </button>
      </form>
    </section>
  )
}
