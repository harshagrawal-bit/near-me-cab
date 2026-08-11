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
import { IconSearch, IconWallet } from '@/components/ui/Icons'

export default function AdminPayments() {
  const navigate = useNavigate()
  const { page, setPage, filters, setFilters } = useListState({})
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput, 350)

  const { data: methods } = useApi(() => paymentService.methods(), [])
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
        description="The payment ledger. Records are created when your team logs a payment on a booking."
      />

      {methods && !methods.online_enabled && (
        <Alert tone="info" title="Online payments are not connected">
          Payments are currently recorded manually by your team. The ledger is provider-agnostic,
          so a gateway such as Razorpay can be added later without changing these records.
        </Alert>
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
