import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listProducts } from '../../api/products'
import DataState from '../../components/DataState'
import Pagination from '../../components/Pagination'
import { useAsync } from '../../hooks/useAsync'
import ProductCard from './ProductCard'

const TEXT_KEYS = ['q', 'category', 'minPrice', 'maxPrice']
const PAGE_SIZE = 12
export const SEARCH_DEBOUNCE_MS = 300

const SORTS = [
  { value: '', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
  { value: 'name', label: 'Name' },
]

export default function ProductListPage() {
  const [params, setParams] = useSearchParams()
  const readText = () => Object.fromEntries(TEXT_KEYS.map((k) => [k, params.get(k) ?? '']))

  // Text inputs are kept locally and written to the URL after a 300 ms pause.
  const [draft, setDraft] = useState(readText)
  const written = useRef(draft)

  const update = (patch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
        if (!('page' in patch)) next.delete('page')
        return next
      },
      { replace: false },
    )

  // URL changed from outside (back button, link): mirror it into the inputs.
  useEffect(() => {
    const current = readText()
    if (TEXT_KEYS.some((k) => current[k] !== written.current[k])) {
      written.current = current
      setDraft(current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  useEffect(() => {
    if (TEXT_KEYS.every((k) => draft[k] === written.current[k])) return
    const t = setTimeout(() => {
      written.current = draft
      update(draft)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const page = Math.max(1, Number(params.get('page')) || 1)
  const query = {
    q: params.get('q') || undefined,
    category: params.get('category') || undefined,
    minPrice: params.get('minPrice') || undefined,
    maxPrice: params.get('maxPrice') || undefined,
    minRating: params.get('minRating') || undefined,
    sort: params.get('sort') || undefined,
    page,
    limit: PAGE_SIZE,
  }
  const queryKey = JSON.stringify(query)
  const { data, loading, error, reload } = useAsync((signal) => listProducts(query, signal), [queryKey])

  const setDraftField = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }))

  return (
    <section>
      <h1>Products</h1>
      <form className="filters" onSubmit={(e) => e.preventDefault()} role="search">
        <input type="search" placeholder="Search products" aria-label="Search" value={draft.q} onChange={setDraftField('q')} />
        <input placeholder="Category" aria-label="Category" value={draft.category} onChange={setDraftField('category')} />
        <input type="number" min="0" placeholder="Min price" aria-label="Min price" value={draft.minPrice} onChange={setDraftField('minPrice')} />
        <input type="number" min="0" placeholder="Max price" aria-label="Max price" value={draft.maxPrice} onChange={setDraftField('maxPrice')} />
        <select aria-label="Minimum rating" value={params.get('minRating') ?? ''} onChange={(e) => update({ minRating: e.target.value })}>
          <option value="">Any rating</option>
          {[4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {r}★ & up
            </option>
          ))}
        </select>
        <select aria-label="Sort" value={params.get('sort') ?? ''} onChange={(e) => update({ sort: e.target.value })}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </form>

      <DataState
        loading={loading}
        error={error}
        hasData={Boolean(data)}
        empty={data && data.items.length === 0}
        emptyMessage="No products match your filters."
        onRetry={reload}
      >
        {data && (
          <>
            <div className={`grid${loading ? ' dim' : ''}`}>
              {data.items.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
            <Pagination page={page} pages={data.pages} onChange={(p) => update({ page: p > 1 ? String(p) : '' })} />
          </>
        )}
      </DataState>
    </section>
  )
}
