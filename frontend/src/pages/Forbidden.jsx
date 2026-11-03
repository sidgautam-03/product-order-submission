import { Link } from 'react-router-dom'

export default function Forbidden() {
  return (
    <div className="state">
      <h1>403 – Forbidden</h1>
      <p>You do not have permission to view this page.</p>
      <Link to="/">Back to products</Link>
    </div>
  )
}
