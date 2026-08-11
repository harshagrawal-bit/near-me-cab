import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { fleetService } from '@/services'
import { formatCurrency, formatDateTime, titleCase } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconInbox, IconPin } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

export default function OpenTrips() {
  const { data, loading, error, refetch } = useApi(() => fleetService.openBookings(), [])
  const { data: wallet, refetch: refetchWallet } = useApi(() => fleetService.wallet(), [])
  const [accepting, setAccepting] = useState(null)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Open trips"
        description="Confirmed and paid trips waiting for a fleet. First to accept gets it."
      />

      {wallet && !wallet.eligible && (
        <Alert tone="warning" title="You cannot accept trips yet">
          {wallet.reason}
        </Alert>
      )}

      {loading ? (
        <SkeletonList count={3} lines={3} />
      ) : error ? (
        <ErrorState title="Could not load open trips" error={error} onRetry={refetch} />
      ) : !data?.items?.length ? (
        <EmptyState
          icon={<IconInbox />}
          title="Nothing available right now"
          description="New trips appear here once a customer has paid their advance."
        />
      ) : (
        <div className="space-y-3">
          {data.items.map((trip) => (
            <Card key={trip.id}>
              <CardBody className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-500">{trip.booking_id}</span>
                    <Badge tone="info">{titleCase(trip.vehicle_type)}</Badge>
                    <Badge tone="neutral">{titleCase(trip.trip_type)}</Badge>
                  </div>
                  <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-ink-900">
                    <IconPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                    <span className="min-w-0">
                      {trip.pickup?.address} <span className="text-ink-400">→</span>{' '}
                      {trip.drop?.address}
                    </span>
                  </p>
                  <p className="mt-1.5 text-sm text-ink-500">
                    {formatDateTime(trip.scheduled_at)} · {trip.passenger_count} passengers
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-lg font-semibold tabular text-ink-900">
                    {formatCurrency(trip.total_fare)}
                  </p>
                  {/* Show the commitment before they tap, not after it fails. */}
                  <p className="mt-0.5 text-xs text-ink-500">
                    Holds {formatCurrency(trip.wallet_required)}
                  </p>
                  <Button
                    size="sm"
                    className="mt-2.5"
                    disabled={!wallet?.eligible}
                    onClick={() => setAccepting(trip)}
                  >
                    Accept trip
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <AcceptModal
        trip={accepting}
        onClose={() => setAccepting(null)}
        onAccepted={() => {
          setAccepting(null)
          refetch()
          refetchWallet()
        }}
      />
    </div>
  )
}

function AcceptModal({ trip, onClose, onAccepted }) {
  const toast = useToast()
  const navigate = useNavigate()
  const open = Boolean(trip)

  const { data: vehicles } = useApi(() => fleetService.myVehicles(), [], { enabled: open })
  const { data: drivers } = useApi(() => fleetService.myDrivers(), [], { enabled: open })
  const { data: me } = useApi(() => fleetService.wallet(), [], { enabled: open })

  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  // Preselect the only sensible choice so a one-car, one-driver owner does not
  // have to make two meaningless selections on every trip.
  useEffect(() => {
    const list = vehicles?.items || []
    if (list.length === 1) setVehicleId(list[0].id)
  }, [vehicles])

  useEffect(() => {
    if (me?.driver_id) setDriverId(me.driver_id)
  }, [me])

  const submit = async () => {
    if (!vehicleId) return setFormError('Choose a vehicle.')
    if (!driverId) return setFormError('Choose who will drive.')

    setSaving(true)
    setFormError(null)
    try {
      const booking = await fleetService.acceptBooking(trip.id, {
        vehicle_id: vehicleId,
        driver_id: driverId,
      })
      toast.success('Trip accepted.')
      onAccepted()
      navigate(`/driver/trips/${booking.id}`)
    } catch (caught) {
      setFormError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  const activeDrivers = (drivers?.items || []).filter((d) => d.status === 'active')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Accept this trip"
      description={
        trip
          ? `${formatCurrency(trip.wallet_required)} will be held from your wallet until the trip ends.`
          : ''
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Accept trip
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Field label="Vehicle" htmlFor="vehicle" required>
          <Select
            id="vehicle"
            value={vehicleId}
            placeholder="Choose a vehicle"
            onChange={(event) => setVehicleId(event.target.value)}
          >
            {(vehicles?.items || []).map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.model} · {vehicle.registration_number}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Driver"
          htmlFor="driver"
          hint="Yourself, or one of your drivers."
          required
        >
          <Select
            id="driver"
            value={driverId}
            placeholder="Choose a driver"
            onChange={(event) => setDriverId(event.target.value)}
          >
            {me?.driver_id && <option value={me.driver_id}>Myself</option>}
            {activeDrivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name}
              </option>
            ))}
          </Select>
        </Field>

        {!(vehicles?.items || []).length && (
          <Alert tone="warning">
            You have no vehicles yet. Add one before accepting a trip.
          </Alert>
        )}
      </div>
    </Modal>
  )
}
