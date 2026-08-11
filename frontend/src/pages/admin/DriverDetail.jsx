import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { bookingService, driverService, vehicleService } from '@/services'
import { DOCUMENT_STATUS_META, VERIFICATION_STATUS_META } from '@/lib/constants'
import {
  formatCurrency,
  formatDate,
  formatPhone,
  formatShortDateTime,
  initials,
  titleCase,
} from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader, DetailList, DetailRow, StatCard } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import Tabs from '@/components/ui/Tabs'
import { Field, Input, Select } from '@/components/ui/Field'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Alert, EmptyState, ErrorState } from '@/components/ui/States'
import { SkeletonCard } from '@/components/ui/Loaders'
import { IconCheck, IconChevronLeft, IconDocument, IconStar, IconStarFilled } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'documents', label: 'Documents' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'wallet', label: 'Wallet' },
]

export default function AdminDriverDetail() {
  const { driverId } = useParams()
  const toast = useToast()
  const [tab, setTab] = useState('overview')
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(false)

  const { data: driver, loading, error, refetch } = useApi(
    () => driverService.detail(driverId),
    [driverId],
  )

  if (loading) return <SkeletonCard lines={10} />
  if (error) return <ErrorState title="Could not load this driver" error={error} onRetry={refetch} />
  if (!driver) return null

  const run = async (fn, message) => {
    setBusy(true)
    try {
      await fn()
      toast.success(message)
      setDialog(null)
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const isVerified = driver.verification_status === 'verified'
  const isActive = driver.status === 'active'

  return (
    <div className="space-y-5">
      <Link
        to="/admin/drivers"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <IconChevronLeft className="h-4 w-4" />
        All drivers
      </Link>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold text-white">
                {initials(driver.name)}
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-tight text-ink-900">
                  {driver.name}
                </h1>
                <p className="truncate text-sm text-ink-500">
                  {driver.email} · {formatPhone(driver.phone)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge kind="verification" status={driver.verification_status} />
                  <StatusBadge kind="account" status={driver.status} />
                  <Badge tone={driver.is_available ? 'success' : 'neutral'}>
                    {driver.is_available ? 'Online' : 'Offline'}
                  </Badge>
                  {driver.rating_count > 0 && (
                    <Badge tone="warning" dot={false}>
                      <IconStarFilled className="h-3 w-3" />
                      {driver.rating_avg} ({driver.rating_count})
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!isVerified && (
                <Button onClick={() => setDialog('verify')}>
                  <IconCheck className="h-4 w-4" />
                  Verify driver
                </Button>
              )}
              {isVerified && (
                <Button variant="secondary" onClick={() => setDialog('unverify')}>
                  Revoke verification
                </Button>
              )}
              <Button variant="secondary" onClick={() => setDialog('vehicle')}>
                {driver.vehicle ? 'Change vehicle' : 'Assign vehicle'}
              </Button>
              <Button
                variant={isActive ? 'danger-outline' : 'brand'}
                onClick={() => setDialog(isActive ? 'deactivate' : 'activate')}
              >
                {isActive ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'overview' && <Overview driver={driver} />}
      {tab === 'documents' && <Documents driver={driver} />}
      {tab === 'bookings' && <Bookings driverId={driverId} />}
      {tab === 'earnings' && <Earnings driverId={driverId} />}
      {tab === 'wallet' && <Wallet driverId={driverId} />}

      <ConfirmDialog
        open={dialog === 'verify'}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          run(
            () => driverService.update(driverId, { verification_status: 'verified' }),
            'Driver verified.',
          )
        }
        loading={busy}
        title="Verify this driver?"
        message="They will be able to go online and accept trip assignments. Check their documents first."
        confirmLabel="Verify driver"
        tone="primary"
      />

      <ConfirmDialog
        open={dialog === 'unverify'}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          run(
            () => driverService.update(driverId, { verification_status: 'pending' }),
            'Verification revoked.',
          )
        }
        loading={busy}
        title="Revoke verification?"
        message="The driver will be taken offline and cannot be assigned new trips."
        confirmLabel="Revoke"
      />

      <ConfirmDialog
        open={dialog === 'deactivate'}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          run(() => driverService.update(driverId, { status: 'inactive' }), 'Driver deactivated.')
        }
        loading={busy}
        title="Deactivate this driver?"
        message="They will be taken offline and excluded from assignment. Existing trips are unaffected."
        confirmLabel="Deactivate"
      />

      <ConfirmDialog
        open={dialog === 'activate'}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          run(() => driverService.update(driverId, { status: 'active' }), 'Driver activated.')
        }
        loading={busy}
        title="Activate this driver?"
        message="They will be able to go online again."
        confirmLabel="Activate"
        tone="primary"
      />

      <AssignVehicleModal
        open={dialog === 'vehicle'}
        onClose={() => setDialog(null)}
        driver={driver}
        busy={busy}
        onConfirm={(vehicleId) =>
          run(
            () => driverService.update(driverId, { assigned_vehicle_id: vehicleId || null }),
            vehicleId ? 'Vehicle assigned.' : 'Vehicle unassigned.',
          )
        }
      />
    </div>
  )
}

function Overview({ driver }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Driver details" />
        <CardBody>
          <DetailList>
            <DetailRow label="Full name" value={driver.name} />
            <DetailRow label="Email" value={driver.email} />
            <DetailRow label="Phone" value={formatPhone(driver.phone)} />
            <DetailRow
              label="Licence number"
              value={driver.licence_number}
              valueClassName="font-mono"
            />
            <DetailRow label="Licence expiry" value={formatDate(driver.licence_expiry)} />
            <DetailRow label="Total trips" value={driver.total_trips} />
            <DetailRow label="Joined" value={formatDate(driver.created_at)} />
            <DetailRow
              label="Account"
              value={<StatusBadge kind="account" status={driver.account_status} />}
            />
          </DetailList>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Assigned vehicle" />
        <CardBody>
          {driver.vehicle ? (
            <DetailList>
              <DetailRow label="Model" value={driver.vehicle.model} />
              <DetailRow
                label="Registration"
                value={driver.vehicle.registration_number}
                valueClassName="font-mono"
              />
              <DetailRow label="Class" value={driver.vehicle.class_info?.label} />
              <DetailRow label="Seats" value={driver.vehicle.seating_capacity} />
              <DetailRow label="AC" value={driver.vehicle.is_ac ? 'Yes' : 'No'} />
              <DetailRow
                label="Status"
                value={<StatusBadge kind="vehicle" status={driver.vehicle.status} />}
              />
            </DetailList>
          ) : (
            <EmptyState
              compact
              title="No vehicle assigned"
              description="Assign a vehicle before this driver can take trips."
            />
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Documents({ driver }) {
  const documents = driver.documents || []
  const expired = documents.filter((doc) => doc.status === 'expired')

  return (
    <Card>
      <CardHeader
        title="Documents"
        description="Verify each document before approving the driver."
        action={<StatusBadge kind="verification" status={driver.verification_status} />}
      />
      <CardBody>
        {expired.length > 0 && (
          <Alert tone="danger" className="mb-4">
            {expired.length} document{expired.length > 1 ? 's have' : ' has'} expired. Collect
            updated copies before allowing trips.
          </Alert>
        )}
        {documents.length === 0 ? (
          <EmptyState
            compact
            icon={<IconDocument />}
            title="No documents on file"
            description="Documents are added when the driver record is created or edited."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {documents.map((doc, index) => (
              <li
                key={`${doc.type}-${index}`}
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
                    <IconDocument className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">{doc.type}</p>
                    {doc.number && (
                      <p className="mt-0.5 font-mono text-xs text-ink-500">{doc.number}</p>
                    )}
                    {doc.expires_on && (
                      <p className="mt-0.5 text-xs text-ink-500">
                        Valid until {formatDate(doc.expires_on)}
                      </p>
                    )}
                  </div>
                </div>
                <StatusBadge kind="document" status={doc.status} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function Bookings({ driverId }) {
  const { data, loading, error, refetch } = useApi(
    () => driverService.bookings(driverId, { page_size: 20 }),
    [driverId],
  )

  const columns = [
    {
      key: 'booking_id',
      header: 'Booking',
      card: 'title',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-mono text-xs text-ink-500">{row.booking_id}</p>
          <p className="mt-0.5 truncate font-medium text-ink-900">{row.route?.name}</p>
        </div>
      ),
    },
    {
      key: 'scheduled_at',
      header: 'Pickup',
      render: (row) => formatShortDateTime(row.scheduled_at),
    },
    { key: 'customer', header: 'Customer', render: (row) => row.customer?.name || '—' },
    {
      key: 'total_fare',
      header: 'Fare',
      align: 'right',
      render: (row) => <span className="tabular">{formatCurrency(row.total_fare)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      card: 'aside',
      render: (row) => <StatusBadge status={row.status} />,
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={data?.items}
      loading={loading}
      error={error}
      onRetry={refetch}
      empty={
        <EmptyState title="No trips yet" description="This driver has not been assigned a trip." />
      }
    />
  )
}

function Earnings({ driverId }) {
  const { data, loading, error, refetch } = useApi(
    () => driverService.earnings(driverId),
    [driverId],
  )

  if (loading) return <SkeletonCard lines={4} />
  if (error) return <ErrorState error={error} onRetry={refetch} />

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Today"
          value={formatCurrency(data.today.earnings)}
          hint={`${data.today.trips} trips`}
        />
        <StatCard
          label="This week"
          value={formatCurrency(data.week.earnings)}
          hint={`${data.week.trips} trips`}
        />
        <StatCard
          label="This month"
          value={formatCurrency(data.month.earnings)}
          hint={`${data.month.trips} trips`}
        />
        <StatCard
          label="Lifetime"
          value={formatCurrency(data.lifetime.earnings)}
          hint={`${data.lifetime.trips} trips`}
          tone="success"
        />
      </div>

      <Card>
        <CardHeader title="Last 7 days" />
        <CardBody>
          <ul className="divide-y divide-ink-100">
            {[...(data.daily || [])].reverse().map((entry) => (
              <li key={entry.date} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-ink-900">{formatDate(entry.date)}</p>
                  <p className="text-xs text-ink-500">{entry.trips} trips</p>
                </div>
                <p className="text-sm font-semibold tabular text-ink-900">
                  {formatCurrency(entry.earnings)}
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  )
}

function AssignVehicleModal({ open, onClose, onConfirm, busy, driver }) {
  const { data: vehicles } = useApi(() => vehicleService.list({ page_size: 100 }), [], {
    enabled: open,
  })
  const [vehicleId, setVehicleId] = useState(driver.vehicle?.id || '')

  const available = (vehicles?.items || []).filter(
    (vehicle) =>
      vehicle.status !== 'inactive' &&
      (!vehicle.assigned_driver_id || vehicle.assigned_driver_id === driver.id),
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign a vehicle"
      description="Only unassigned, in-service vehicles are listed."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(vehicleId)} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Vehicle" htmlFor="vehicleSelect">
        <Select
          id="vehicleSelect"
          value={vehicleId}
          placeholder="No vehicle"
          onChange={(event) => setVehicleId(event.target.value)}
        >
          {available.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.model} · {vehicle.registration_number} ({vehicle.class_info?.label})
            </option>
          ))}
        </Select>
      </Field>
      {available.length === 0 && (
        <Alert tone="warning" className="mt-3">
          Every vehicle is already assigned. Free one up or add a new vehicle first.
        </Alert>
      )}
    </Modal>
  )
}


/**
 * Security deposit management.
 *
 * Top-ups are recorded here because there is no payment gateway behind the
 * wallet yet — operations add money they have actually received. The audit
 * strip recomputes the balance from the ledger, so a drift shows up here
 * rather than in an argument with a driver.
 */
function Wallet({ driverId }) {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const { data, loading, error, refetch } = useApi(
    () => driverService.wallet(driverId, page),
    [driverId, page],
  )
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  if (loading) return <SkeletonCard lines={6} />
  if (error) return <ErrorState title="Could not load the wallet" error={error} onRetry={refetch} />

  const topUp = async (event) => {
    event.preventDefault()
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Enter an amount greater than zero.')
      return
    }
    setSaving(true)
    try {
      await driverService.topUpWallet(driverId, { amount: value, note: note || undefined })
      toast.success(`${formatCurrency(value)} added to the wallet.`)
      setAmount('')
      setNote('')
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setSaving(false)
    }
  }

  const { summary, statement, audit } = data

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Balance" value={formatCurrency(summary.balance)} />
        <StatCard label="Available" value={formatCurrency(summary.available)} />
        <StatCard label="Held" value={formatCurrency(summary.held)} />
        <StatCard
          label="Eligible"
          value={summary.eligible ? 'Yes' : 'No'}
          tone={summary.eligible ? 'success' : 'danger'}
          hint={summary.reason || 'Meets the deposit requirement'}
        />
      </div>

      {(!audit.balance_matches || !audit.held_matches) && (
        <Alert tone="danger" title="Ledger mismatch">
          The stored balance ({formatCurrency(audit.stored_balance)}) does not agree with the
          sum of transactions ({formatCurrency(audit.ledger_balance)}). Do not adjust this
          wallet until the cause is understood.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Record a deposit"
          description="Only after the money has actually arrived."
        />
        <CardBody>
          <form onSubmit={topUp} className="flex flex-wrap items-end gap-3">
            <Field label="Amount" htmlFor="topup" className="w-40">
              <Input
                id="topup"
                type="number"
                min="1"
                step="1"
                placeholder="5000"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field label="Reference" htmlFor="topupnote" className="min-w-[14rem] flex-1">
              <Input
                id="topupnote"
                placeholder="UPI ref, cheque number, or note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <Button type="submit" loading={saving}>
              Add to wallet
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Statement" />
        <CardBody>
          {!statement.items.length ? (
            <EmptyState compact title="No transactions yet" />
          ) : (
            <ul className="divide-y divide-ink-100">
              {statement.items.map((txn) => (
                <li key={txn.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">{titleCase(txn.type)}</p>
                    <p className="text-xs text-ink-500">
                      {formatShortDateTime(txn.created_at)}
                      {txn.note ? ` · ${txn.note}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-sm font-semibold text-ink-900">
                      {formatCurrency(txn.amount)}
                    </p>
                    <p className="text-xs text-ink-400">
                      Balance {formatCurrency(txn.balance_after)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
