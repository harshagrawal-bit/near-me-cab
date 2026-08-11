import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { fleetService } from '@/services'
import { formatDate, formatPhone, initials } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconPlus, IconUsers } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[6-9]\d{9}$/

export default function MyDrivers() {
  const toast = useToast()
  const { data, loading, error, refetch } = useApi(() => fleetService.myDrivers(), [])
  const [addOpen, setAddOpen] = useState(false)

  const toggle = async (driver) => {
    const active = driver.status !== 'active'
    try {
      await fleetService.setDriverStatus(driver.id, active)
      toast.success(active ? 'Driver reactivated.' : 'Driver suspended.')
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="My drivers"
        description="People who drive for you. Each gets their own sign-in."
        action={
          <Button onClick={() => setAddOpen(true)}>
            <IconPlus className="h-4 w-4" />
            Add driver
          </Button>
        }
      />

      {loading ? (
        <SkeletonList count={3} lines={2} />
      ) : error ? (
        <ErrorState title="Could not load your drivers" error={error} onRetry={refetch} />
      ) : !data?.items?.length ? (
        <EmptyState
          icon={<IconUsers />}
          title="No drivers yet"
          description="Add a driver, or keep driving trips yourself."
          action={<Button onClick={() => setAddOpen(true)}>Add driver</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.items.map((driver) => (
            <Card key={driver.id}>
              <CardBody className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-100 text-sm font-semibold text-ink-600">
                    {initials(driver.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{driver.name}</p>
                    <p className="truncate text-xs text-ink-500">{formatPhone(driver.phone)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusBadge kind="verification" status={driver.verification_status} />
                      <Badge tone={driver.status === 'active' ? 'success' : 'neutral'}>
                        {driver.status === 'active' ? 'Active' : 'Suspended'}
                      </Badge>
                    </div>
                    <p className="mt-2 font-mono text-xs text-ink-400">
                      {driver.licence_number} · expires {formatDate(driver.licence_expiry)}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => toggle(driver)}>
                  {driver.status === 'active' ? 'Suspend' : 'Restore'}
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <AddDriverModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false)
          refetch()
        }}
      />
    </div>
  )
}

function AddDriverModal({ open, onClose, onAdded }) {
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
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const next = {}
    if (form.name.trim().length < 2) next.name = 'Enter the full name.'
    if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email address.'
    const phone = form.phone.replace(/\D/g, '').slice(-10)
    if (!PHONE_RE.test(phone)) next.phone = 'Enter a valid 10-digit mobile number.'
    if (form.password.length < 8) next.password = 'Use at least 8 characters.'
    if (form.licence_number.trim().length < 4)
      next.licence_number = 'Enter the licence number.'
    if (!form.licence_expiry) next.licence_expiry = 'Enter the licence expiry date.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    setFormError(null)
    try {
      await fleetService.addDriver({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone,
        password: form.password,
        licence_number: form.licence_number.trim().toUpperCase(),
        licence_expiry: form.licence_expiry,
      })
      toast.success('Driver added. Share their sign-in details with them.')
      setForm({
        name: '',
        email: '',
        phone: '',
        password: '',
        licence_number: '',
        licence_expiry: '',
      })
      onAdded()
    } catch (caught) {
      setFormError(caught.message)
      setErrors(caught.fieldErrors || {})
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a driver"
      description="They will be able to sign in and see only the trips you give them."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Add driver
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="sdname" error={errors.name} required>
            <Input
              id="sdname"
              value={form.name}
              invalid={Boolean(errors.name)}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Mobile number" htmlFor="sdphone" error={errors.phone} required>
            <Input
              id="sdphone"
              type="tel"
              inputMode="numeric"
              maxLength={13}
              value={form.phone}
              invalid={Boolean(errors.phone)}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Email address" htmlFor="sdemail" error={errors.email} required>
          <Input
            id="sdemail"
            type="email"
            value={form.email}
            invalid={Boolean(errors.email)}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </Field>

        <Field
          label="Temporary password"
          htmlFor="sdpassword"
          error={errors.password}
          hint="Share this with them. They can change it after signing in."
          required
        >
          <Input
            id="sdpassword"
            type="text"
            value={form.password}
            invalid={Boolean(errors.password)}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Licence number"
            htmlFor="sdlicence"
            error={errors.licence_number}
            required
          >
            <Input
              id="sdlicence"
              className="font-mono uppercase"
              value={form.licence_number}
              invalid={Boolean(errors.licence_number)}
              onChange={(event) => setForm({ ...form, licence_number: event.target.value })}
            />
          </Field>
          <Field
            label="Licence expiry"
            htmlFor="sdexpiry"
            error={errors.licence_expiry}
            required
          >
            <Input
              id="sdexpiry"
              type="date"
              value={form.licence_expiry}
              invalid={Boolean(errors.licence_expiry)}
              onChange={(event) => setForm({ ...form, licence_expiry: event.target.value })}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
