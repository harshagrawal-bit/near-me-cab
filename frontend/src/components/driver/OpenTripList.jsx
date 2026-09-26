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
import { Alert, EmptyState } from '@/components/ui/States'
import { IconInbox } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'
import TopUpToAcceptModal from '@/components/driver/TopUpToAcceptModal'

/**
 * The list of trips a driver can take, shared by the home tab and the full page.
 *
 * Accept is always enabled. Disabling it told a driver they could not take the
 * work but not what to do about it; now tapping it with too little balance
 * opens the top-up sheet with the shortfall already worked out.
 */
export default function OpenTripList({ items, wallet, onChanged }) {
  const [accepting, setAccepting] = useState(null)
  const [toppingUp, setToppingUp] = useState(null)

  if (!items?.length) {
    return (
      <EmptyState
        icon={<IconInbox />}
        title="Nothing available right now"
        description="New trips appear here once a customer has paid."
      />
    )
  }

  const onAccept = (trip) => {
    if (wallet && !wallet.eligible) setToppingUp(trip)
    else setAccepting(trip)
  }

  return (
    <>
      {wallet && !wallet.eligible && (
        <Alert tone="warning" className="mb-3" title="Add money to start accepting">
          {wallet.reason}
        </Alert>
      )}

      <div className="space-y-3">
        {items.map((trip) => (
            <Card key={trip.id} className="relative overflow-hidden">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-brand-500"
              />
              <CardBody className="space-y-3.5 pl-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-ink-900">
                      {titleCase(trip.trip_type)}
                    </span>
                    <Badge tone="info">{titleCase(trip.vehicle_type)}</Badge>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 font-mono text-xs font-semibold text-amber-800">
                    {trip.booking_id}
                  </span>
                </div>

                {/* Route, with the two ends visually distinct rather than run
                    together on one line. */}
                <div className="space-y-1.5">
                  <p className="flex items-start gap-2 text-sm font-semibold text-ink-900">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600"
                    />
                    <span className="min-w-0">{trip.pickup?.address}</span>
                  </p>
                  <p className="flex items-start gap-2 text-sm text-ink-600">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full border-2 border-ink-400"
                    />
                    <span className="min-w-0">{trip.drop?.address}</span>
                  </p>
                </div>

                {/* The three numbers that decide whether to take the job. */}
                <div className="grid grid-cols-3 gap-2 rounded-xl bg-brand-50/60 p-3">
                  <Stat label="You earn" value={formatCurrency(trip.driver_brief?.trip_fare ?? trip.total_fare)} strong />
                  <Stat
                    label="Distance"
                    value={
                      trip.driver_brief?.distance_km
                        ? `${trip.driver_brief.distance_km} km`
                        : '—'
                    }
                  />
                  <Stat label="Passengers" value={trip.passenger_count} />
                </div>

                <p className="text-sm text-ink-600">
                  <span className="font-medium text-ink-900">Departure</span>{' '}
                  {formatDateTime(trip.scheduled_at)}
                </p>

                {/* What is and is not covered, so there are no surprises on the
                    road. Mirrors what the customer was told. */}
                <div className="flex flex-wrap gap-1.5">
                  <Chip tone={trip.driver_brief?.toll_included ? 'success' : 'warn'}>
                    {trip.driver_brief?.toll_included ? 'Toll included' : 'Toll extra'}
                  </Chip>
                  <Chip tone="warn">Parking extra</Chip>
                  {trip.driver_brief?.driver_allowance_included && (
                    <Chip tone="success">Driver bata included</Chip>
                  )}
                  {Number(trip.driver_brief?.night_surcharge) > 0 && (
                    <Chip tone="neutral">Night trip</Chip>
                  )}
                </div>

                {Number(trip.driver_brief?.cash_to_collect) > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-sm">
                    <span className="text-ink-600">Collect in cash</span>
                    <span className="font-bold tabular text-ink-900">
                      {formatCurrency(trip.driver_brief.cash_to_collect)}
                    </span>
                  </div>
                )}

                {trip.notes && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
                    <p className="text-xs font-semibold text-amber-900">Note</p>
                    <p className="mt-0.5 text-xs text-amber-900">{trip.notes}</p>
                  </div>
                )}

                {/* Both sides of the commitment, before they tap. */}
                <div className="space-y-1 border-t border-ink-100 pt-3 text-xs text-ink-500">
                  <p>
                    Accepting holds{' '}
                    <strong className="text-ink-700">
                      {formatCurrency(trip.wallet_required)}
                    </strong>{' '}
                    from your wallet until the trip ends.
                  </p>
                  {trip.driver_brief?.cancellation_charge_near_pickup > 0 && (
                    <p className="text-danger-700">
                      Cancelling within {trip.driver_brief.critical_hours}{' '}
                      {trip.driver_brief.critical_hours === 1 ? 'hour' : 'hours'} of pickup
                      costs{' '}
                      <strong>
                        {formatCurrency(trip.driver_brief.cancellation_charge_near_pickup)}
                      </strong>
                      .
                    </p>
                  )}
                </div>

                <Button variant="brand" fullWidth onClick={() => onAccept(trip)}>
                  {wallet && !wallet.eligible ? 'Add money & accept →' : 'Accept trip →'}
                </Button>
              </CardBody>
            </Card>
          ))}
      </div>

      <AcceptModal
        trip={accepting}
        onClose={() => setAccepting(null)}
        onAccepted={() => {
          setAccepting(null)
          onChanged?.()
        }}
      />

      <TopUpToAcceptModal
        open={Boolean(toppingUp)}
        trip={toppingUp}
        wallet={wallet}
        onClose={() => setToppingUp(null)}
        onToppedUp={() => {
          const trip = toppingUp
          setToppingUp(null)
          onChanged?.()
          // Straight into accepting: topping up was only ever a step towards it.
          setAccepting(trip)
        }}
      />
    </>
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



/** One figure in the stat strip on an open-trip card. */
function Stat({ label, value, strong = false }) {
  return (
    <div className="text-center">
      <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-ink-500">
        {label}
      </p>
      <p
        className={
          strong
            ? 'mt-0.5 text-base font-bold tabular text-brand-700'
            : 'mt-0.5 text-base font-semibold tabular text-ink-900'
        }
      >
        {value}
      </p>
    </div>
  )
}

function Chip({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-ink-50 text-ink-600 ring-ink-100',
    success: 'bg-success-50 text-success-700 ring-success-100',
    warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  }
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-[0.6875rem] font-semibold ring-1 ${tones[tone]}`}
    >
      {children}
    </span>
  )
}
