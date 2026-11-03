import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Forbidden from '../pages/Forbidden'

// roles: allowed roles; omit to allow any signed-in user.
export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="state" role="status">
        Loading…
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: { pathname: location.pathname, search: location.search } }} />
  }
  if (roles && !roles.includes(user.role)) return <Forbidden />
  return <Outlet />
}
