import { useState } from 'react'
import { formatCurrency } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Field'
import { Alert } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { startPayment } from '@/lib/razorpay'

/**
 * Shown when a driver taps Accept without enough wallet balance.
 *
 * The Accept button used to be disabled, which told a driver they could not
 * take the work but not what to do about it — they had to find the wallet
 * screen themselves and work out the number. Now tapping it opens this, with
 * the shortfall already filled in and a way to pay it on the spot.
 */
export default function TopUpToAcceptModal({ open, onClose, wallet, trip, onToppedUp }) {
  const toast = useToast()

  // Enough to clear the floor AND cover this trip's hold, rounded up to a
  // sensible note so the driver is not left a rupee short of the next trip.
  const shortfall = Math.max(0, Number(wallet?.shortfall) || 0)
  const holdNeeded = Math.max(0, Number(trip?.wallet_required) || 0)
  const available = Number(wallet?.available) || 0
  const suggested = Math.max(
    100,
    Math.ceil((shortfall + Math.max(0, holdNeeded - available)) / 100) * 100,
  )

  const [amount, setAmount] = useState(String(suggested))
  const [paying, setPaying] = useState(false)

  async function pay() {
    const rupees = Number(amount)
    if (!rupees || rupees < 100) {
      toast.error('Enter at least ₹100.')
      return
    }
    setPaying(true)
    try {
      await startPayment({
        purpose: 'wallet_topup',
        amount: rupees,
        description: 'Wallet top-up to accept a trip',
      })
      toast.success('Wallet topped up. You can accept the trip now.')
      onToppedUp()
    } catch (err) {
      if (err?.cancelled) return
      if (err?.pending) {
        toast.info('Payment received. Your balance updates once the bank confirms.')
        return
      }
      toast.error(err?.message || 'The payment did not go through.')
    } finally {
      setPaying(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add money to accept this trip"
      description="Your wallet is the deposit that lets you take work. It stays yours."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={paying}>
            Not now
          </Button>
          <Button variant="brand" loading={paying} onClick={pay}>
            Pay {formatCurrency(Number(amount) || 0)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="warning">{wallet?.reason || 'Your balance is below the minimum.'}</Alert>

        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Your balance</dt>
            <dd className="font-medium tabular text-ink-900">
              {formatCurrency(wallet?.balance)}
            </dd>
          </div>
          {holdNeeded > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">This trip holds</dt>
              <dd className="font-medium tabular text-ink-900">
                {formatCurrency(holdNeeded)}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t border-ink-100 pt-1.5">
            <dt className="font-medium text-ink-700">Suggested top-up</dt>
            <dd className="font-bold tabular text-brand-700">{formatCurrency(suggested)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          {[suggested, suggested + 500, suggested + 1000].map((value) => (
            <Button
              key={value}
              variant={Number(amount) === value ? 'brand' : 'secondary'}
              size="sm"
              disabled={paying}
              onClick={() => setAmount(String(value))}
            >
              {formatCurrency(value)}
            </Button>
          ))}
        </div>

        <Field label="Or another amount (₹)" htmlFor="topupAmt">
          <Input
            id="topupAmt"
            type="number"
            min="100"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        <p className="text-xs text-ink-500">
          This is a deposit, not a fee. You can withdraw it whenever it is not held
          against a live trip.
        </p>
      </div>
    </Modal>
  )
}
