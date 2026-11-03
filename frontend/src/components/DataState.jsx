// Renders loading / error / empty states, otherwise its children.
export default function DataState({ loading, error, empty, emptyMessage = 'Nothing to show.', onRetry, hasData, children }) {
  if (error) {
    return (
      <div className="state error" role="alert">
        <p>{error.message || 'Something went wrong.'}</p>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    )
  }
  if (loading && !hasData) {
    return (
      <div className="state" role="status">
        Loading…
      </div>
    )
  }
  if (empty) return <div className="state">{emptyMessage}</div>
  return children
}
