import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { authService, driverService } from '@/services'
import { useAuth } from '@/auth/AuthContext'
import { formatDate, formatPhone, initials } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader, DetailList, DetailRow } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Field'
import { ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonCard } from '@/components/ui/Loaders'
import { IconStar, IconStarFilled } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

const PHONE_RE = /^[6-9]\d{9}$/

export default function DriverProfile() {
  const toast = useToast()
  const { updateUser } = useAuth()
  const { data: driver, loading, error, refetch } = useApi(() => driverService.me(), [])

  const [form, setForm] = useState({ name: '', phone: '' })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!driver) return
    setForm({ name: driver.name || '', phone: driver.phone || '' })
  }, [driver])

  if (loading) return <SkeletonCard lines={8} />
  if (error) return <ErrorState title="Could not load your profile" error={error} onRetry={refetch} />

  const save = async (event) => {
    event.preventDefault()
    const next = {}
    if (form.name.trim().length < 2) next.name = 'Enter your full name.'
    const phone = form.phone.replace(/\D/g, '').slice(-10)
    if (!PHONE_RE.test(phone)) next.phone = 'Enter a valid 10-digit mobile number.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    try {
      const updated = await driverService.updateMe({ name: form.name.trim(), phone })
      updateUser({ name: updated.name, phone: updated.phone })
      toast.success('Profile updated.')
      refetch()
    } catch (caught) {
      setErrors({ name: caught.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Profile" description="Your driver account and vehicle." />

      <Card>
        <CardBody>
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold text-white">
              {initials(driver.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-ink-900">{driver.name}</p>
              <p className="truncate text-sm text-ink-500">{driver.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge kind="verification" status={driver.verification_status} />
                <StatusBadge kind="account" status={driver.status} />
                {driver.rating_count > 0 && (
                  <Badge tone="warning" dot={false}>
                    <IconStarFilled className="h-3 w-3" />
                    {driver.rating_avg} ({driver.rating_count})
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contact details" description="Editable by you." />
          <CardBody>
            <form onSubmit={save} className="space-y-4" noValidate>
              <Field label="Full name" htmlFor="name" error={errors.name} required>
                <Input
                  id="name"
                  value={form.name}
                  invalid={Boolean(errors.name)}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
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
              <Button type="submit" loading={saving}>
                Save changes
              </Button>
            </form>
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Assigned vehicle"
              description="Changes are made by the operations team."
            />
            <CardBody>
              {driver.vehicle ? (
                <DetailList>
                  <DetailRow label="Model" value={driver.vehicle.model} />
                  <DetailRow
                    label="Registration"
                    value={driver.vehicle.registration_number}
                    valueClassName="font-mono"
                  />
                  <DetailRow label="Class" value={driver.vehicle.class_info?.label} />
                  <DetailRow
                    label="Seats"
                    value={`${driver.vehicle.seating_capacity} passengers`}
                  />
                  <DetailRow label="AC" value={driver.vehicle.is_ac ? 'Yes' : 'No'} />
                  <DetailRow
                    label="Status"
                    value={<StatusBadge kind="vehicle" status={driver.vehicle.status} />}
                  />
                </DetailList>
              ) : (
                <p className="text-sm text-ink-500">
                  No vehicle is assigned to you yet. Contact the operations team.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Account" />
            <CardBody>
              <DetailList>
                <DetailRow label="Licence" value={driver.licence_number} valueClassName="font-mono" />
                <DetailRow label="Licence expiry" value={formatDate(driver.licence_expiry)} />
                <DetailRow label="Total trips" value={driver.total_trips} />
                <DetailRow label="Contact" value={formatPhone(driver.phone)} />
                <DetailRow label="Joined" value={formatDate(driver.created_at)} />
              </DetailList>
              {/* The bottom bar only holds five items, so the rest of an
                  owner's tools live here. */}
              <div className="mt-4 grid gap-2">
                <Link to="/driver/documents">
                  <Button variant="secondary" fullWidth size="sm">
                    View documents
                  </Button>
                </Link>
                {driver.driver_type !== 'employed' && (
                  <>
                    <Link to="/driver/vehicles">
                      <Button variant="secondary" fullWidth size="sm">
                        My vehicles
                      </Button>
                    </Link>
                    <Link to="/driver/my-drivers">
                      <Button variant="secondary" fullWidth size="sm">
                        My drivers
                      </Button>
                    </Link>
                    <Link to="/driver/earnings">
                      <Button variant="secondary" fullWidth size="sm">
                        Earnings
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </CardBody>
          </Card>

          <ChangePassword />
        </div>
      </div>
    </div>
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
      <CardHeader title="Password" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Current password" htmlFor="dcurrent" error={errors.current} required>
            <Input
              id="dcurrent"
              type="password"
              autoComplete="current-password"
              value={form.current}
              invalid={Boolean(errors.current)}
              onChange={(event) => setForm({ ...form, current: event.target.value })}
            />
          </Field>
          <Field label="New password" htmlFor="dnext" error={errors.next} required>
            <Input
              id="dnext"
              type="password"
              autoComplete="new-password"
              value={form.next}
              invalid={Boolean(errors.next)}
              onChange={(event) => setForm({ ...form, next: event.target.value })}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="dconfirm" error={errors.confirm} required>
            <Input
              id="dconfirm"
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
