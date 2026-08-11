import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { authService, userService } from '@/services'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'
import { Alert, PageHeader } from '@/components/ui/States'
import { IconPlus, IconTrash } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/format'

const PHONE_RE = /^[6-9]\d{9}$/

export default function Profile() {
  const { user, updateUser } = useAuth()
  const toast = useToast()

  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [locations, setLocations] = useState([])
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    setForm({ name: user.name || '', email: user.email || '', phone: user.phone || '' })
    setLocations(user.saved_locations || [])
  }, [user])

  const saveProfile = async (event) => {
    event.preventDefault()
    setFormError(null)
    const next = {}
    if (form.name.trim().length < 2) next.name = 'Enter your full name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      next.email = 'Enter a valid email address.'
    const phone = form.phone.replace(/\D/g, '').slice(-10)
    if (!PHONE_RE.test(phone)) next.phone = 'Enter a valid 10-digit mobile number.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    try {
      const updated = await userService.updateProfile({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone,
      })
      updateUser(updated)
      toast.success('Profile updated.')
    } catch (caught) {
      setFormError(caught.message)
      setErrors(caught.fieldErrors || {})
    } finally {
      setSaving(false)
    }
  }

  const saveLocations = async (nextLocations) => {
    try {
      const updated = await userService.updateProfile({ saved_locations: nextLocations })
      updateUser(updated)
      setLocations(updated.saved_locations || [])
      toast.success('Saved locations updated.')
    } catch (caught) {
      toast.error(caught.message)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Profile"
        description="Your account details and saved addresses."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account details" />
          <CardBody>
            <form onSubmit={saveProfile} className="space-y-4" noValidate>
              {formError && <Alert tone="danger">{formError}</Alert>}

              <Field label="Full name" htmlFor="name" error={errors.name} required>
                <Input
                  id="name"
                  value={form.name}
                  invalid={Boolean(errors.name)}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>

              <Field label="Email address" htmlFor="email" error={errors.email} required>
                <Input
                  id="email"
                  type="email"
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
                  maxLength={13}
                  value={form.phone}
                  invalid={Boolean(errors.phone)}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                />
              </Field>

              <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
                <p className="text-xs text-ink-500">
                  Member since {formatDate(user?.created_at)}
                </p>
                <Button type="submit" loading={saving}>
                  Save changes
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <div className="space-y-5">
          <SavedLocations locations={locations} onChange={saveLocations} />
          <ChangePassword />
        </div>
      </div>
    </div>
  )
}

function SavedLocations({ locations, onChange }) {
  const [draft, setDraft] = useState({ label: '', address: '' })
  const [error, setError] = useState(null)

  const add = () => {
    if (draft.label.trim().length < 1 || draft.address.trim().length < 3) {
      setError('Give the place a short label and a full address.')
      return
    }
    if (locations.length >= 10) {
      setError('You can save up to 10 locations.')
      return
    }
    setError(null)
    onChange([
      ...locations,
      { label: draft.label.trim(), address: draft.address.trim(), lat: null, lng: null },
    ])
    setDraft({ label: '', address: '' })
  }

  const remove = (index) => onChange(locations.filter((_, i) => i !== index))

  return (
    <Card>
      <CardHeader
        title="Saved locations"
        description="One-tap pickup addresses when booking."
      />
      <CardBody className="space-y-4">
        {locations.length > 0 && (
          <ul className="space-y-2">
            {locations.map((location, index) => (
              <li
                key={`${location.label}-${index}`}
                className="flex items-start justify-between gap-3 rounded-lg border border-ink-200 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{location.label}</p>
                  <p className="mt-0.5 text-sm text-ink-500">{location.address}</p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="-m-1 shrink-0 rounded p-1 text-ink-400 hover:text-danger-600"
                  aria-label={`Remove ${location.label}`}
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="space-y-3 border-t border-ink-100 pt-4">
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Field label="Label" htmlFor="locationLabel">
              <Input
                id="locationLabel"
                placeholder="Home"
                maxLength={40}
                value={draft.label}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              />
            </Field>
            <Field label="Address" htmlFor="locationAddress">
              <Input
                id="locationAddress"
                placeholder="Lane 5, Koregaon Park, Pune"
                maxLength={200}
                value={draft.address}
                onChange={(event) => setDraft({ ...draft, address: event.target.value })}
              />
            </Field>
          </div>
          <Button variant="secondary" size="sm" onClick={add}>
            <IconPlus className="h-4 w-4" />
            Add location
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function ChangePassword() {
  const toast = useToast()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const next = {}
    if (!form.current) next.current = 'Enter your current password.'
    if (form.next.length < 8) next.next = 'Use at least 8 characters.'
    else if (/^\d+$/.test(form.next) || /^[a-zA-Z]+$/.test(form.next))
      next.next = 'Mix letters with a number or symbol.'
    if (form.next !== form.confirm) next.confirm = 'Passwords do not match.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    try {
      await authService.changePassword({
        current_password: form.current,
        new_password: form.next,
      })
      toast.success('Password updated.')
      setForm({ current: '', next: '', confirm: '' })
    } catch (caught) {
      setErrors({ current: caught.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Password" description="Change the password you sign in with." />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Current password" htmlFor="current" error={errors.current} required>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={form.current}
              invalid={Boolean(errors.current)}
              onChange={(event) => setForm({ ...form, current: event.target.value })}
            />
          </Field>
          <Field label="New password" htmlFor="next" error={errors.next} required>
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              value={form.next}
              invalid={Boolean(errors.next)}
              onChange={(event) => setForm({ ...form, next: event.target.value })}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm" error={errors.confirm} required>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              invalid={Boolean(errors.confirm)}
              onChange={(event) => setForm({ ...form, confirm: event.target.value })}
            />
          </Field>
          <Button type="submit" variant="secondary" loading={saving}>
            Update password
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
