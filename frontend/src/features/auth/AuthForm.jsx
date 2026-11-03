import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import FormField from '../../components/FormField'
import { useAuth } from '../../context/AuthContext'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Shared by the login and register screens.
export default function AuthForm({ mode }) {
  const isRegister = mode === 'register'
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from
  const target = from ? `${from.pathname}${from.search ?? ''}` : '/'

  const [values, setValues] = useState({ name: '', email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user && !submitting) return <Navigate to={target} replace />

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }))

  const validate = () => {
    const errs = {}
    if (isRegister && values.name.trim().length < 2) errs.name = 'Name must be at least 2 characters'
    if (!EMAIL_RE.test(values.email)) errs.email = 'Enter a valid email'
    if (values.password.length < 8) errs.password = 'Password must be at least 8 characters'
    return errs
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    const errs = validate()
    setErrors(errs)
    setFormError('')
    if (Object.keys(errs).length) return
    setSubmitting(true)
    try {
      if (isRegister) await register({ name: values.name.trim(), email: values.email, password: values.password })
      else await login({ email: values.email, password: values.password })
      navigate(target, { replace: true })
    } catch (err) {
      setErrors(err.fieldErrors ?? {})
      setFormError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-wrap">
    <form className="auth-card form" onSubmit={onSubmit} noValidate>
      <h1>{isRegister ? 'Create account' : 'Login'}</h1>
      <p className="auth-sub">{isRegister ? 'Sign up to browse and order products' : 'Please sign in to continue'}</p>
      {formError && (
        <p className="error" role="alert">
          {formError}
        </p>
      )}
      {isRegister && (
        <FormField label="Name" error={errors.name}>
          <input value={values.name} onChange={set('name')} autoComplete="name" />
        </FormField>
      )}
      <FormField label="Email" error={errors.email}>
        <input type="email" value={values.email} onChange={set('email')} autoComplete="email" />
      </FormField>
      <FormField label="Password" error={errors.password}>
        <input
          type="password"
          value={values.password}
          onChange={set('password')}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
        />
      </FormField>
      <button type="submit" className="primary" disabled={submitting}>
        {submitting ? 'Please wait…' : isRegister ? 'Register' : 'Login'}
      </button>
      <p className="text-center text-sm">
        {isRegister ? (
          <>
            Already have an account? <Link to="/login" state={location.state}>Login</Link>
          </>
        ) : (
          <>
            New here? <Link to="/register" state={location.state}>Create an account</Link>
          </>
        )}
      </p>
    </form>
    </div>
  )
}
