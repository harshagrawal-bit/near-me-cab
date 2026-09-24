import { Link, useParams } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { bookingService } from '@/services'
import { TRIP_TYPES } from '@/lib/constants'
import { formatCurrency, formatDateTime, formatPhone } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader, DetailList, DetailRow } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { Alert, ErrorState } from '@/components/ui/States'
import { SkeletonCard } from '@/components/ui/Loaders'
import { IconChevronLeft, IconPhone, IconPin } from '@/components/ui/Icons'
import TripActions from '@/components/driver/TripActions'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useState } from 'react'

export default function DriverTripDetail() {
  const { bookingId } = useParams()
  const toast = useToast()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const { data: booking, loading, error, refetch } = useApi(
    () => bookingService.detail(bookingId),
    [bookingId],
  )

  if (loading) return <SkeletonCard lines={10} />
  if (error) return <ErrorState title="Could not load this trip" error={error} onRetry={refetch} />
  if (!booking) return null

  const tripLabel =
    TRIP_TYPES.find((item) => item.value === booking.trip_type)?.label || booking.trip_type
  const mapsQuery = encodeURIComponent(booking.pickup?.address || '')

  return (
    <div className="space-y-5">
      <Link
        to="/driver/trips"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <IconChevronLeft className="h-4 w-4" />
        All trips
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-ink-500">{booking.booking_id}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-900">
            {booking.route?.name}
          </h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {tripLabel} · {booking.vehicle_class?.label}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      {/* Primary action sits above the fold — drivers act, then read. */}
      <Card className="p-4">
        <TripActions booking={booking} onUpdated={refetch} />
      </Card>

      <Card>
        <CardHeader title="Customer" />
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-ink-900">{booking.passenger_name}</p>
              <p className="text-sm text-ink-500">
                {booking.passenger_count}{' '}
                {booking.passenger_count === 1 ? 'passenger' : 'passengers'}
              </p>
            </div>
            {booking.passenger_phone_visible === false ? (
              <div className="text-right">
                <p className="font-mono text-sm font-semibold text-ink-500">
                  {booking.passenger_phone}
                </p>
                <p className="mt-0.5 max-w-[15rem] text-xs text-ink-400">
                  Available 2 hours before pickup
                </p>
              </div>
            ) : (
              <a href={`tel:${booking.passenger_phone}`}>
                <Button variant="brand" size="sm">
                  <IconPhone className="h-4 w-4" />
                  {formatPhone(booking.passenger_phone)}
                </Button>
              </a>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Route" />
        <CardBody className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="mt-1 flex h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600" />
            <div className="min-w-0">
              <p className="text-2xs uppercase tracking-wide text-ink-400">Pickup</p>
              <p className="text-sm font-medium text-ink-900">{booking.pickup?.address}</p>
            </div>
          </div>
          <div className="ml-[5px] h-5 w-0.5 bg-ink-200" aria-hidden="true" />
          <div className="flex items-start gap-3">
            <span className="mt-1 flex h-2.5 w-2.5 shrink-0 rounded-full bg-ink-800" />
            <div className="min-w-0">
              <p className="text-2xs uppercase tracking-wide text-ink-400">Drop</p>
              <p className="text-sm font-medium text-ink-900">{booking.drop?.address}</p>
            </div>
          </div>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <Button variant="secondary" fullWidth size="sm">
              <IconPin className="h-4 w-4" />
              Open pickup in Maps
            </Button>
          </a>
        </CardBody>
      </Card>

      {booking.notes && (
        <Alert tone="warning" title="Note from the customer">
          {booking.notes}
        </Alert>
      )}

      <Card>
        <CardHeader title="Trip information" />
        <CardBody>
          <DetailList>
            <DetailRow label="Booking ID" value={booking.booking_id} />
            <DetailRow label="Date & time" value={formatDateTime(booking.scheduled_at)} />
            {booking.return_at && (
              <DetailRow label="Return" value={formatDateTime(booking.return_at)} />
            )}
            <DetailRow label="Trip type" value={tripLabel} />
            <DetailRow
              label="Vehicle"
              value={
                booking.vehicle
                  ? `${booking.vehicle.model} · ${booking.vehicle.registration_number}`
                  : booking.vehicle_class?.label
              }
            />
            <DetailRow
              label="Fare"
              value={formatCurrency(booking.total_fare)}
              valueClassName="tabular text-base"
            />
            <DetailRow
              label="Payment"
              value={<StatusBadge kind="payment" status={booking.payment_status} />}
            />
          </DetailList>
          <p className="mt-3 text-xs text-ink-500">
            Collect the fare shown above if the customer is paying in cash.
          </p>
        </CardBody>
      </Card>
      {/* Dropping a trip costs money, so the charge is named before it is
          confirmed rather than appearing in the statement afterwards. */}
      {['driver_assigned', 'accepted', 'driver_arriving'].includes(booking.status) && (
        <>
          <Button
            variant="danger-outline"
            fullWidth
            onClick={() => setCancelOpen(true)}
            className="mt-2"
          >
            Cancel this trip
          </Button>

          <ConfirmDialog
            open={cancelOpen}
            onClose={() => setCancelOpen(false)}
            title="Cancel this trip?"
            tone="danger"
            confirmLabel="Cancel trip"
            loading={cancelling}
            onConfirm={async () => {
              if (cancelReason.trim().length < 3) {
                toast.error('Tell us why — the office sees this.')
                return
              }
              setCancelling(true)
              try {
                const result = await bookingService.driverCancel(bookingId, {
                  reason: cancelReason.trim(),
                })
                const charged = result?.penalty?.amount
                toast.error(
                  charged
                    ? `Trip cancelled. ${formatCurrency(charged)} charged to your wallet.`
                    : 'Trip cancelled.',
                )
                setCancelOpen(false)
                setCancelReason('')
                refetch()
              } catch (err) {
                toast.error(err?.message || 'Could not cancel the trip.')
              } finally {
                setCancelling(false)
              }
            }}
          >
            <p className="text-sm text-ink-600">
              A cancellation charge is deducted from your wallet. It is higher the closer
              to pickup you cancel, because that is when we can least easily find another
              car.
            </p>
            <Textarea
              className="mt-3"
              rows={3}
              placeholder="Why are you cancelling?"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </ConfirmDialog>
        </>
      )}
    </div>
  )
}
