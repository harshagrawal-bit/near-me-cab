import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { homePathFor, useAuth } from '@/auth/AuthContext'
import Logo from '@/components/brand/Logo'
import Button from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Alert } from '@/components/ui/States'
import { FullPageLoader } from '@/components/ui/Loaders'
import { useToast } from '@/components/ui/Toast'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[6-9]\d{9}$/

export default function Register() {
  const { register, isAuthenticated, role, initialising } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (initialising) return <FullPageLoader />
  if (isAuthenticated) return <Navigate to={homePathFor(role)} replace />

  /** Mirrors the backend rules so users get feedback before a round trip. */
  const validate = () => {
    const next = {}
    if (form.name.trim().length < 2) next.name = 'Enter your full name.'
    if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email address.'
    const phone = form.phone.replace(/\D/g, '').slice(-10)
    if (!PHONE_RE.test(phone)) next.phone = 'Enter a valid 10-digit Indian mobile number.'
    if (form.password.length < 8) next.password = 'Use at least 8 characters.'
    else if (/^\d+$/.test(form.password) || /^[a-zA-Z]+$/.test(form.password))
      next.password = 'Mix letters with a number or symbol.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setFormError(null)
    if (!validate()) return
    setSubmitting(true)
    try {
      const user = await register({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.replace(/\D/g, '').slice(-10),
        password: form.password,
      })
      toast.success('Account created. Welcome aboard.')
      navigate(homePathFor(user.role), { replace: true })
    } catch (error) {
      setFormError(error.message)
      setErrors(error.fieldErrors || {})
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-ink-50 px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="flex justify-center">
          <Logo to={null} showTagline />
        </div>

        <div className="mt-7 rounded-card border border-ink-200 bg-white p-6 shadow-card sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Create your account</h1>
          <p className="mt-1 text-sm text-ink-500">
            Takes under a minute. You will be able to book straight away.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            {formError && <Alert tone="danger">{formError}</Alert>}

            <Field label="Full name" htmlFor="name" error={errors.name} required>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                placeholder="Aarti Joshi"
                value={form.name}
                invalid={Boolean(errors.name)}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>

            <Field label="Email address" htmlFor="email" error={errors.email} required>
              <Input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                invalid={Boolean(errors.email)}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>

            <Field
              label="Mobile number"
              htmlFor="phone"
              error={errors.phone}
              hint="We use this to reach you about your trip."
              required
            >
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={13}
                placeholder="98765 43210"
                value={form.phone}
                invalid={Boolean(errors.phone)}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </Field>

            <Field
              label="Password"
              htmlFor="password"
              error={errors.password}
              hint="At least 8 characters, mixing letters with a number or symbol."
              required
            >
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={form.password}
                invalid={Boolean(errors.password)}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </Field>

            <Button type="submit" fullWidth size="lg" loading={submitting}>
              Create account
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-ink-600">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
