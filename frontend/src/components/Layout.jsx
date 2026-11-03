import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'

const link = ({ isActive }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium no-underline transition ${
    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`

export default function Layout() {
  const { user, isAdmin, logout } = useAuth()
  const { count } = useCart()
  return (
    <div className="relative min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/" className="text-xl font-extrabold tracking-tight text-indigo-600 no-underline">
            Shop
          </Link>
          {user && (
            <nav className="flex flex-1 items-center justify-center gap-1">
              <NavLink to="/" end className={link}>
                Products
              </NavLink>
              <NavLink to="/orders" className={link}>
                Orders
              </NavLink>
              {!isAdmin && (
                <NavLink to="/cart" className={link}>
                  Cart ({count})
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/admin/products/new" className={link}>
                  New product
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/admin/reports" className={link}>
                  Reports
                </NavLink>
              )}
            </nav>
          )}
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="hidden text-sm text-slate-600 sm:inline">{user.name || user.email}</span>
                <button type="button" onClick={logout}>
                  Logout
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={link}>
                  Login
                </NavLink>
                <NavLink to="/register" className={link}>
                  Register
                </NavLink>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
