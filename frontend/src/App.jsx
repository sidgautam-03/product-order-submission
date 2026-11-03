import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './features/auth/LoginPage'
import RegisterPage from './features/auth/RegisterPage'
import CartPage from './features/cart/CartPage'
import OrderDetailPage from './features/orders/OrderDetailPage'
import OrdersPage from './features/orders/OrdersPage'
import ProductDetailPage from './features/products/ProductDetailPage'
import ProductFormPage from './features/products/ProductFormPage'
import ProductListPage from './features/products/ProductListPage'
import ReportsPage from './features/reports/ReportsPage'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route element={<ProtectedRoute roles={['customer', 'admin']} />}>
          <Route path="/" element={<ProductListPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
        </Route>

        <Route element={<ProtectedRoute roles={['customer']} />}>
          <Route path="/cart" element={<CartPage />} />
        </Route>

        <Route element={<ProtectedRoute roles={['customer', 'admin']} />}>
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
        </Route>

        <Route element={<ProtectedRoute roles={['admin']} />}>
          <Route path="/admin/products/new" element={<ProductFormPage />} />
          <Route path="/admin/products/:id/edit" element={<ProductFormPage />} />
          <Route path="/admin/reports" element={<ReportsPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
