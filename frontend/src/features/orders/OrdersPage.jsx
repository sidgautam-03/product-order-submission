import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { cancelOrder, listOrders, nextStatus, ORDER_STATUSES, updateOrderStatus } from '../../api/orders'
import ConfirmDialog from '../../components/ConfirmDialog'
import DataState from '../../components/DataState'
import Pagination from '../../components/Pagination'
import { useAuth } from '../../context/AuthContext'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, money } from '../../utils/format'

export default function OrdersPage() {
  const { isAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const filters = { status: params.get('status') || '', email: params.get('email') || '', from: params.get('from') || '', to: params.get('to') || '' }
  const query = { page, limit: 10, ...(isAdmin ? Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) : {}) }
  const { data, loading, error, reload } = useAsync((signal) => listOrders(query, signal), [JSON.stringify(query)])

  const [emailDraft, setEmailDraft] = useState(filters.email)
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [toCancel, setToCancel] = useState(null)

  const setParam = (patch) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
      if (!('page' in patch)) next.delete('page')
      return next
    })

  const run = async (id, action) => {
    if (busyId) return
    setBusyId(id)
    setActionError('')
    try {
      await action()
      reload()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusyId(null)
      setToCancel(null)
    }
  }

  return (
    <section>
      <h1>{isAdmin ? 'All orders' : 'My orders'}</h1>

      {isAdmin && (
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault()
            setParam({ email: emailDraft.trim() })
          }}
        >
          <select aria-label="Status" value={filters.status} onChange={(e) => setParam({ status: e.target.value })}>
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input type="search" placeholder="Customer email" aria-label="Email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} />
          <label>
            From <input type="date" aria-label="From date" value={filters.from} onChange={(e) => setParam({ from: e.target.value })} />
          </label>
          <label>
            To <input type="date" aria-label="To date" value={filters.to} onChange={(e) => setParam({ to: e.target.value })} />
          </label>
          <button type="submit">Filter</button>
        </form>
      )}

      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}

      <DataState loading={loading} error={error} hasData={Boolean(data)} empty={data && data.items.length === 0} emptyMessage="No orders found." onRetry={reload}>
        {data && (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  {isAdmin && <th>Email</th>}
                  <th>Total</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => {
                  const next = nextStatus(o.status)
                  return (
                    <tr key={o.id}>
                      <td>
                        <Link to={`/orders/${o.id}`}>{o.id}</Link>
                      </td>
                      <td>{formatDate(o.createdAt)}</td>
                      {isAdmin && <td>{o.email}</td>}
                      <td>{money(o.total)}</td>
                      <td>{o.status}</td>
                      <td>
                        {!isAdmin && o.status === 'Pending' && (
                          <button type="button" disabled={busyId === o.id} onClick={() => setToCancel(o)}>
                            Cancel
                          </button>
                        )}
                        {isAdmin && next && o.status !== 'Cancelled' && (
                          <button type="button" disabled={busyId === o.id} onClick={() => run(o.id, () => updateOrderStatus(o.id, next))}>
                            Mark {next}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pagination page={page} pages={data.pages} onChange={(p) => setParam({ page: p > 1 ? String(p) : '' })} />
          </>
        )}
      </DataState>

      <ConfirmDialog
        open={Boolean(toCancel)}
        title="Cancel order?"
        message={`Order ${toCancel?.id} will be cancelled and its stock released.`}
        confirmLabel="Cancel order"
        busy={Boolean(busyId)}
        onConfirm={() => run(toCancel.id, () => cancelOrder(toCancel.id))}
        onCancel={() => setToCancel(null)}
      />
    </section>
  )
}
