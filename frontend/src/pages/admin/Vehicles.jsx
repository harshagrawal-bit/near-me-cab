import { useEffect, useState } from 'react'
import { useApi, useDebounced, useListState } from '@/hooks/useApi'
import { routeService, vehicleService } from '@/services'
import { VEHICLE_STATUS_META } from '@/lib/constants'
import Button from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import { Checkbox, Field, Input, Select } from '@/components/ui/Field'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Alert, EmptyState, PageHeader } from '@/components/ui/States'
import { IconCar, IconEdit, IconPlus, IconSearch, IconTrash } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

const EMPTY_FORM = {
  vehicle_type: 'sedan',
  model: '',
  registration_number: '',
  seating_capacity: 4,
  is_ac: true,
  status: 'available',
}

export default function AdminVehicles() {
  const toast = useToast()
  const { page, setPage, filters, setFilters } = useListState({})
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput, 350)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

  const { data: classes } = useApi(() => routeService.vehicleClasses(), [])
  const { data, loading, error, refetch } = useApi(
    () => vehicleService.list({ ...filters, search: search || undefined, page, page_size: 20 }),
    [filters, search, page],
  )

  const remove = async () => {
    setBusy(true)
    try {
      await vehicleService.remove(deleting.id)
      toast.success('Vehicle deleted.')
      setDeleting(null)
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const columns = [
    {
      key: 'model',
      header: 'Vehicle',
      card: 'title',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{row.model}</p>
          <p className="mt-0.5 font-mono text-xs tracking-wide text-ink-500">
            {row.registration_number}
          </p>
        </div>
      ),
    },
    {
      key: 'vehicle_type',
      header: 'Class',
      render: (row) => row.class_info?.label || row.vehicle_type,
    },
    {
      key: 'seating_capacity',
      header: 'Seats',
      align: 'center',
      render: (row) => <span className="tabular">{row.seating_capacity}</span>,
    },
    {
      key: 'is_ac',
      header: 'AC',
      render: (row) => (
        <Badge tone={row.is_ac ? 'info' : 'neutral'} dot={false}>
          {row.is_ac ? 'AC' : 'Non-AC'}
        </Badge>
      ),
    },
    {
      key: 'driver',
      header: 'Driver',
      render: (row) =>
        row.assigned_driver_name || <span className="text-ink-400">Unassigned</span>,
    },
    {
      key: 'status',
      header: 'Status',
      card: 'aside',
      render: (row) => <StatusBadge kind="vehicle" status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      card: 'hidden',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setEditing(row)
            }}
            className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            aria-label={`Edit ${row.model}`}
          >
            <IconEdit className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setDeleting(row)
            }}
            className="rounded-md p-1.5 text-ink-500 hover:bg-danger-50 hover:text-danger-600"
            aria-label={`Delete ${row.model}`}
          >
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vehicles"
        description="Your fleet and its current status."
        action={
          <Button onClick={() => setEditing({})}>
            <IconPlus className="h-4 w-4" />
            Add vehicle
          </Button>
        }
      />

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              className="pl-9"
              placeholder="Search model or registration"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search vehicles"
            />
          </div>
          <Field label="Status" htmlFor="vstatus" className="w-44">
            <Select
              id="vstatus"
              value={filters.status || ''}
              placeholder="Any status"
              onChange={(event) => setFilters({ status: event.target.value || undefined })}
            >
              {Object.entries(VEHICLE_STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Class" htmlFor="vtype" className="w-44">
            <Select
              id="vtype"
              value={filters.vehicle_type || ''}
              placeholder="Any class"
              onChange={(event) => setFilters({ vehicle_type: event.target.value || undefined })}
            >
              {(classes || []).map((item) => (
                <option key={item.vehicle_type} value={item.vehicle_type}>
                  {item.label}
                </option>
              ))}
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
        empty={
          <EmptyState
            icon={<IconCar />}
            title="No vehicles yet"
            description="Add the cars you operate so they can be assigned to drivers."
            action={<Button onClick={() => setEditing({})}>Add vehicle</Button>}
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

      <VehicleModal
        open={Boolean(editing)}
        vehicle={editing?.id ? editing : null}
        classes={classes || []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          refetch()
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        loading={busy}
        title="Delete this vehicle?"
        message={`${deleting?.model} (${deleting?.registration_number}) will be removed. Vehicles that appear on bookings cannot be deleted — set them inactive instead.`}
        confirmLabel="Delete vehicle"
      />
    </div>
  )
}

function VehicleModal({ open, vehicle, classes, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setFormError(null)
    setForm(
      vehicle
        ? {
            vehicle_type: vehicle.vehicle_type,
            model: vehicle.model,
            registration_number: vehicle.registration_number,
            seating_capacity: vehicle.seating_capacity,
            is_ac: vehicle.is_ac,
            status: vehicle.status,
          }
        : EMPTY_FORM,
    )
  }, [open, vehicle])

  const submit = async () => {
    const next = {}
    if (form.model.trim().length < 2) next.model = 'Enter the make and model.'
    if (form.registration_number.trim().length < 4)
      next.registration_number = 'Enter the registration number.'
    if (!form.seating_capacity || form.seating_capacity < 1)
      next.seating_capacity = 'Enter the seating capacity.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        vehicle_type: form.vehicle_type,
        model: form.model.trim(),
        registration_number: form.registration_number.trim().toUpperCase(),
        seating_capacity: Number(form.seating_capacity),
        is_ac: form.is_ac,
        status: form.status,
      }
      if (vehicle) await vehicleService.update(vehicle.id, payload)
      else await vehicleService.create(payload)
      toast.success(vehicle ? 'Vehicle updated.' : 'Vehicle added.')
      onSaved()
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
      title={vehicle ? 'Edit vehicle' : 'Add a vehicle'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {vehicle ? 'Save changes' : 'Add vehicle'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Field label="Make and model" htmlFor="model" error={errors.model} required>
          <Input
            id="model"
            placeholder="Toyota Innova Crysta"
            value={form.model}
            invalid={Boolean(errors.model)}
            onChange={(event) => setForm({ ...form, model: event.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Registration number"
            htmlFor="registration"
            error={errors.registration_number}
            required
          >
            <Input
              id="registration"
              className="font-mono uppercase"
              placeholder="MH12AB1234"
              maxLength={16}
              value={form.registration_number}
              invalid={Boolean(errors.registration_number)}
              onChange={(event) =>
                setForm({ ...form, registration_number: event.target.value })
              }
            />
          </Field>
          <Field label="Vehicle class" htmlFor="vehicleType" required>
            <Select
              id="vehicleType"
              value={form.vehicle_type}
              onChange={(event) => {
                const chosen = classes.find((item) => item.vehicle_type === event.target.value)
                setForm({
                  ...form,
                  vehicle_type: event.target.value,
                  seating_capacity: chosen?.seating_capacity || form.seating_capacity,
                })
              }}
            >
              {classes.map((item) => (
                <option key={item.vehicle_type} value={item.vehicle_type}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Seating capacity"
            htmlFor="seats"
            error={errors.seating_capacity}
            required
          >
            <Input
              id="seats"
              type="number"
              min="1"
              max="30"
              className="tabular"
              value={form.seating_capacity}
              invalid={Boolean(errors.seating_capacity)}
              onChange={(event) =>
                setForm({ ...form, seating_capacity: event.target.value })
              }
            />
          </Field>
          <Field label="Status" htmlFor="vehicleStatus">
            <Select
              id="vehicleStatus"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              {Object.entries(VEHICLE_STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Checkbox
          label="Air conditioned"
          description="Shown to customers when choosing a vehicle."
          checked={form.is_ac}
          onChange={(event) => setForm({ ...form, is_ac: event.target.checked })}
        />
      </div>
    </Modal>
  )
}
