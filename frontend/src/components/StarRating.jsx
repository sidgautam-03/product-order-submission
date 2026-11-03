// Read-only when `onChange` is omitted; otherwise an accessible 1-5 picker.
export default function StarRating({ value = 0, onChange, label }) {
  const rounded = Math.round(value)
  if (!onChange) {
    return (
      <span className="stars" role="img" aria-label={label ?? `${Number(value).toFixed(1)} out of 5`}>
        {'★'.repeat(rounded)}
        {'☆'.repeat(5 - rounded)}
      </span>
    )
  }
  return (
    <span className="stars stars-input" role="radiogroup" aria-label={label ?? 'Rating'}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange(n)}
        >
          {n <= value ? '★' : '☆'}
        </button>
      ))}
    </span>
  )
}
