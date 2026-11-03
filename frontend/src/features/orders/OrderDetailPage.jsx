import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { cancelOrder, getOrder, nextStatus, updateOrderStatus } from '../../api/orders'
import DataState from '../../components/DataState'
import { useAuth } from '../../context/AuthContext'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, money } from '../../utils/format'

export default function OrderDetailPage() {
  const { id } = useParams()
  const { isAdmin } = useAuth()
  const { data: order, loading, error, reload } = useAsync((signal) => getOrder(id, signal), [id])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const run = async (action) => {
    if (busy) return
    setBusy(true)
    setActionError('')
    try {
      await action()
      reload()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const next = order && nextStatus(order.status)

  return (
    <section>
      <p>
        <Link to="/orders">← Back to orders</Link>
      </p>
      <DataState loading={loading} error={error} hasData={Boolean(order)} onRetry={reload}>
        {order && (
          <>
            <h1>Order {order.id}</h1>
            <p>
              Status: <strong>{order.status}</strong> · Placed {formatDate(order.createdAt)}
              {order.email && ` · ${order.email}`}
            </p>
            {actionError && (
              <p className="error" role="alert">
                {actionError}
              </p>
            )}
            <div className="row">
              {!isAdmin && order.status === 'Pending' && (
                <button type="button" disabled={busy} onClick={() => run(() => cancelOrder(order.id))}>
                  {busy ? 'Working…' : 'Cancel order'}
                </button>
              )}
              {isAdmin && next && order.status !== 'Cancelled' && (
                <button type="button" className="primary" disabled={busy} onClick={() => run(() => updateOrderStatus(order.id, next))}>
                  {busy ? 'Working…' : `Mark ${next}`}
                </button>
              )}
            </div>

            <h2>Items</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Qty</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i, idx) => (
                  <tr key={`${i.productId}-${idx}`}>
                    <td>{i.name}</td>
                    <td>{money(i.price)}</td>
                    <td>{i.quantity}</td>
                    <td>{money(i.price * i.quantity)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>Total</th>
                  <th>{money(order.total)}</th>
                </tr>
              </tfoot>
            </table>

            <h2>Status history</h2>
            {order.statusHistory.length ? (
              <ol className="list">
                {order.statusHistory.map((h, idx) => (
                  <li key={idx}>
                    {h.status} <span className="muted">{formatDate(h.date)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No history recorded.</p>
            )}
          </>
        )}
      </DataState>
    </section>
  )
}
