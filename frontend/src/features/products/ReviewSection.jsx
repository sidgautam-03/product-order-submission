import { useState } from 'react'
import { createReview, listReviews } from '../../api/products'
import DataState from '../../components/DataState'
import FormField from '../../components/FormField'
import Pagination from '../../components/Pagination'
import StarRating from '../../components/StarRating'
import { useAuth } from '../../context/AuthContext'
import { useAsync } from '../../hooks/useAsync'
import { formatDate } from '../../utils/format'

export default function ReviewSection({ productId, onReviewed }) {
  const { user, isAdmin } = useAuth()
  const [page, setPage] = useState(1)
  const { data, loading, error, reload } = useAsync((signal) => listReviews(productId, { page, limit: 5 }, signal), [productId, page])

  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (submitting) return
    const errs = {}
    if (!rating) errs.rating = 'Select a rating'
    if (comment.length > 1000) errs.comment = 'Comment must be at most 1000 characters'
    setErrors(errs)
    setFormError('')
    if (Object.keys(errs).length) return
    setSubmitting(true)
    try {
      await createReview(productId, { rating, comment: comment.trim() })
      setRating(0)
      setComment('')
      setDone(true)
      if (page === 1) reload()
      else setPage(1)
      onReviewed?.()
    } catch (err) {
      setErrors(err.fieldErrors ?? {})
      // 403: no delivered purchase, 409: already reviewed — both show the API's own message
      setFormError(
        err.status === 403
          ? err.message || 'You can only review products from a delivered order.'
          : err.status === 409
            ? err.message || 'You have already reviewed this product.'
            : err.message,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="reviews">
      <h2>Reviews</h2>
      {user && !isAdmin && (
        <form className="card form" onSubmit={submit} noValidate>
          <h3>Write a review</h3>
          {done && <p className="success" role="status">Thanks! Your review was added.</p>}
          {formError && (
            <p className="error" role="alert">
              {formError}
            </p>
          )}
          <FormField label="Rating" error={errors.rating}>
            <StarRating value={rating} onChange={setRating} />
          </FormField>
          <FormField label="Comment" error={errors.comment}>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          </FormField>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit review'}
          </button>
        </form>
      )}

      <DataState loading={loading} error={error} hasData={Boolean(data)} empty={data && data.items.length === 0} emptyMessage="No reviews yet." onRetry={reload}>
        {data && (
          <>
            <ul className="list">
              {data.items.map((r) => (
                <li key={r.id} className="card">
                  <StarRating value={r.rating} /> <strong>{r.author}</strong>{' '}
                  <span className="muted">{formatDate(r.createdAt)}</span>
                  {r.comment && <p>{r.comment}</p>}
                </li>
              ))}
            </ul>
            <Pagination page={page} pages={data.pages} onChange={setPage} />
          </>
        )}
      </DataState>
    </section>
  )
}
