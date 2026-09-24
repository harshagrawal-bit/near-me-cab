import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { driverService } from '@/services'
import { formatCurrency, formatPhone, titleCase } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody, StatCard } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonStats } from '@/components/ui/Loaders'
import { IconWallet } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'
import { buildUpiLink, canPayByUpi, copyText } from '@/lib/upi'

/**
 * Every driver's wallet on one screen.
 *
 * The reason an operator opens this page is almost always "who cannot work
 * right now", so drivers below the minimum sort to the top and are flagged.
 */
export default function AdminDriverWallets() {
  const navigate = useNavigate()
  const toast = useToast()
  const [onlyBelow, setOnlyBelow] = useState(false)
  const { data, loading, error, refetch } = useApi(
    () => driverService.walletsOverview({ below_minimum: onlyBelow || undefined }),
    [onlyBelow],
  )
  const [action, setAction] = useState(null)

  if (loading) return <SkeletonStats count={3} />
  if (error) return <ErrorState title="Could not load wallets" error={error} onRetry={refetch} />

  const rows = data?.items || []
  const totalHeld = rows.reduce((sum, row) => sum + Number(row.held || 0), 0)
  const totalBalance = rows.reduce((sum, row) => sum + Number(row.balance || 0), 0)

  const columns = [
    {
      key: 'name',
      header: 'Driver',
      card: 'title',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{row.name || '—'}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {row.phone ? formatPhone(row.phone) : '—'} · {titleCase(row.driver_type || '')}
          </p>
        </div>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      render: (row) => (
        <span
          className={row.below_minimum ? 'font-semibold text-danger-700' : 'font-semibold'}
        >
          {formatCurrency(row.balance)}
        </span>
      ),
    },
    { key: 'held', header: 'Held', render: (row) => formatCurrency(row.held) },
    {
      key: 'available',
      header: 'Available',
      render: (row) => <span className="tabular">{formatCurrency(row.available)}</span>,
    },
    {
      key: 'bank',
      header: 'Payout account',
      render: (row) =>
        row.bank_details ? (
          <span className="font-mono text-xs text-ink-600">
            {row.bank_details.account_number_masked}
          </span>
        ) : (
          <Badge tone="warning">No bank details</Badge>
        ),
    },
    {
      key: 'status',
      header: '',
      card: 'aside',
      render: (row) =>
        row.below_minimum ? <Badge tone="danger">Cannot accept trips</Badge> : null,
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAction({ row, kind: 'payout' })}
          >
            Pay
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAction({ row, kind: 'penalty' })}
          >
            Penalty
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Driver wallets"
        description="Balances, holds and payouts across the fleet."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Drivers" value={rows.length} />
        <StatCard label="Total balance" value={formatCurrency(totalBalance)} />
        <StatCard label="Held against live trips" value={formatCurrency(totalHeld)} />
      </div>

      {data?.below_minimum_count > 0 && !onlyBelow && (
        <Alert tone="warning" title={`${data.below_minimum_count} driver(s) below the minimum`}>
          They cannot accept trips until their balance is back above{' '}
          {formatCurrency(data.minimum_balance)}.
        </Alert>
      )}

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label="Show" htmlFor="filter" className="w-56">
            <Select
              id="filter"
              value={onlyBelow ? 'below' : 'all'}
              onChange={(event) => setOnlyBelow(event.target.value === 'below')}
            >
              <option value="all">All drivers</option>
              <option value="below">Only below the minimum</option>
            </Select>
          </Field>
        </CardBody>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        onRowClick={(row) => navigate(`/admin/drivers/${row.driver_id}`)}
        empty={
          <EmptyState
            icon={<IconWallet />}
            title="No wallets to show"
            description="Drivers appear here once they have an account."
          />
        }
      />

      {action && (
        <WalletActionModal
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null)
            refetch()
            toast.success('Wallet updated.')
          }}
        />
      )}
    </div>
  )
}

function WalletActionModal({ action, onClose, onDone }) {
  const toast = useToast()
  const { row, kind } = action
  const isPayout = kind === 'payout'
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const value = Number(amount)
    if (!value || value <= 0) {
      toast.error('Enter an amount.')
      return
    }
    if (!isPayout && note.trim().length < 3) {
      toast.error('A penalty needs a reason the driver can read.')
      return
    }
    setSaving(true)
    try {
      if (isPayout) {
        await driverService.payout(row.driver_id, { amount: value, note: note.trim() || undefined })
      } else {
        await driverService.penalty(row.driver_id, { amount: value, reason: note.trim() })
      }
      onDone()
    } catch (err) {
      toast.error(err?.message || 'Could not update the wallet.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isPayout ? `Pay ${row.name || 'driver'}` : `Charge ${row.name || 'driver'}`}
      description={
        isPayout
          ? 'Credits their wallet. They withdraw it through the usual request flow.'
          : 'Deducted from their wallet and shown in their statement with the reason.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant={isPayout ? 'brand' : 'danger'} loading={saving} onClick={submit}>
            {isPayout ? 'Pay driver' : 'Charge penalty'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Current balance <strong>{formatCurrency(row.balance)}</strong>
          {Number(row.held) > 0 && ` · ${formatCurrency(row.held)} held`}
        </p>

        {/* Paying the driver for real. The app records the credit; this is how
            the money actually moves, since a payment gateway can only refund
            back the way it came. */}
        {isPayout && (
          <div className="rounded-xl border border-ink-100 bg-ink-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Send the money
            </p>

            {canPayByUpi(row.bank_details) ? (
              <>
                <a
                  href={buildUpiLink(row.bank_details, amount, `Payout ${row.name || ''}`)}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800"
                >
                  Open UPI app and pay
                  {Number(amount) > 0 ? ` ${formatCurrency(amount)}` : ''}
                </a>
                <p className="mt-1.5 text-center text-xs text-ink-500">
                  Opens PhonePe, GPay or your bank app with{' '}
                  <span className="font-mono">{row.bank_details.upi_id}</span> filled in.
                  Works on your phone.
                </p>
              </>
            ) : row.bank_details ? (
              <>
                <p className="mt-2 text-xs text-ink-600">
                  This driver has given bank details but no UPI ID. A UPI link can only
                  address a UPI ID, so transfer this one in your banking app.
                </p>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <CopyRow label="Account" value={row.bank_details.account_number_masked} muted />
                  <CopyRow label="Name" value={row.bank_details.account_name} />
                  <CopyRow label="IFSC" value={row.bank_details.ifsc} />
                </dl>
                <p className="mt-2 text-xs text-ink-400">
                  The full account number is hidden here. Ask the driver to confirm it, or
                  add their UPI ID to pay in one tap next time.
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-amber-800">
                No payout details on file. Ask the driver to add a UPI ID or bank account
                in their wallet screen before you pay them.
              </p>
            )}

            <p className="mt-3 border-t border-ink-200 pt-2 text-xs text-ink-500">
              Send the money first, then record it below — the wallet credit is a record,
              not the transfer.
            </p>
          </div>
        )}
        <Field label="Amount (₹)" htmlFor="amt">
          <Input
            id="amt"
            type="number"
            min="1"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field
          label={isPayout ? 'Note (optional)' : 'Reason'}
          htmlFor="note"
          hint={isPayout ? 'Shown in their statement.' : 'The driver sees this.'}
        >
          <Input
            id="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={isPayout ? 'Share for trip NM-2026...' : 'Cancelled after accepting'}
          />
        </Field>
      </div>
    </Modal>
  )
}


/** One copyable payout detail. */
function CopyRow({ label, value, muted = false }) {
  const toast = useToast()
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className={muted ? 'font-mono text-ink-400' : 'font-mono text-ink-900'}>
          {value || '—'}
        </span>
        {value && !muted && (
          <button
            type="button"
            className="text-xs font-medium text-brand-700 hover:underline"
            onClick={async () => {
              const ok = await copyText(value)
              toast[ok ? 'success' : 'error'](ok ? 'Copied.' : 'Could not copy.')
            }}
          >
            Copy
          </button>
        )}
      </dd>
    </div>
  )
}
