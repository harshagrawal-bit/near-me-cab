import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { homePathFor, useAuth } from '@/auth/AuthContext'
import { brand } from '@/config/brand'
import Logo from '@/components/brand/Logo'
import Button from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Alert } from '@/components/ui/States'
import { IconCheck } from '@/components/ui/Icons'
import { FullPageLoader } from '@/components/ui/Loaders'
import GoogleButton from '@/components/auth/GoogleButton'

export default function Login() {
  const { login, adoptSession, isAuthenticated, role, initialising } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (initialising) return <FullPageLoader />
  if (isAuthenticated) return <Navigate to={homePathFor(role)} replace />

  const validate = () => {
    const next = {}
    if (!form.email.trim()) next.email = 'Enter your email address.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      next.email = 'Enter a valid email address.'
    if (!form.password) next.password = 'Enter your password.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setFormError(null)
    if (!validate()) return
    setSubmitting(true)
    try {
      const user = await login({ email: form.email.trim(), password: form.password })
      const destination = location.state?.from || homePathFor(user.role)
      navigate(destination, { replace: true })
    } catch (error) {
      setFormError(error.message)
      setErrors(error.fieldErrors || {})
    } finally {
      setSubmitting(false)
    }
  }

  /** The Google button hands back a session the backend already minted. */
  const onGoogleSuccess = async (session) => {
    try {
      const user = await adoptSession(session)
      toast.success('Signed in.')
      navigate(homePathFor(user.role), { replace: true })
    } catch (error) {
      setFormError(error.message)
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Marketing panel — desktop only, keeps the mobile form uncluttered. */}
      <aside className="relative hidden w-1/2 flex-col justify-between bg-ink-900 p-10 lg:flex xl:w-[55%]">
        <Logo to={null} invert />
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white xl:text-4xl">
            {brand.marketing.headline}
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-300">
            {brand.marketing.subhead}
          </p>
          <ul className="mt-8 space-y-3">
            {brand.marketing.points.map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-sm text-ink-200">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-brand-300">
                  <IconCheck className="h-3 w-3" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-ink-500">
          © {new Date().getFullYear()} {brand.legalName}
        </p>
      </aside>

      <main className="flex w-full flex-col justify-center px-5 py-10 sm:px-10 lg:w-1/2 xl:w-[45%]">
        <div className="mx-auto w-full max-w-sm">
          <div className="lg:hidden">
            <Logo to={null} showTagline />
          </div>

          <div className="mt-8 lg:mt-0">
            <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Welcome back</h2>
            <p className="mt-1.5 text-sm text-ink-500">
              Sign in to book a trip or manage your account.
            </p>
          </div>

          <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
            {formError && <Alert tone="danger">{formError}</Alert>}

            <Field label="Email address" htmlFor="email" error={errors.email} required>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={form.email}
                invalid={Boolean(errors.email)}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>

            <Field label="Password" htmlFor="password" error={errors.password} required>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={form.password}
                invalid={Boolean(errors.password)}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </Field>

            <Button type="submit" fullWidth size="lg" loading={submitting}>
              Sign in
            </Button>
          </form>

          <div className="mt-5">
            <GoogleButton onSuccess={onGoogleSuccess} onError={(e) => setFormError(e.message)} />
          </div>

          <p className="mt-6 text-center text-sm text-ink-600">
            New here?{' '}
            <Link to="/register" className="font-medium text-brand-700 hover:underline">
              Create an account
            </Link>
          </p>

          <p className="mt-3 text-center text-sm text-ink-600">
            Want to drive with us?{' '}
            <Link to="/driver-signup" className="font-medium text-brand-700 hover:underline">
              Sign up as a driver
            </Link>
          </p>

          <p className="mt-8 text-center text-xs text-ink-400">
            Administrator accounts are created by the operations team.
          </p>
        </div>
      </main>
    </div>
  )
}
