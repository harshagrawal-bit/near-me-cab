import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { bookingService, driverService } from '@/services'
import { PAYMENT_STATUS_META, TERMINAL_STATUSES, TRIP_TYPES } from '@/lib/constants'
import { formatCurrency, formatDateTime, formatPhone, formatShortDateTime } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader, DetailList, DetailRow } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Alert, ErrorState } from '@/components/ui/States'
import { SkeletonCard, Spinner } from '@/components/ui/Loaders'
import { IconCheck, IconChevronLeft, IconStar, IconStarFilled } from '@/components/ui/Icons'
import FareSummary from '@/components/booking/FareSummary'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'

export default function AdminBookingDetail() {
  const { bookingId } = useParams()
  const toast = useToast()
  const { data: booking, loading, error, refetch } = useApi(
    () => bookingService.detail(bookingId),
    [bookingId],
  )

  const [dialog, setDialog] = useState(null) // 'confirm' | 'cancel' | 'assign' | 'fare' | 'payment'
  const [busy, setBusy] = useState(false)

  if (loading) return <SkeletonCard lines={12} />
  if (error) return <ErrorState title="Could not load this booking" error={error} onRetry={refetch} />
  if (!booking) return null

  const isTerminal = TERMINAL_STATUSES.includes(booking.status)
  const tripLabel =
    TRIP_TYPES.find((item) => item.value === booking.trip_type)?.label || booking.trip_type

  const runAction = async (fn, successMessage) => {
    setBusy(true)
    try {
      await fn()
      toast.success(successMessage)
      setDialog(null)
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Link
        to="/admin/bookings"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <IconChevronLeft className="h-4 w-4" />
        All bookings
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm text-ink-500">{booking.booking_id}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">
            {booking.route?.name || `${booking.pickup?.address} → ${booking.drop?.address}`}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {tripLabel} · {booking.vehicle_class?.label} · created{' '}
            {formatShortDateTime(booking.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={booking.status} />
          <StatusBadge kind="payment" status={booking.payment_status} />
        </div>
      </div>

      {/* Workflow actions */}
      <Card>
        <CardHeader title="Actions" description="Drive this booking through the workflow." />
        <CardBody className="flex flex-wrap gap-2">
          {booking.status === 'requested' && (
            <Button onClick={() => setDialog('availability')}>
              <IconCheck className="h-4 w-4" />
              Confirm car available
            </Button>
          )}
          {booking.status === 'awaiting_payment' && (
            <Button onClick={() => setDialog('advance')}>
              <IconCheck className="h-4 w-4" />
              Mark advance received
            </Button>
          )}
          {!isTerminal &&
            booking.status !== 'requested' &&
            booking.status !== 'awaiting_payment' && (
            <Button onClick={() => setDialog('assign')}>
              {booking.driver ? 'Reassign driver' : 'Assign driver'}
            </Button>
          )}
          {!isTerminal && (
            <Button variant="secondary" onClick={() => setDialog('fare')}>
              Modify fare
            </Button>
          )}
          <Button variant="secondary" onClick={() => setDialog('payment')}>
            Record payment
          </Button>
          {!isTerminal && (
            <Button variant="danger-outline" onClick={() => setDialog('cancel')}>
              Cancel booking
            </Button>
          )}
          {isTerminal && (
            <Alert tone="neutral" className="w-full">
              This booking is {booking.status}. No further workflow actions are available.
            </Alert>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Trip" />
            <CardBody>
              <DetailList>
                <DetailRow label="Pickup" value={booking.pickup?.address} />
                <DetailRow label="Destination" value={booking.drop?.address} />
                <DetailRow label="Scheduled" value={formatDateTime(booking.scheduled_at)} />
                {booking.return_at && (
                  <DetailRow label="Return" value={formatDateTime(booking.return_at)} />
                )}
                <DetailRow label="Trip type" value={tripLabel} />
                <DetailRow label="Passengers" value={booking.passenger_count} />
                <DetailRow label="Passenger name" value={booking.passenger_name} />
                <DetailRow label="Contact" value={formatPhone(booking.passenger_phone)} />
                {booking.notes && <DetailRow label="Notes" value={booking.notes} />}
                {booking.cancelled_reason && (
                  <DetailRow
                    label="Cancellation reason"
                    value={`${booking.cancelled_reason} (by ${booking.cancelled_by})`}
                  />
                )}
              </DetailList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Status history" description="Every transition, with who made it." />
            <CardBody className="p-0">
              <ul className="divide-y divide-ink-100">
                {(booking.history || []).map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-ink-900">{entry.label}</p>
                        <p className="text-xs text-ink-400">
                          {formatShortDateTime(entry.created_at)}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-500">
                        by {entry.changed_by_role}
                        {entry.note ? ` · ${entry.note}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {booking.payments?.length > 0 && (
            <Card>
              <CardHeader title="Payments" />
              <CardBody className="p-0">
                <ul className="divide-y divide-ink-100">
                  {booking.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900">
                          {formatCurrency(payment.amount)}{' '}
                          <span className="font-normal text-ink-500">via {payment.method}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {formatShortDateTime(payment.created_at)}
                          {payment.note ? ` · ${payment.note}` : ''}
                        </p>
                      </div>
                      <StatusBadge kind="payment" status={payment.status} dot={false} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Fare" />
            <CardBody>
              <FareSummary breakdown={booking.fare_breakdown} total={booking.total_fare} />
              {booking.fare_overridden && (
                <Alert tone="info" className="mt-3">
                  Overridden from {formatCurrency(booking.quoted_fare)}.
                  {booking.fare_override_reason && ` ${booking.fare_override_reason}`}
                </Alert>
              )}
              <dl className="mt-4 space-y-2 border-t border-ink-100 pt-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Amount paid</dt>
                  <dd className="tabular font-medium text-ink-900">
                    {formatCurrency(booking.amount_paid || 0)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Method</dt>
                  <dd className="font-medium text-ink-900">{booking.payment_method}</dd>
                </div>
                {booking.coupon_code && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500">Coupon</dt>
                    <dd className="font-mono font-medium text-ink-900">{booking.coupon_code}</dd>
                  </div>
                )}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer" />
            <CardBody>
              {booking.customer ? (
                <>
                  <DetailList>
                    <DetailRow label="Name" value={booking.customer.name} />
                    <DetailRow label="Email" value={booking.customer.email} />
                    <DetailRow label="Phone" value={formatPhone(booking.customer.phone)} />
                    <DetailRow
                      label="Account"
                      value={<StatusBadge kind="account" status={booking.customer.status} />}
                    />
                  </DetailList>
                  <Link
                    to={`/admin/customers/${booking.customer.id}`}
                    className="mt-3 block"
                  >
                    <Button variant="secondary" size="sm" fullWidth>
                      View customer
                    </Button>
                  </Link>
                </>
              ) : (
                <p className="text-sm text-ink-500">Customer record unavailable.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Driver & vehicle" />
            <CardBody>
              {booking.driver ? (
                <>
                  <DetailList>
                    <DetailRow label="Driver" value={booking.driver.name} />
                    <DetailRow label="Phone" value={formatPhone(booking.driver.phone)} />
                    <DetailRow
                      label="Rating"
                      value={
                        booking.driver.rating_count > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <IconStarFilled className="h-3.5 w-3.5 text-warning-600" />
                            {booking.driver.rating_avg} ({booking.driver.rating_count})
                          </span>
                        ) : (
                          'Not rated yet'
                        )
                      }
                    />
                    {booking.vehicle && (
                      <>
                        <DetailRow label="Vehicle" value={booking.vehicle.model} />
                        <DetailRow
                          label="Registration"
                          value={booking.vehicle.registration_number}
                          valueClassName="font-mono"
                        />
                      </>
                    )}
                  </DetailList>
                  <Link to={`/admin/drivers/${booking.driver.id}`} className="mt-3 block">
                    <Button variant="secondary" size="sm" fullWidth>
                      View driver
                    </Button>
                  </Link>
                </>
              ) : (
                <p className="text-sm text-ink-500">
                  No driver assigned yet.
                  {booking.status === 'requested' && ' Confirm the booking first.'}
                </p>
              )}
            </CardBody>
          </Card>

          {booking.review && (
            <Card>
              <CardHeader title="Customer review" />
              <CardBody>
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, index) =>
                    index < booking.review.rating ? (
                      <IconStarFilled key={index} className="h-4 w-4 text-warning-600" />
                    ) : (
                      <IconStar key={index} className="h-4 w-4 text-ink-200" />
                    ),
                  )}
                </div>
                {booking.review.comment && (
                  <p className="mt-2 text-sm text-ink-600">{booking.review.comment}</p>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'availability'}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          runAction(
            () => bookingService.confirmAvailability(bookingId),
            'Advance requested from the customer.',
          )
        }
        loading={busy}
        title="Confirm a car is available?"
        message={
          'The customer will be asked to pay the advance. The amount is calculated ' +
          'from the fare and the percentage in Settings — no driver can be assigned ' +
          'until it is received.'
        }
        confirmLabel="Confirm availability"
        tone="primary"
      />

      <ConfirmDialog
        open={dialog === 'advance'}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          runAction(
            () => bookingService.markAdvancePaid(bookingId),
            'Advance recorded. Booking confirmed.',
          )
        }
        loading={busy}
        title={`Record ${formatCurrency(booking.advance_amount)} as received?`}
        message={
          'Only do this once the money has actually arrived. This confirms the ' +
          'booking and makes it available for a fleet owner to accept.'
        }
        confirmLabel="Mark advance received"
        tone="primary"
      />

      <CancelDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        busy={busy}
        onConfirm={(reason) =>
          runAction(() => bookingService.cancel(bookingId, reason), 'Booking cancelled.')
        }
        bookingRef={booking.booking_id}
      />

      <AssignDriverDialog
        open={dialog === 'assign'}
        onClose={() => setDialog(null)}
        booking={booking}
        busy={busy}
        onConfirm={(payload) =>
          runAction(
            () => bookingService.assignDriver(bookingId, payload),
            booking.driver ? 'Driver reassigned.' : 'Driver assigned.',
          )
        }
      />

      <FareDialog
        open={dialog === 'fare'}
        onClose={() => setDialog(null)}
        booking={booking}
        busy={busy}
        onConfirm={(payload) =>
          runAction(() => bookingService.overrideFare(bookingId, payload), 'Fare updated.')
        }
      />

      <PaymentDialog
        open={dialog === 'payment'}
        onClose={() => setDialog(null)}
        booking={booking}
        busy={busy}
        onConfirm={(payload) =>
          runAction(() => bookingService.recordPayment(bookingId, payload), 'Payment recorded.')
        }
        onStatusOnly={(payload) =>
          runAction(
            () => bookingService.setPaymentStatus(bookingId, payload),
            'Payment status updated.',
          )
        }
      />
    </div>
  )
}

function CancelDialog({ open, onClose, onConfirm, busy, bookingRef }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      loading={busy}
      title="Cancel this booking?"
      confirmLabel="Cancel booking"
      cancelLabel="Keep booking"
      onConfirm={() => {
        if (reason.trim().length < 3) {
          setError('Give a short reason — it is stored on the booking history.')
          return
        }
        setError(null)
        onConfirm(reason.trim())
      }}
    >
      <p className="text-sm text-ink-600">
        <span className="font-mono">{bookingRef}</span> will be cancelled and the customer
        notified. This cannot be undone.
      </p>
      <Field label="Reason" htmlFor="cancelReason" error={error} className="mt-4" required>
        <Textarea
          id="cancelReason"
          rows={3}
          maxLength={300}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </ConfirmDialog>
  )
}

function AssignDriverDialog({ open, onClose, onConfirm, busy, booking }) {
  const { data: drivers, loading } = useApi(
    () => driverService.assignable(booking.vehicle_type),
    [booking.vehicle_type],
    { enabled: open },
  )
  const [driverId, setDriverId] = useState('')
  const [note, setNote] = useState('')
  const [showAll, setShowAll] = useState(false)

  const { data: allDrivers } = useApi(() => driverService.assignable(), [], {
    enabled: open && showAll,
  })

  const list = showAll ? allDrivers : drivers

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={booking.driver ? 'Reassign driver' : 'Assign driver'}
      description={`${booking.vehicle_class?.label} · ${formatShortDateTime(booking.scheduled_at)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({ driver_id: driverId, note: note.trim() || undefined })}
            loading={busy}
            disabled={!driverId}
          >
            {booking.driver ? 'Reassign' : 'Assign'}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-5 w-5 text-brand-600" />
        </div>
      ) : (
        <div className="space-y-4">
          {!list?.length ? (
            <Alert tone="warning">
              No verified drivers
              {!showAll && ` with a ${booking.vehicle_class?.label}`} are available.
              {!showAll && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="ml-1 font-medium underline"
                >
                  Show all drivers
                </button>
              )}
            </Alert>
          ) : (
            <>
              <ul className="space-y-2">
                {list.map((driver) => (
                  <li key={driver.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3.5 py-3 transition-colors',
                        driverId === driver.id
                          ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                          : 'border-ink-200 hover:border-ink-300',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <input
                          type="radio"
                          name="driver"
                          value={driver.id}
                          checked={driverId === driver.id}
                          onChange={() => setDriverId(driver.id)}
                          className="h-4 w-4 border-ink-300 text-brand-600 focus:ring-brand-500"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-900">
                            {driver.name}
                          </p>
                          <p className="truncate text-xs text-ink-500">
                            {driver.vehicle
                              ? `${driver.vehicle.model} · ${driver.vehicle.registration_number}`
                              : 'No vehicle assigned'}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={driver.is_available ? 'success' : 'neutral'}>
                          {driver.is_available ? 'Online' : 'Offline'}
                        </Badge>
                        {driver.rating_count > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-ink-500">
                            <IconStarFilled className="h-3 w-3 text-warning-600" />
                            {driver.rating_avg}
                          </span>
                        )}
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
              {!showAll && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  Show drivers with other vehicle types
                </button>
              )}
            </>
          )}

          <Field label="Note" htmlFor="assignNote" optionalLabel>
            <Input
              id="assignNote"
              maxLength={300}
              placeholder="Added to the booking history"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}

function FareDialog({ open, onClose, onConfirm, busy, booking }) {
  const [amount, setAmount] = useState(String(booking.total_fare ?? ''))
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})

  const submit = () => {
    const next = {}
    const value = Number(amount)
    if (!Number.isFinite(value) || value < 0) next.amount = 'Enter a valid amount.'
    if (reason.trim().length < 3) next.reason = 'Give a reason — it is shown to the customer.'
    setErrors(next)
    if (Object.keys(next).length) return
    onConfirm({ total_fare: value, reason: reason.trim() })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Modify fare"
      description="Use for waiting time, extra stops or agreed adjustments."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Update fare
          </Button>
        </>
      }
    >
      <Alert tone="neutral" className="mb-4">
        System-calculated fare: <strong>{formatCurrency(booking.quoted_fare)}</strong>
      </Alert>
      <div className="space-y-4">
        <Field label="New total fare (₹)" htmlFor="fareAmount" error={errors.amount} required>
          <Input
            id="fareAmount"
            type="number"
            min="0"
            step="1"
            className="tabular"
            value={amount}
            invalid={Boolean(errors.amount)}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label="Reason" htmlFor="fareReason" error={errors.reason} required>
          <Textarea
            id="fareReason"
            rows={3}
            maxLength={300}
            placeholder="45 minutes waiting time at pickup"
            value={reason}
            invalid={Boolean(errors.reason)}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}

function PaymentDialog({ open, onClose, onConfirm, onStatusOnly, busy, booking }) {
  const outstanding = Math.max(0, (booking.total_fare || 0) - (booking.amount_paid || 0))
  const [amount, setAmount] = useState(String(outstanding || booking.total_fare || ''))
  const [method, setMethod] = useState('cash')
  const [status, setStatus] = useState('paid')
  const [note, setNote] = useState('')
  const [mode, setMode] = useState('record')
  const [statusOnly, setStatusOnly] = useState(booking.payment_status)
  const [error, setError] = useState(null)

  const submit = () => {
    if (mode === 'status') {
      onStatusOnly({ payment_status: statusOnly, note: note.trim() || undefined })
      return
    }
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    setError(null)
    onConfirm({ amount: value, method, status, note: note.trim() || undefined })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Payment"
      description={`Total ${formatCurrency(booking.total_fare)} · outstanding ${formatCurrency(
        outstanding,
      )}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {mode === 'status' ? 'Update status' : 'Record payment'}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex gap-1 rounded-lg bg-ink-100 p-1">
        {[
          { key: 'record', label: 'Record a payment' },
          { key: 'status', label: 'Set status only' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMode(tab.key)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              mode === tab.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === 'record' ? (
        <div className="space-y-4">
          <Field label="Amount (₹)" htmlFor="payAmount" error={error} required>
            <Input
              id="payAmount"
              type="number"
              min="1"
              step="1"
              className="tabular"
              value={amount}
              invalid={Boolean(error)}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Method" htmlFor="payMethod">
              <Select
                id="payMethod"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="netbanking">Net banking</option>
              </Select>
            </Field>
            <Field label="Outcome" htmlFor="payStatus">
              <Select
                id="payStatus"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="paid">Paid</option>
                <option value="partially_paid">Partially paid</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
              </Select>
            </Field>
          </div>
        </div>
      ) : (
        <Field label="Payment status" htmlFor="statusOnly">
          <Select
            id="statusOnly"
            value={statusOnly}
            onChange={(event) => setStatusOnly(event.target.value)}
          >
            {Object.entries(PAYMENT_STATUS_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Note" htmlFor="payNote" className="mt-4" optionalLabel>
        <Input
          id="payNote"
          maxLength={300}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </Modal>
  )
}
