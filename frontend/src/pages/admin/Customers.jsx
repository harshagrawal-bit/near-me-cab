import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi, useDebounced, useListState } from '@/hooks/useApi'
import { adminService } from '@/services'
import { formatCurrency, formatDate, formatPhone, initials } from '@/lib/format'
import { Card, CardBody } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import { Field, Input, Select } from '@/components/ui/Field'
import { EmptyState, PageHeader } from '@/components/ui/States'
import { IconSearch, IconUsers } from '@/components/ui/Icons'

export default function AdminCustomers() {
  const navigate = useNavigate()
  const { page, setPage, filters, setFilters } = useListState({})
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput, 350)

  const { data, loading, error, refetch } = useApi(
    () => adminService.customers({ ...filters, search: search || undefined, page, page_size: 20 }),
    [filters, search, page],
  )

  const columns = [
    {
      key: 'name',
      header: 'Customer',
      card: 'title',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
            {initials(row.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">{row.name}</p>
            <p className="truncate text-xs text-ink-500">{row.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (row) => formatPhone(row.phone) },
    {
      key: 'bookings',
      header: 'Bookings',
      align: 'right',
      render: (row) => <span className="tabular">{row.stats.total_bookings}</span>,
    },
    {
      key: 'completed',
      header: 'Completed',
      align: 'right',
      render: (row) => <span className="tabular">{row.stats.completed}</span>,
    },
    {
      key: 'spend',
      header: 'Total spend',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap tabular font-medium">
          {formatCurrency(row.stats.total_spend)}
        </span>
      ),
    },
    {
      key: 'last_booking',
      header: 'Last booking',
      render: (row) =>
        row.stats.last_booking_at ? (
          formatDate(row.stats.last_booking_at)
        ) : (
          <span className="text-ink-400">Never</span>
        ),
    },
    {
      key: 'status',
      header: 'Account',
      card: 'aside',
      render: (row) => <StatusBadge kind="account" status={row.status} />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Customers" description="Everyone who has signed up." />

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              className="pl-9"
              placeholder="Search name, email or phone"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search customers"
            />
          </div>
          <Field label="Account status" htmlFor="cstatus" className="w-48">
            <Select
              id="cstatus"
              value={filters.status || ''}
              placeholder="Any"
              onChange={(event) => setFilters({ status: event.target.value || undefined })}
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
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
        onRowClick={(row) => navigate(`/admin/customers/${row.id}`)}
        empty={
          <EmptyState
            icon={<IconUsers />}
            title="No customers found"
            description="Customers appear here once they create an account."
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
