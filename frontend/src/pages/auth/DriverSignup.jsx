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

/** Tomorrow, as a yyyy-mm-dd string — the earliest a licence may expire. */
function tomorrow() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
}

export default function DriverSignup() {
  const { registerDriver, isAuthenticated, role, initialising } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    licence_number: '',
    licence_expiry: '',
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (initialising) return <FullPageLoader />
  if (isAuthenticated) return <Navigate to={homePathFor(role)} replace />

  /** Mirrors the backend rules so mistakes surface before a round trip. */
  const validate = () => {
    const next = {}
    if (form.name.trim().length < 2) next.name = 'Enter your full name.'
    if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email address.'
    const phone = form.phone.replace(/\D/g, '').slice(-10)
    if (!PHONE_RE.test(phone)) next.phone = 'Enter a valid 10-digit mobile number.'
    if (form.password.length < 8) next.password = 'Use at least 8 characters.'
    else if (/^\d+$/.test(form.password) || /^[a-zA-Z]+$/.test(form.password))
      next.password = 'Mix letters with a number or symbol.'
    if (form.licence_number.trim().length < 4)
      next.licence_number = 'Enter your driving licence number.'
    if (!form.licence_expiry) next.licence_expiry = 'Enter the licence expiry date.'
    else if (form.licence_expiry <= new Date().toISOString().slice(0, 10))
      next.licence_expiry = 'That licence has already expired.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setFormError(null)
    if (!validate()) return
    setSubmitting(true)
    try {
      const user = await registerDriver({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.replace(/\D/g, '').slice(-10),
        password: form.password,
        licence_number: form.licence_number.trim().toUpperCase(),
        licence_expiry: form.licence_expiry,
      })
      toast.success('Driver account created. Upload your documents to get verified.')
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
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">
            Sign up as a driver
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Register your own vehicles, add drivers who work with you, and accept trips.
          </p>

          {/* Set expectations before they fill anything in — nobody enjoys
              discovering a deposit requirement after signing up. */}
          <ol className="mt-5 space-y-2 rounded-lg bg-ink-50 p-4 text-sm text-ink-600">
            <li className="flex gap-2.5">
              <span className="font-semibold text-brand-600">1</span>
              Create your account
            </li>
            <li className="flex gap-2.5">
              <span className="font-semibold text-brand-600">2</span>
              Upload your licence and documents for verification
            </li>
            <li className="flex gap-2.5">
              <span className="font-semibold text-brand-600">3</span>
              Add a security deposit to your wallet
            </li>
            <li className="flex gap-2.5">
              <span className="font-semibold text-brand-600">4</span>
              Start accepting trips
            </li>
          </ol>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            {formError && <Alert tone="danger">{formError}</Alert>}

            <Field label="Full name" htmlFor="name" error={errors.name} required>
              <Input
                id="name"
                autoComplete="name"
                placeholder="Sandeep Kulkarni"
                value={form.name}
                invalid={Boolean(errors.name)}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>

            <Field label="Email address" htmlFor="email" error={errors.email} required>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                invalid={Boolean(errors.email)}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>

            <Field label="Mobile number" htmlFor="phone" error={errors.phone} required>
              <Input
                id="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={13}
                placeholder="98220 11001"
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
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={form.password}
                invalid={Boolean(errors.password)}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Licence number"
                htmlFor="licence_number"
                error={errors.licence_number}
                required
              >
                <Input
                  id="licence_number"
                  className="font-mono uppercase"
                  placeholder="MH1220190001234"
                  value={form.licence_number}
                  invalid={Boolean(errors.licence_number)}
                  onChange={(event) =>
                    setForm({ ...form, licence_number: event.target.value })
                  }
                />
              </Field>
              <Field
                label="Licence expiry"
                htmlFor="licence_expiry"
                error={errors.licence_expiry}
                required
              >
                <Input
                  id="licence_expiry"
                  type="date"
                  min={tomorrow()}
                  value={form.licence_expiry}
                  invalid={Boolean(errors.licence_expiry)}
                  onChange={(event) =>
                    setForm({ ...form, licence_expiry: event.target.value })
                  }
                />
              </Field>
            </div>

            <Button type="submit" fullWidth size="lg" loading={submitting}>
              Create driver account
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-ink-500">
            Already registered?{' '}
            <Link to="/login" className="font-medium text-brand-700 hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <p className="mt-5 text-center text-sm text-ink-500">
          Looking to book a trip instead?{' '}
          <Link to="/register" className="font-medium text-brand-700 hover:underline">
            Create a customer account
          </Link>
        </p>
      </div>
    </div>
  )
}
