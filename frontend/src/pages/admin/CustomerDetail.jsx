import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { adminService } from '@/services'
import { formatCurrency, formatDate, formatPhone, formatShortDateTime, initials } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader, DetailList, DetailRow, StatCard } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import { Field, Textarea } from '@/components/ui/Field'
import { ConfirmDialog } from '@/components/ui/Modal'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonCard } from '@/components/ui/Loaders'
import { IconChevronLeft, IconPin } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

export default function AdminCustomerDetail() {
  const { customerId } = useParams()
  const toast = useToast()
  const [dialog, setDialog] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: customer, loading, error, refetch } = useApi(
    () => adminService.customerDetail(customerId),
    [customerId],
  )
  const { data: bookings, loading: bookingsLoading } = useApi(
    () => adminService.customerBookings(customerId, { page_size: 20 }),
    [customerId],
  )

  if (loading) return <SkeletonCard lines={10} />
  if (error) return <ErrorState title="Could not load this customer" error={error} onRetry={refetch} />
  if (!customer) return null

  const isSuspended = customer.status === 'suspended'

  const toggleSuspension = async () => {
    setBusy(true)
    try {
      await adminService.suspendCustomer(customerId, {
        suspended: !isSuspended,
        reason: reason.trim() || undefined,
      })
      toast.success(isSuspended ? 'Account restored.' : 'Account suspended.')
      setDialog(null)
      setReason('')
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const columns = [
    {
      key: 'booking_id',
      header: 'Booking',
      card: 'title',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-mono text-xs text-ink-500">{row.booking_id}</p>
          <p className="mt-0.5 truncate font-medium text-ink-900">
            {row.route?.name || row.pickup?.address}
          </p>
        </div>
      ),
    },
    {
      key: 'scheduled_at',
      header: 'Pickup',
      render: (row) => formatShortDateTime(row.scheduled_at),
    },
    { key: 'driver', header: 'Driver', render: (row) => row.driver?.name || '—' },
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
    <div className="space-y-5">
      <Link
        to="/admin/customers"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <IconChevronLeft className="h-4 w-4" />
        All customers
      </Link>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink-800 text-lg font-semibold text-white">
                {initials(customer.name)}
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-tight text-ink-900">
                  {customer.name}
                </h1>
                <p className="truncate text-sm text-ink-500">
                  {customer.email} · {formatPhone(customer.phone)}
                </p>
                <div className="mt-2">
                  <StatusBadge kind="account" status={customer.status} />
                </div>
              </div>
            </div>
            <Button
              variant={isSuspended ? 'brand' : 'danger-outline'}
              onClick={() => setDialog('suspend')}
            >
              {isSuspended ? 'Restore account' : 'Suspend account'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total bookings" value={customer.stats.total_bookings} />
        <StatCard label="Completed" value={customer.stats.completed} tone="success" />
        <StatCard
          label="Cancelled"
          value={customer.stats.cancelled}
          tone={customer.stats.cancelled > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Total spend"
          value={formatCurrency(customer.stats.total_spend)}
          hint="Completed trips only"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader title="Booking history" />
          <CardBody className="p-0 sm:p-0">
            <div className="p-4 sm:p-5">
              <DataTable
                columns={columns}
                rows={bookings?.items}
                loading={bookingsLoading}
                empty={
                  <EmptyState
                    compact
                    title="No bookings yet"
                    description="This customer has not booked a trip."
                  />
                }
              />
            </div>
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Account" />
            <CardBody>
              <DetailList>
                <DetailRow label="Name" value={customer.name} />
                <DetailRow label="Email" value={customer.email} />
                <DetailRow label="Phone" value={formatPhone(customer.phone)} />
                <DetailRow label="Joined" value={formatDate(customer.created_at)} />
                <DetailRow
                  label="Last sign in"
                  value={
                    customer.last_login_at ? formatShortDateTime(customer.last_login_at) : 'Never'
                  }
                />
                {customer.suspension_reason && (
                  <DetailRow label="Suspension reason" value={customer.suspension_reason} />
                )}
              </DetailList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Saved locations" />
            <CardBody>
              {customer.saved_locations?.length ? (
                <ul className="space-y-2.5">
                  {customer.saved_locations.map((location, index) => (
                    <li key={index} className="flex items-start gap-2.5">
                      <IconPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900">{location.label}</p>
                        <p className="text-sm text-ink-500">{location.address}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-500">No saved locations.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'suspend'}
        onClose={() => setDialog(null)}
        onConfirm={toggleSuspension}
        loading={busy}
        title={isSuspended ? 'Restore this account?' : 'Suspend this account?'}
        confirmLabel={isSuspended ? 'Restore account' : 'Suspend account'}
        tone={isSuspended ? 'primary' : 'danger'}
      >
        <p className="text-sm text-ink-600">
          {isSuspended
            ? `${customer.name} will be able to sign in and book again.`
            : `${customer.name} will be signed out and blocked from signing in. Existing bookings are not cancelled.`}
        </p>
        {!isSuspended && (
          <Field label="Reason" htmlFor="suspendReason" className="mt-4" optionalLabel>
            <Textarea
              id="suspendReason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        )}
      </ConfirmDialog>
    </div>
  )
}
