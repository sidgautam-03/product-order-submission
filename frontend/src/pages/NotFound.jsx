import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="state">
      <h1>404 – Page not found</h1>
      <Link to="/">Back to products</Link>
    </div>
  )
}
