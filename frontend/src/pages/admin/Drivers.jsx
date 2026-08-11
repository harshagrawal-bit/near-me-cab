import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi, useDebounced, useListState } from '@/hooks/useApi'
import { driverService, vehicleService } from '@/services'
import { VERIFICATION_STATUS_META } from '@/lib/constants'
import { formatDate, formatPhone, initials, toDateInputValue } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Alert, EmptyState, PageHeader } from '@/components/ui/States'
import { IconPlus, IconSearch, IconStar, IconStarFilled, IconUsers } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

export default function AdminDrivers() {
  const navigate = useNavigate()
  const { page, setPage, filters, setFilters } = useListState({})
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput, 350)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, loading, error, refetch } = useApi(
    () => driverService.list({ ...filters, search: search || undefined, page, page_size: 20 }),
    [filters, search, page],
  )

  const columns = [
    {
      key: 'name',
      header: 'Driver',
      card: 'title',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
            {initials(row.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">{row.name}</p>
            <p className="truncate text-xs text-ink-500">{row.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (row) => formatPhone(row.phone) },
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (row) =>
        row.vehicle ? (
          <div className="min-w-0">
            <p className="truncate text-ink-800">{row.vehicle.model}</p>
            <p className="truncate font-mono text-xs text-ink-500">
              {row.vehicle.registration_number}
            </p>
          </div>
        ) : (
          <span className="text-ink-400">Unassigned</span>
        ),
    },
    {
      key: 'licence',
      header: 'Licence expiry',
      render: (row) => formatDate(row.licence_expiry),
    },
    {
      key: 'trips',
      header: 'Trips',
      align: 'right',
      render: (row) => (
        <div className="whitespace-nowrap">
          <span className="tabular font-medium">{row.total_trips}</span>
          {row.rating_count > 0 && (
            <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-ink-500">
              <IconStarFilled className="h-3 w-3 text-warning-600" />
              {row.rating_avg}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'availability',
      header: 'Availability',
      render: (row) => (
        <Badge tone={row.is_available ? 'success' : 'neutral'}>
          {row.is_available ? 'Online' : 'Offline'}
        </Badge>
      ),
    },
    {
      key: 'verification_status',
      header: 'Verification',
      card: 'aside',
      render: (row) => <StatusBadge kind="verification" status={row.verification_status} />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Drivers"
        description="Onboard, verify and manage your driver roster."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <IconPlus className="h-4 w-4" />
            Add driver
          </Button>
        }
      />

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              className="pl-9"
              placeholder="Search name, email, phone or licence"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search drivers"
            />
          </div>
          <Field label="Verification" htmlFor="verification" className="w-48">
            <Select
              id="verification"
              value={filters.verification_status || ''}
              placeholder="Any"
              onChange={(event) =>
                setFilters({ verification_status: event.target.value || undefined })
              }
            >
              {Object.entries(VERIFICATION_STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Availability" htmlFor="availability" className="w-40">
            <Select
              id="availability"
              value={filters.is_available === undefined ? '' : String(filters.is_available)}
              placeholder="Any"
              onChange={(event) =>
                setFilters({
                  is_available: event.target.value === '' ? undefined : event.target.value === 'true',
                })
              }
            >
              <option value="true">Online</option>
              <option value="false">Offline</option>
            </Select>
          </Field>
        </CardBody>
      </Card>

      <DataTable
        columns={columns}
        rows={data?.items}
        loading={loading}
        error={error}
        onRetry={refetch}
        onRowClick={(row) => navigate(`/admin/drivers/${row.id}`)}
        empty={
          <EmptyState
            icon={<IconUsers />}
            title="No drivers yet"
            description="Add your first driver to start assigning trips."
            action={<Button onClick={() => setCreateOpen(true)}>Add driver</Button>}
          />
        }
      />

      {data && (
        <Pagination
          page={data.page}
          pages={data.pages}
          total={data.total}
          pageSize={data.page_size}
          onPageChange={setPage}
        />
      )}

      <CreateDriverModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          refetch()
        }}
      />
    </div>
  )
}

function CreateDriverModal({ open, onClose, onCreated }) {
  const toast = useToast()
  const { data: vehicles } = useApi(() => vehicleService.list({ page_size: 100 }), [], {
    enabled: open,
  })

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    licence_number: '',
    licence_expiry: '',
    assigned_vehicle_id: '',
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const next = {}
    if (form.name.trim().length < 2) next.name = 'Enter the full name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      next.email = 'Enter a valid email address.'
    const phone = form.phone.replace(/\D/g, '').slice(-10)
    if (!/^[6-9]\d{9}$/.test(phone)) next.phone = 'Enter a valid 10-digit mobile number.'
    if (form.password.length < 8) next.password = 'Use at least 8 characters.'
    if (form.licence_number.trim().length < 4) next.licence_number = 'Enter the licence number.'
    if (!form.licence_expiry) next.licence_expiry = 'Enter the licence expiry date.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    setFormError(null)
    try {
      await driverService.create({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone,
        password: form.password,
        licence_number: form.licence_number.trim().toUpperCase(),
        licence_expiry: form.licence_expiry,
        assigned_vehicle_id: form.assigned_vehicle_id || undefined,
      })
      toast.success('Driver created. Verify their documents to let them go online.')
      setForm({
        name: '',
        email: '',
        phone: '',
        password: '',
        licence_number: '',
        licence_expiry: '',
        assigned_vehicle_id: '',
      })
      onCreated()
    } catch (caught) {
      setFormError(caught.message)
      setErrors(caught.fieldErrors || {})
    } finally {
      setSaving(false)
    }
  }

  const freeVehicles = (vehicles?.items || []).filter(
    (vehicle) => !vehicle.assigned_driver_id && vehicle.status !== 'inactive',
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a driver"
      description="Creates a driver login. They start unverified until you approve their documents."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Create driver
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="dname" error={errors.name} required>
            <Input
              id="dname"
              value={form.name}
              invalid={Boolean(errors.name)}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Mobile number" htmlFor="dphone" error={errors.phone} required>
            <Input
              id="dphone"
              type="tel"
              inputMode="numeric"
              maxLength={13}
              value={form.phone}
              invalid={Boolean(errors.phone)}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Email address" htmlFor="demail" error={errors.email} required>
          <Input
            id="demail"
            type="email"
            value={form.email}
            invalid={Boolean(errors.email)}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </Field>

        <Field
          label="Temporary password"
          htmlFor="dpassword"
          error={errors.password}
          hint="Share this with the driver. They can change it after signing in."
          required
        >
          <Input
            id="dpassword"
            type="text"
            value={form.password}
            invalid={Boolean(errors.password)}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Licence number"
            htmlFor="dlicence"
            error={errors.licence_number}
            required
          >
            <Input
              id="dlicence"
              className="font-mono uppercase"
              value={form.licence_number}
              invalid={Boolean(errors.licence_number)}
              onChange={(event) => setForm({ ...form, licence_number: event.target.value })}
            />
          </Field>
          <Field
            label="Licence expiry"
            htmlFor="dexpiry"
            error={errors.licence_expiry}
            required
          >
            <Input
              id="dexpiry"
              type="date"
              min={toDateInputValue(new Date())}
              value={form.licence_expiry}
              invalid={Boolean(errors.licence_expiry)}
              onChange={(event) => setForm({ ...form, licence_expiry: event.target.value })}
            />
          </Field>
        </div>

        <Field
          label="Assign a vehicle"
          htmlFor="dvehicle"
          optionalLabel
          hint="Only unassigned vehicles are listed. You can do this later."
        >
          <Select
            id="dvehicle"
            value={form.assigned_vehicle_id}
            placeholder="No vehicle for now"
            onChange={(event) => setForm({ ...form, assigned_vehicle_id: event.target.value })}
          >
            {freeVehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.model} · {vehicle.registration_number}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}
