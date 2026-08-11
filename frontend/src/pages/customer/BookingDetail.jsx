import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { bookingService, reviewService } from '@/services'
import { CUSTOMER_CANCELLABLE, TRIP_TYPES } from '@/lib/constants'
import { brand } from '@/config/brand'
import { formatCurrency, formatDateTime, formatPhone, initials } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader, DetailList, DetailRow } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { Field, Textarea } from '@/components/ui/Field'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Alert, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonCard } from '@/components/ui/Loaders'
import {
  IconCheck,
  IconChevronLeft,
  IconPhone,
  IconStar,
  IconStarFilled,
} from '@/components/ui/Icons'
import StatusTimeline from '@/components/booking/StatusTimeline'
import FareSummary from '@/components/booking/FareSummary'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'

export default function BookingDetail() {
  const { bookingId } = useParams()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const isNewParam = params.get('new') === '1'

  const { data: booking, loading, error, refetch } = useApi(
    () => bookingService.detail(bookingId),
    [bookingId],
  )

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  if (loading) return <SkeletonCard lines={10} />
  if (error) return <ErrorState title="Could not load this booking" error={error} onRetry={refetch} />
  if (!booking) return null

  const canCancel = CUSTOMER_CANCELLABLE.includes(booking.status)
  const isCancelled = booking.status === 'cancelled'
  const isCompleted = booking.status === 'completed'
  const tripLabel =
    TRIP_TYPES.find((item) => item.value === booking.trip_type)?.label || booking.trip_type

  const handleCancel = async () => {
    if (cancelReason.trim().length < 3) {
      toast.error('Please tell us briefly why you are cancelling.')
      return
    }
    setCancelling(true)
    try {
      await bookingService.cancel(bookingId, cancelReason.trim())
      toast.success('Booking cancelled.')
      setCancelOpen(false)
      setCancelReason('')
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="space-y-5">
      <Link
        to="/app/bookings"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <IconChevronLeft className="h-4 w-4" />
        All trips
      </Link>

      {/* Only while the booking is still awaiting confirmation — the
          `?new=1` param survives a reload, so status is the real signal. */}
      {isNewParam && booking.status === 'requested' && (
        <Alert tone="success" title="Booking received" onDismiss={() => setParams({})}>
          We have your request. Our team confirms bookings within a few minutes during
          working hours — you will get a notification the moment a driver is assigned.
        </Alert>
      )}

      {/* The one thing standing between this trip and a driver. Stated as an
          amount and a balance so there is no surprise at the drop. */}
      {booking.status === 'awaiting_payment' && (
        <Alert tone="warning" title="Pay the advance to confirm">
          <p>
            A car is available for your trip. Pay{' '}
            <strong className="font-semibold">
              {formatCurrency(booking.advance_amount)}
            </strong>{' '}
            ({booking.advance_percent}% of {formatCurrency(booking.total_fare)}) to confirm
            the booking. The remaining {formatCurrency(booking.balance_due)} is due at the
            end of the trip.
          </p>
          <p className="mt-2 text-sm">
            Online payment is not available yet — call{' '}
            <a href={`tel:${brand.supportPhone}`} className="font-medium underline">
              {formatPhone(brand.supportPhone)}
            </a>{' '}
            and our team will take the advance and confirm your booking.
          </p>
        </Alert>
      )}

      <PageHeader
        title={booking.route?.name || 'Your trip'}
        description={`${tripLabel} · ${booking.vehicle_class?.label || booking.vehicle_type}`}
        action={<StatusBadge status={booking.status} />}
      >
        <p className="mt-1.5 font-mono text-sm text-ink-500">{booking.booking_id}</p>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Trip status" />
            <CardBody>
              <StatusTimeline
                status={booking.status}
                history={booking.history || []}
                cancelled={isCancelled}
              />
              {isCancelled && booking.cancelled_reason && (
                <Alert tone="danger" className="mt-4">
                  <strong>Reason:</strong> {booking.cancelled_reason}
                </Alert>
              )}
            </CardBody>
          </Card>

          {booking.driver && (
            <Card>
              <CardHeader title="Your driver" />
              <CardBody>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                      {initials(booking.driver.name)}
                    </span>
                    <div>
                      <p className="font-medium text-ink-900">{booking.driver.name}</p>
                      <p className="flex items-center gap-1 text-sm text-ink-500">
                        {booking.driver.rating_count > 0 ? (
                          <>
                            <IconStarFilled className="h-3.5 w-3.5 text-warning-600" />
                            {booking.driver.rating_avg} · {booking.driver.total_trips} trips
                          </>
                        ) : (
                          `${booking.driver.total_trips} trips`
                        )}
                      </p>
                    </div>
                  </div>
                  {booking.driver.phone && !isCancelled && (
                    <a href={`tel:${booking.driver.phone}`}>
                      <Button variant="secondary" size="sm">
                        <IconPhone className="h-4 w-4" />
                        Call driver
                      </Button>
                    </a>
                  )}
                </div>
                {booking.vehicle && (
                  <div className="mt-4 rounded-lg bg-ink-50 px-3.5 py-3">
                    <p className="text-sm font-medium text-ink-900">{booking.vehicle.model}</p>
                    <p className="mt-0.5 font-mono text-sm tracking-wide text-ink-600">
                      {booking.vehicle.registration_number}
                    </p>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Trip details" />
            <CardBody>
              <DetailList>
                <DetailRow label="Booking ID" value={booking.booking_id} />
                <DetailRow label="Pickup" value={booking.pickup?.address} />
                <DetailRow label="Destination" value={booking.drop?.address} />
                <DetailRow label="Date & time" value={formatDateTime(booking.scheduled_at)} />
                {booking.return_at && (
                  <DetailRow label="Return" value={formatDateTime(booking.return_at)} />
                )}
                <DetailRow label="Trip type" value={tripLabel} />
                <DetailRow
                  label="Vehicle"
                  value={booking.vehicle_class?.label || booking.vehicle_type}
                />
                <DetailRow label="Passengers" value={booking.passenger_count} />
                <DetailRow label="Passenger" value={booking.passenger_name} />
                <DetailRow
                  label="Contact"
                  value={formatPhone(booking.passenger_phone)}
                />
                {booking.notes && <DetailRow label="Notes" value={booking.notes} />}
              </DetailList>
            </CardBody>
          </Card>

          {isCompleted && (
            <Card>
              <CardHeader
                title="How was your trip?"
                description={
                  booking.review
                    ? 'Thanks for the feedback.'
                    : 'Your rating helps us keep quality high.'
                }
              />
              <CardBody>
                {booking.review ? (
                  <div className="flex items-start gap-3">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, index) =>
                        index < booking.review.rating ? (
                          <IconStarFilled key={index} className="h-4 w-4 text-warning-600" />
                        ) : (
                          <IconStar key={index} className="h-4 w-4 text-ink-200" />
                        ),
                      )}
                    </div>
                    {booking.review.comment && (
                      <p className="text-sm text-ink-600">{booking.review.comment}</p>
                    )}
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => setReviewOpen(true)}>
                    <IconStar className="h-4 w-4" />
                    Rate this trip
                  </Button>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="Fare" />
            <CardBody>
              <FareSummary breakdown={booking.fare_breakdown} total={booking.total_fare} />
              <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-3">
                <span className="text-sm text-ink-500">Payment</span>
                <StatusBadge kind="payment" status={booking.payment_status} />
              </div>
              {booking.fare_overridden && (
                <Alert tone="info" className="mt-3">
                  Fare adjusted by our team.
                  {booking.fare_override_reason && ` ${booking.fare_override_reason}`}
                </Alert>
              )}
              {booking.coupon_code && (
                <p className="mt-3 text-xs text-ink-500">
                  Coupon <span className="font-mono">{booking.coupon_code}</span> applied.
                </p>
              )}
            </CardBody>
          </Card>

          {canCancel && (
            <Button variant="danger-outline" fullWidth onClick={() => setCancelOpen(true)}>
              Cancel booking
            </Button>
          )}

          {!canCancel && !isCancelled && !isCompleted && (
            <Alert tone="neutral">
              This trip is under way. Call support if you need to make a change.
            </Alert>
          )}

          <Link to="/app/support" className="block">
            <Button variant="ghost" fullWidth>
              Need help with this trip?
            </Button>
          </Link>
        </aside>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={handleCancel}
        loading={cancelling}
        title="Cancel this booking?"
        confirmLabel="Yes, cancel it"
        cancelLabel="Keep booking"
      >
        <p className="text-sm text-ink-600">
          Booking <span className="font-mono">{booking.booking_id}</span> will be cancelled.
          This cannot be undone.
        </p>
        <Field label="Reason" htmlFor="reason" className="mt-4" required>
          <Textarea
            id="reason"
            rows={3}
            maxLength={300}
            placeholder="Plans changed, booked elsewhere…"
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
          />
        </Field>
      </ConfirmDialog>

      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        bookingId={bookingId}
        onDone={() => {
          setReviewOpen(false)
          refetch()
        }}
      />
    </div>
  )
}

function ReviewModal({ open, onClose, bookingId, onDone }) {
  const toast = useToast()
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await reviewService.create({
        booking_id: bookingId,
        rating,
        comment: comment.trim() || undefined,
      })
      toast.success('Thanks for the feedback.')
      onDone()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rate your trip"
      description="This is shared with our operations team."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Not now
          </Button>
          <Button onClick={submit} loading={saving}>
            <IconCheck className="h-4 w-4" />
            Submit review
          </Button>
        </>
      }
    >
      <div className="flex justify-center gap-1.5">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            aria-label={`${value} star${value > 1 ? 's' : ''}`}
            className="rounded-lg p-1 transition-transform hover:scale-110"
          >
            {value <= rating ? (
              <IconStarFilled className="h-8 w-8 text-warning-600" />
            ) : (
              <IconStar className="h-8 w-8 text-ink-300" />
            )}
          </button>
        ))}
      </div>
      <Field label="Comment" htmlFor="comment" className="mt-5" optionalLabel>
        <Textarea
          id="comment"
          rows={3}
          maxLength={1000}
          placeholder="Anything you would like us to know?"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </Field>
    </Modal>
  )
}
