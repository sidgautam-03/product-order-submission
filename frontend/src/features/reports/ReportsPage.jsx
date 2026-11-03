import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getSalesReport } from '../../api/reports'
import DataState from '../../components/DataState'
import { useAsync } from '../../hooks/useAsync'
import { money } from '../../utils/format'

const isoDay = (d) => d.toISOString().slice(0, 10)
const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400000))

export default function ReportsPage() {
  const [range, setRange] = useState({ from: daysAgo(30), to: isoDay(new Date()) })
  const invalid = range.from && range.to && range.from > range.to
  const { data, loading, error, reload } = useAsync(
    (signal) => (invalid ? Promise.resolve(null) : getSalesReport(range, signal)),
    [range.from, range.to, invalid],
  )
  const empty = data && data.totalOrders === 0 && data.revenuePerDay.length === 0

  return (
    <section>
      <h1>Sales dashboard</h1>
      <div className="filters">
        <label>
          From <input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </label>
        <label>
          To <input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </label>
      </div>
      {invalid && (
        <p className="error" role="alert">
          The start date must be before the end date.
        </p>
      )}

      {!invalid && (
        <DataState loading={loading} error={error} hasData={Boolean(data)} empty={empty} emptyMessage="No sales in this period." onRetry={reload}>
          {data && (
            <>
              <div className="stats">
                <div className="card">
                  <p className="muted">Total revenue</p>
                  <p className="big">{money(data.totalRevenue)}</p>
                </div>
                <div className="card">
                  <p className="muted">Total orders</p>
                  <p className="big">{data.totalOrders}</p>
                </div>
              </div>

              <h2>Revenue per day</h2>
              <div className="chart">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data.revenuePerDay}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(v) => money(v)} />
                    <Line type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <h2>Orders by status</h2>
              <div className="chart">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.ordersByStatus}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="status" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#0ea5e9" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="list">
                {data.ordersByStatus.map((s) => (
                  <li key={s.status}>
                    {s.status}: {s.count}
                  </li>
                ))}
              </ul>

              <h2>Top 5 products</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Units sold</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.slice(0, 5).map((p) => (
                    <tr key={p.id ?? p.name}>
                      <td>{p.name}</td>
                      <td>{p.quantity}</td>
                      <td>{money(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DataState>
      )}
    </section>
  )
}
