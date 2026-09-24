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
