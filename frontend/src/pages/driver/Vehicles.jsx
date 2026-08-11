import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { fleetService, routeService } from '@/services'
import { titleCase } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconCar, IconPlus, IconTrash } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

const PLATE_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/

export default function DriverVehicles() {
  const toast = useToast()
  const { data, loading, error, refetch } = useApi(() => fleetService.myVehicles(), [])
  const [addOpen, setAddOpen] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      await fleetService.removeVehicle(removing.id)
      toast.success('Vehicle removed.')
      setRemoving(null)
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="My vehicles"
        description="The cars you can put on a trip."
        action={
          <Button onClick={() => setAddOpen(true)}>
            <IconPlus className="h-4 w-4" />
            Add vehicle
          </Button>
        }
      />

      {loading ? (
        <SkeletonList count={3} lines={2} />
      ) : error ? (
        <ErrorState title="Could not load your vehicles" error={error} onRetry={refetch} />
      ) : !data?.items?.length ? (
        <EmptyState
          icon={<IconCar />}
          title="No vehicles yet"
          description="Add a vehicle so you can start accepting trips."
          action={<Button onClick={() => setAddOpen(true)}>Add vehicle</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.items.map((vehicle) => (
            <Card key={vehicle.id}>
              <CardBody className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900">{vehicle.model}</p>
                  <p className="mt-0.5 font-mono text-sm text-ink-500">
                    {vehicle.registration_number}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                    <StatusBadge kind="vehicle" status={vehicle.status} />
                    <span>{titleCase(vehicle.vehicle_type)}</span>
                    <span>· {vehicle.seating_capacity} seats</span>
                    <span>· {vehicle.is_ac ? 'AC' : 'Non-AC'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setRemoving(vehicle)}
                  className="shrink-0 rounded-md p-2 text-ink-500 hover:bg-danger-50 hover:text-danger-600"
                  aria-label={`Remove ${vehicle.model}`}
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <AddVehicleModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false)
          refetch()
        }}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        loading={busy}
        title="Remove this vehicle?"
        message={`${removing?.model || ''} will no longer be available for trips.`}
        confirmLabel="Remove vehicle"
      />
    </div>
  )
}

function AddVehicleModal({ open, onClose, onAdded }) {
  const toast = useToast()
  // Classes come from the backend so the list never drifts from what the
  // price book actually supports.
  const { data: classes } = useApi(() => routeService.vehicleClasses(), [], { enabled: open })
  const [form, setForm] = useState({
    vehicle_type: 'sedan',
    model: '',
    registration_number: '',
    seating_capacity: 4,
    is_ac: true,
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const next = {}
    if (form.model.trim().length < 2) next.model = 'Enter the make and model.'
    const plate = form.registration_number.toUpperCase().replace(/[\s-]/g, '')
    if (!PLATE_RE.test(plate))
      next.registration_number = 'Enter a valid registration, e.g. MH12AB1234.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    setFormError(null)
    try {
      await fleetService.addVehicle({
        vehicle_type: form.vehicle_type,
        model: form.model.trim(),
        registration_number: plate,
        seating_capacity: Number(form.seating_capacity),
        is_ac: form.is_ac,
      })
      toast.success('Vehicle added.')
      setForm({
        vehicle_type: 'sedan',
        model: '',
        registration_number: '',
        seating_capacity: 4,
        is_ac: true,
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
      title="Add a vehicle"
      description="It becomes selectable as soon as you accept a trip."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Add vehicle
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Field label="Make and model" htmlFor="model" error={errors.model} required>
          <Input
            id="model"
            placeholder="Maruti Suzuki Dzire"
            value={form.model}
            invalid={Boolean(errors.model)}
            onChange={(event) => setForm({ ...form, model: event.target.value })}
          />
        </Field>

        <Field
          label="Registration number"
          htmlFor="plate"
          error={errors.registration_number}
          hint="As printed on the number plate."
          required
        >
          <Input
            id="plate"
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Class" htmlFor="vtype">
            <Select
              id="vtype"
              value={form.vehicle_type}
              onChange={(event) => setForm({ ...form, vehicle_type: event.target.value })}
            >
              {(classes || []).map((item) => (
                <option key={item.vehicle_type} value={item.vehicle_type}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Seats" htmlFor="seats">
            <Input
              id="seats"
              type="number"
              min={1}
              max={30}
              value={form.seating_capacity}
              onChange={(event) =>
                setForm({ ...form, seating_capacity: event.target.value })
              }
            />
          </Field>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={form.is_ac}
            onChange={(event) => setForm({ ...form, is_ac: event.target.checked })}
            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
          />
          Air conditioned
        </label>
      </div>
    </Modal>
  )
}
