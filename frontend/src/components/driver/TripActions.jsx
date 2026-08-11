import { useState } from 'react'
import { bookingService } from '@/services'
import { DRIVER_ACTIONS, TERMINAL_STATUSES } from '@/lib/constants'
import Button from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Alert } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

/**
 * The driver's status control for one trip.
 *
 * Exactly one action is offered at a time — the next legal step — and it is
 * always behind a confirmation dialog, so a status cannot be advanced by an
 * accidental tap while driving.
 */
export default function TripActions({ booking, onUpdated }) {
  const toast = useToast()
  const [pending, setPending] = useState(null)
  const [saving, setSaving] = useState(false)

  const action = DRIVER_ACTIONS.find((item) => item.from === booking.status)

  if (TERMINAL_STATUSES.includes(booking.status)) {
    return (
      <Alert tone={booking.status === 'completed' ? 'success' : 'neutral'}>
        {booking.status === 'completed'
          ? 'This trip is complete. Earnings have been credited.'
          : 'This booking was cancelled.'}
      </Alert>
    )
  }

  if (!action) {
    return (
      <Alert tone="neutral">
        Waiting on the operations team for the next step on this trip.
      </Alert>
    )
  }

  const confirm = async () => {
    setSaving(true)
    try {
      await bookingService.setStatus(booking.id, action.to)
      toast.success(`Trip marked as ${action.label.toLowerCase()}.`)
      setPending(null)
      onUpdated?.()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        size="lg"
        fullWidth
        variant={action.tone === 'success' ? 'brand' : 'primary'}
        onClick={() => setPending(action)}
      >
        {action.label}
      </Button>

      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={confirm}
        loading={saving}
        title={pending?.label}
        message={pending?.confirm}
        confirmLabel="Yes, confirm"
        tone={pending?.tone === 'success' ? 'success' : 'primary'}
      />
    </>
  )
}
