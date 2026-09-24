import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useApi } from '@/hooks/useApi'
import { bookingService, pricingService, userService } from '@/services'
import { TRIP_TYPES } from '@/lib/constants'
import { combineDateTime, formatShortDateTime } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonCard } from '@/components/ui/Loaders'
import { IconChevronLeft } from '@/components/ui/Icons'
import FareSummary from '@/components/booking/FareSummary'
import PaymentOptions from '@/components/booking/PaymentOptions'
import { useToast } from '@/components/ui/Toast'

const PHONE_RE = /^[6-9]\d{9}$/

export default function BookingForm() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  // The rules the server will actually apply, so the choices shown here match
  // what it charges rather than a copy that can drift.
  const { data: appSettings } = useApi(() => userService.appSettings(), [])
  const [paymentOption, setPaymentOption] = useState('part')

  const routeId = params.get('route_id')
  const tripType = params.get('trip_type') || 'one_way'
  const vehicleType = params.get('vehicle_type')
  const date = params.get('date')
  const time = params.get('time') || '09:00'
  const coupon = params.get('coupon') || ''
  const scheduledAt = combineDateTime(date, time)

  const { data: quote, loading, error, refetch } = useApi(
    () =>
      pricingService.quote({
        route_id: routeId,
        trip_type: tripType,
        vehicle_type: vehicleType,
        scheduled_at: scheduledAt,
        coupon_code: coupon || undefined,
      }),
    [routeId, tripType, vehicleType, scheduledAt, coupon],
    { enabled: Boolean(routeId && vehicleType) },
  )

  const option = quote?.options?.[0]
  const route = quote?.route

  const [form, setForm] = useState({
    pickupAddress: '',
    dropAddress: '',
    passengerName: '',
    passengerPhone: '',
    passengerCount: 1,
    notes: '',
    paymentMethod: 'cash',
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Prefill from the signed-in customer and the selected route.
  useEffect(() => {
    setForm((current) => ({
      ...current,
      passengerName: current.passengerName || user?.name || '',
      passengerPhone: current.passengerPhone || user?.phone || '',
    }))
  }, [user])

  useEffect(() => {
    if (!route) return
    setForm((current) => ({
      ...current,
      pickupAddress: current.pickupAddress || route.origin,
      dropAddress: current.dropAddress || route.destination,
    }))
  }, [route])

  const savedLocations = user?.saved_locations || []

  const validate = () => {
    const next = {}
    if (form.pickupAddress.trim().length < 3) next.pickupAddress = 'Enter the pickup address.'
    if (form.dropAddress.trim().length < 3) next.dropAddress = 'Enter the drop address.'
    if (form.passengerName.trim().length < 2) next.passengerName = 'Enter the passenger name.'
    const phone = String(form.passengerPhone).replace(/\D/g, '').slice(-10)
    if (!PHONE_RE.test(phone)) next.passengerPhone = 'Enter a valid 10-digit mobile number.'
    const seats = option?.seating_capacity || 4
    if (form.passengerCount < 1 || form.passengerCount > seats)
      next.passengerCount = `This vehicle seats up to ${seats} passengers.`
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setFormError(null)
    if (!validate()) return
    setSubmitting(true)
    try {
      // Note: no price is sent. The backend recalculates and is authoritative.
      const booking = await bookingService.create({
        route_id: routeId,
        pickup: { address: form.pickupAddress.trim() },
        drop: { address: form.dropAddress.trim() },
        trip_type: tripType,
        vehicle_type: vehicleType,
        scheduled_at: scheduledAt,
        passenger_count: Number(form.passengerCount),
        passenger_name: form.passengerName.trim(),
        passenger_phone: String(form.passengerPhone).replace(/\D/g, '').slice(-10),
        notes: form.notes.trim() || undefined,
        coupon_code: coupon || undefined,
        payment_method: form.paymentMethod,
        payment_option: paymentOption,
      })
      toast.success('Booking requested. We will confirm shortly.')
      navigate(`/app/bookings/${booking.id}?new=1`, { replace: true })
    } catch (caught) {
      setFormError(caught.message)
      setErrors(caught.fieldErrors || {})
    } finally {
      setSubmitting(false)
    }
  }

  if (!routeId || !vehicleType) {
    return (
      <EmptyState
        title="Nothing selected"
        description="Choose a route and vehicle to continue."
        action={
          <Link to="/app">
            <Button>Start a booking</Button>
          </Link>
        }
      />
    )
  }

  if (loading) return <SkeletonCard lines={8} />
  if (error) return <ErrorState title="Could not load this trip" error={error} onRetry={refetch} />
  if (!option) {
    return (
      <EmptyState
        title="This vehicle is not available"
        description="Fares may have changed. Please pick another option."
        action={
          <Link to="/app">
            <Button>Back to booking</Button>
          </Link>
        }
      />
    )
  }

  const tripLabel = TRIP_TYPES.find((item) => item.value === tripType)?.label || tripType

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <IconChevronLeft className="h-4 w-4" />
        Change vehicle
      </button>

      <PageHeader
        title="Confirm your trip"
        description={`${route?.name} · ${tripLabel} · ${option.label}`}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {formError && <Alert tone="danger">{formError}</Alert>}

          <Card>
            <CardHeader title="Pickup and drop" />
            <CardBody className="space-y-4">
              <Field
                label="Pickup address"
                htmlFor="pickup"
                error={errors.pickupAddress}
                required
                hint="Building, street and area so the driver can find you."
              >
                <Input
                  id="pickup"
                  value={form.pickupAddress}
                  invalid={Boolean(errors.pickupAddress)}
                  onChange={(event) =>
                    setForm({ ...form, pickupAddress: event.target.value })
                  }
                />
              </Field>

              {savedLocations.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {savedLocations.map((location) => (
                    <button
                      key={location.label}
                      type="button"
                      onClick={() => setForm({ ...form, pickupAddress: location.address })}
                      className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600 hover:border-ink-300 hover:text-ink-900"
                    >
                      {location.label}
                    </button>
                  ))}
                </div>
              )}

              <Field label="Drop address" htmlFor="drop" error={errors.dropAddress} required>
                <Input
                  id="drop"
                  value={form.dropAddress}
                  invalid={Boolean(errors.dropAddress)}
                  onChange={(event) => setForm({ ...form, dropAddress: event.target.value })}
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Passenger details" />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Passenger name"
                  htmlFor="passengerName"
                  error={errors.passengerName}
                  required
                >
                  <Input
                    id="passengerName"
                    value={form.passengerName}
                    invalid={Boolean(errors.passengerName)}
                    onChange={(event) =>
                      setForm({ ...form, passengerName: event.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Contact number"
                  htmlFor="passengerPhone"
                  error={errors.passengerPhone}
                  required
                >
                  <Input
                    id="passengerPhone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={13}
                    value={form.passengerPhone}
                    invalid={Boolean(errors.passengerPhone)}
                    onChange={(event) =>
                      setForm({ ...form, passengerPhone: event.target.value })
                    }
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Passengers"
                  htmlFor="passengerCount"
                  error={errors.passengerCount}
                  required
                >
                  <Select
                    id="passengerCount"
                    value={form.passengerCount}
                    invalid={Boolean(errors.passengerCount)}
                    onChange={(event) =>
                      setForm({ ...form, passengerCount: Number(event.target.value) })
                    }
                  >
                    {Array.from({ length: option.seating_capacity }, (_, index) => index + 1).map(
                      (count) => (
                        <option key={count} value={count}>
                          {count} {count === 1 ? 'passenger' : 'passengers'}
                        </option>
                      ),
                    )}
                  </Select>
                </Field>
                <Field label="Payment" htmlFor="paymentMethod">
                  <Select
                    id="paymentMethod"
                    value={form.paymentMethod}
                    onChange={(event) =>
                      setForm({ ...form, paymentMethod: event.target.value })
                    }
                  >
                    <option value="cash">Pay driver in cash</option>
                    <option value="upi">UPI (recorded by our team)</option>
                  </Select>
                </Field>
              </div>

              <Field
                label="Notes for the driver"
                htmlFor="notes"
                optionalLabel
                hint="Luggage, child seat, an extra stop — anything useful."
              >
                <Textarea
                  id="notes"
                  rows={3}
                  maxLength={500}
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                />
              </Field>
            </CardBody>
          </Card>

          <div className="hidden lg:block">
            <Button type="submit" size="lg" loading={submitting}>
              Confirm booking
            </Button>
          </div>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="Trip summary" />
            <CardBody className="space-y-3">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Route</dt>
                  <dd className="text-right font-medium text-ink-900">{route?.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Pickup</dt>
                  <dd className="text-right font-medium text-ink-900">
                    {formatShortDateTime(scheduledAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Vehicle</dt>
                  <dd className="text-right font-medium text-ink-900">{option.label}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Trip type</dt>
                  <dd className="text-right font-medium text-ink-900">{tripLabel}</dd>
                </div>
              </dl>
              <div className="border-t border-ink-100 pt-3">
                <FareSummary breakdown={option.breakdown} total={option.fare} compact />
              </div>
              <div className="border-t border-ink-100 pt-4">
                <p className="mb-2.5 text-sm font-semibold text-ink-900">How would you like to pay?</p>
                <PaymentOptions
                  total={option.fare}
                  advancePercent={appSettings?.advance?.percent ?? 15}
                  settings={appSettings?.payment_options}
                  value={paymentOption}
                  onChange={setPaymentOption}
                />
              </div>

              {appSettings?.cancellation && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                  <span aria-hidden="true" className="text-base leading-none">🕑</span>
                  <p className="text-xs leading-relaxed text-amber-900">
                    <strong className="font-semibold">
                      Free cancellation until {appSettings.cancellation.customer_free_hours} hours
                      before pickup.
                    </strong>{' '}
                    After that we keep {Math.round(appSettings.cancellation.customer_fee_percent)}%
                    of what you have paid and refund the rest.
                  </p>
                </div>
              )}

              <p className="text-xs text-ink-500">
                Our team confirms the vehicle before anything is charged.
              </p>
            </CardBody>
          </Card>

          <div className="lg:hidden">
            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={submitting}
              onClick={onSubmit}
            >
              Confirm booking
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}
