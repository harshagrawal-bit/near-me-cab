import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { fleetService, paymentService } from '@/services'
import { formatCurrency, formatShortDateTime, titleCase } from '@/lib/format'
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import Pagination from '@/components/ui/Pagination'
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonStats, SkeletonList } from '@/components/ui/Loaders'
import { IconWallet } from '@/components/ui/Icons'
import Button from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { startPayment } from '@/lib/razorpay'

/** Amounts a driver most often adds, so the common case is one tap. */
const QUICK_AMOUNTS = [500, 1000, 2000, 5000]

const WITHDRAWAL_TONE = {
  paid: 'success',
  rejected: 'danger',
  pending: 'warning',
}

/** How each ledger entry should read to a driver. */
const TXN_META = {
  deposit: { label: 'Deposit added', tone: 'success' },
  withdrawal: { label: 'Withdrawn', tone: 'neutral' },
  hold: { label: 'Held for trip', tone: 'warning' },
  release: { label: 'Hold released', tone: 'info' },
  commission: { label: 'Commission', tone: 'neutral' },
  adjustment: { label: 'Adjustment', tone: 'info' },
}

export default function DriverWallet() {
  const [page, setPage] = useState(1)
  const { data: wallet, loading, error, refetch } = useApi(() => fleetService.wallet(), [])
  const { data: ledger, loading: ledgerLoading, refetch: refetchLedger } = useApi(
    () => fleetService.transactions({ page, page_size: 20 }),
    [page],
  )
  const { data: withdrawals, refetch: refetchWithdrawals } = useApi(
    () => fleetService.withdrawals(),
    [],
  )
  const { data: payMethods } = useApi(() => paymentService.methods(), [])
  const onlineEnabled = Boolean(payMethods?.online_enabled)
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [paying, setPaying] = useState(false)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)

  const MIN_TOPUP = 100

  function refreshAll() {
    refetch()
    refetchLedger()
    refetchWithdrawals()
  }

  async function topUp(value) {
    const rupees = Number(value)
    // Checked here as well as on the server: failing before Razorpay opens is
    // far less confusing than a rejection after the sheet appears.
    if (!rupees || rupees < MIN_TOPUP) {
      toast.error(`Enter at least ${formatCurrency(MIN_TOPUP)}.`)
      return
    }
    setPaying(true)
    try {
      await startPayment({
        purpose: 'wallet_topup',
        amount: rupees,
        description: 'Security deposit top-up',
      })
      toast.success('Deposit added to your wallet.')
      setAmount('')
      refreshAll()
    } catch (err) {
      if (err?.cancelled) return
      if (err?.pending) {
        // The webhook has almost certainly not landed yet, so refreshing now
        // would show the old balance and read as a failure. Say so instead.
        toast.info('Payment received. Your balance updates once the bank confirms.')
        return
      }
      toast.error(err?.message || 'The payment did not go through.')
    } finally {
      setPaying(false)
    }
  }

  if (loading) return <SkeletonStats count={3} />
  if (error) return <ErrorState title="Could not load your wallet" error={error} onRetry={refetch} />

  const shortfall = Math.max(0, (wallet.min_balance || 0) - (wallet.balance || 0))
  // Held funds back a live trip, so they are not the driver's to take yet.
  const availableToWithdraw = Math.max(0, (wallet.balance || 0) - (wallet.held || 0))
  const requests = withdrawals?.items || []
  const openRequest = requests.find((request) => request.status === 'pending')
  const recentWithdrawals = requests.filter((request) => request.status !== 'pending').slice(0, 4)

  async function requestWithdrawal() {
    const rupees = Number(withdrawAmount)
    if (!rupees || rupees <= 0) {
      toast.error('Enter an amount to withdraw.')
      return
    }
    if (rupees > availableToWithdraw) {
      toast.error(`You can withdraw up to ${formatCurrency(availableToWithdraw)}.`)
      return
    }
    setWithdrawing(true)
    try {
      await fleetService.requestWithdrawal({ amount: rupees })
      toast.success('Withdrawal requested. The office will transfer it shortly.')
      setWithdrawAmount('')
      refetchWithdrawals()
    } catch (err) {
      toast.error(err?.message || 'Could not request the withdrawal.')
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Wallet"
        description="Your security deposit. Trips hold a part of it while they run."
      />

      {!wallet.eligible && (
        <Alert tone="warning" title="You cannot accept trips yet">
          {wallet.reason ||
            `Keep at least ${formatCurrency(wallet.min_balance)} in your wallet to accept trips.`}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Balance" value={formatCurrency(wallet.balance)} />
        <StatCard
          label="Available"
          value={formatCurrency(wallet.available)}
          hint="Free to use on a new trip"
          tone={wallet.available > 0 ? 'success' : 'default'}
        />
        <StatCard
          label="Held"
          value={formatCurrency(wallet.held)}
          hint="Committed to live trips"
          tone={wallet.held > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Minimum"
          value={formatCurrency(wallet.min_balance)}
          hint={shortfall > 0 ? `Short by ${formatCurrency(shortfall)}` : 'Requirement met'}
          tone={shortfall > 0 ? 'danger' : 'success'}
        />
      </div>

      <Card>
        <CardHeader
          title="Adding money"
          description={
            onlineEnabled
              ? 'Pay by card, UPI, netbanking or wallet. Credited the moment it clears.'
              : 'Deposits are recorded by the operations team.'
          }
        />
        <CardBody>
          {onlineEnabled ? (
            <>
              {shortfall > 0 && (
                <Alert tone="warning" className="mb-4">
                  You are {formatCurrency(shortfall)} below the minimum balance. Add at
                  least that much to start accepting trips again.
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                {QUICK_AMOUNTS.map((value) => (
                  <Button
                    key={value}
                    variant="secondary"
                    disabled={paying}
                    onClick={() => topUp(value)}
                  >
                    {formatCurrency(value)}
                  </Button>
                ))}
              </div>
              <div className="mt-4 flex items-end gap-3">
                <Field label="Other amount" className="flex-1">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="100"
                    placeholder="2500"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </Field>
                <Button
                  variant="brand"
                  loading={paying}
                  disabled={!amount}
                  onClick={() => topUp(amount)}
                >
                  Add money
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-600">
              Online top-up is not available yet. Transfer the amount to the office and the
              operations team will add it to your wallet, where it will appear in the
              statement below.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Taking money out"
          description="Request a withdrawal and the office transfers it to your account."
        />
        <CardBody>
          {openRequest ? (
            <Alert tone="info">
              Withdrawal of {formatCurrency(openRequest.amount)} requested on{' '}
              {formatShortDateTime(openRequest.created_at)}. Waiting for the office to
              approve it. Your balance changes only once the transfer is made.
            </Alert>
          ) : (
            <>
              <p className="text-sm text-ink-600">
                You can withdraw up to <strong>{formatCurrency(availableToWithdraw)}</strong>.
                {(wallet.held || 0) > 0 &&
                  ` ${formatCurrency(wallet.held)} is held against trips in progress and cannot be withdrawn yet.`}
              </p>
              <div className="mt-4 flex items-end gap-3">
                <Field label="Amount" className="flex-1">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    placeholder="1000"
                    value={withdrawAmount}
                    onChange={(event) => setWithdrawAmount(event.target.value)}
                  />
                </Field>
                <Button
                  variant="secondary"
                  loading={withdrawing}
                  disabled={!withdrawAmount || availableToWithdraw <= 0}
                  onClick={requestWithdrawal}
                >
                  Request
                </Button>
              </div>
            </>
          )}

          {recentWithdrawals.length > 0 && (
            <div className="mt-5 border-t border-ink-100 pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">
                Recent requests
              </p>
              <ul className="space-y-2">
                {recentWithdrawals.map((request) => (
                  <li key={request.id} className="flex items-center justify-between text-sm">
                    <span className="text-ink-600">
                      {formatCurrency(request.amount)} ·{' '}
                      {formatShortDateTime(request.created_at)}
                    </span>
                    <Badge tone={WITHDRAWAL_TONE[request.status] || 'neutral'}>
                      {titleCase(request.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Statement" description="Every movement in and out of your wallet." />
        <CardBody>
          {ledgerLoading ? (
            <SkeletonList count={4} lines={1} />
          ) : !ledger?.items?.length ? (
            <EmptyState
              compact
              icon={<IconWallet />}
              title="Nothing yet"
              description="Your deposits and trip holds will appear here."
            />
          ) : (
            <>
              <ul className="divide-y divide-ink-100">
                {ledger.items.map((txn) => {
                  const meta = TXN_META[txn.type] || {
                    label: titleCase(txn.type),
                    tone: 'neutral',
                  }
                  // Holds move availability, not balance, so showing them with a
                  // +/- sign would look like money appearing and vanishing.
                  const isHold = txn.type === 'hold' || txn.type === 'release'
                  const positive = txn.amount > 0
                  return (
                    <li
                      key={txn.id}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          {txn.note && (
                            <span className="truncate text-xs text-ink-500">{txn.note}</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-ink-400">
                          {formatShortDateTime(txn.created_at)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={
                            isHold
                              ? 'tabular text-sm font-medium text-ink-500'
                              : positive
                                ? 'tabular text-sm font-semibold text-success-700'
                                : 'tabular text-sm font-semibold text-ink-900'
                          }
                        >
                          {isHold ? '' : positive ? '+' : '−'}
                          {formatCurrency(Math.abs(txn.amount))}
                        </p>
                        <p className="text-xs text-ink-400">
                          Balance {formatCurrency(txn.balance_after)}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-4">
                <Pagination
                  page={ledger.page}
                  pages={ledger.pages}
                  total={ledger.total}
                  pageSize={ledger.page_size}
                  onPageChange={setPage}
                />
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
