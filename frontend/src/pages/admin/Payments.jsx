import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi, useDebounced, useListState } from '@/hooks/useApi'
import { paymentService } from '@/services'
import { PAYMENT_STATUS_META } from '@/lib/constants'
import { formatCurrency, formatShortDateTime, titleCase } from '@/lib/format'
import { Card, CardBody } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import { Field, Input, Select } from '@/components/ui/Field'
import { Alert, EmptyState, PageHeader } from '@/components/ui/States'
import Button from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { IconSearch, IconWallet } from '@/components/ui/Icons'

export default function AdminPayments() {
  const navigate = useNavigate()
  const { page, setPage, filters, setFilters } = useListState({})
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput, 350)

  const toast = useToast()
  const { data: methods } = useApi(() => paymentService.methods(), [])
  const { data: queued, refetch: refetchQueued } = useApi(
    () => paymentService.pendingRefunds(),
    [],
  )
  const [acting, setActing] = useState(null)

  async function act(id, what) {
    setActing(id)
    try {
      if (what === 'retry') {
        await paymentService.retryRefund(id)
        toast.success('Refund sent.')
      } else {
        await paymentService.settleRefund(id, { note: 'Returned outside the gateway' })
        toast.success('Marked as returned by hand.')
      }
      refetchQueued()
      refetch()
    } catch (err) {
      toast.error(err?.message || 'Could not update the refund.')
    } finally {
      setActing(null)
    }
  }
  const { data, loading, error, refetch } = useApi(
    () => paymentService.list({ ...filters, search: search || undefined, page, page_size: 20 }),
    [filters, search, page],
  )

  const columns = [
    {
      key: 'booking_reference',
      header: 'Booking',
      card: 'title',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium text-ink-900">{row.booking_reference}</p>
          <p className="mt-0.5 truncate text-xs text-ink-500">{row.customer_name || '—'}</p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      render: (row) =>
        row.kind === 'refund' ? (
          <Badge tone={row.refund_state === 'pending' ? 'warning' : 'info'}>
            {row.refund_state === 'pending' ? 'Refund queued' : 'Refund'}
          </Badge>
        ) : (
          <span className="text-sm text-ink-600">{titleCase(row.kind || 'payment')}</span>
        ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap tabular font-medium">
          {formatCurrency(row.amount)}
        </span>
      ),
    },
    { key: 'method', header: 'Method', render: (row) => titleCase(row.method) },
    { key: 'provider', header: 'Provider', render: (row) => titleCase(row.provider) },
    {
      key: 'created_at',
      header: 'Recorded',
      render: (row) => formatShortDateTime(row.created_at),
    },
    { key: 'note', header: 'Note', render: (row) => row.note || '—' },
    {
      key: 'status',
      header: 'Status',
      card: 'aside',
      render: (row) => <StatusBadge kind="payment" status={row.status} />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        description="The payment ledger — gateway payments, manually recorded ones, and refunds."
      />

      {methods && !methods.online_enabled && (
        <Alert tone="info" title="Online payments are not connected">
          Payments are currently recorded manually by your team. The ledger is provider-agnostic,
          so a gateway such as Razorpay can be added later without changing these records.
        </Alert>
      )}

      {queued?.items?.length > 0 && (
        <Card>
          <CardBody>
            <Alert tone="warning" title={`${queued.items.length} refund(s) not yet sent`}>
              This is money owed to customers that has not left the account — either the
              gateway call failed or the advance was paid offline. Retry sends it through
              Razorpay; mark as returned if you have already handed it back.
            </Alert>
            <ul className="mt-4 divide-y divide-ink-100">
              {queued.items.map((refund) => (
                <li
                  key={refund.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium text-ink-900">
                      {refund.booking_reference}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {formatCurrency(Math.abs(refund.amount))} ·{' '}
                      {refund.customer_name || 'Customer'}
                      {refund.customer_phone ? ` · ${refund.customer_phone}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={acting === refund.id}
                      onClick={() => act(refund.id, 'retry')}
                    >
                      Retry
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={acting === refund.id}
                      onClick={() => act(refund.id, 'settle')}
                    >
                      Returned by hand
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              className="pl-9"
              placeholder="Search booking reference"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search payments"
            />
          </div>
          <Field label="Status" htmlFor="pstatus" className="w-48">
            <Select
              id="pstatus"
              value={filters.status || ''}
              placeholder="Any status"
              onChange={(event) => setFilters({ status: event.target.value || undefined })}
            >
              {Object.entries(PAYMENT_STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <DataTable
        columns={columns}
        rows={data?.items}
        loading={loading}
        error={error}
        onRetry={refetch}
        onRowClick={(row) => navigate(`/admin/bookings/${row.booking_id}`)}
        empty={
          <EmptyState
            icon={<IconWallet />}
            title="No payments recorded"
            description="Record a payment from a booking's detail page and it will appear here."
          />
        }
      />

      {data && (
        <Pagination
          page={data.page}
          pages={data.pages}
          total={data.total}
          pageSize={data.page_size}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
