import { useNavigate } from 'react-router-dom'
import { useApi, useDebounced, useListState } from '@/hooks/useApi'
import { bookingService, driverService, routeService } from '@/services'
import { BOOKING_STATUS_META, PAYMENT_STATUS_META, TRIP_TYPES } from '@/lib/constants'
import { formatCurrency, formatShortDateTime } from '@/lib/format'
import { useState } from 'react'
import Button from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import { Field, Input, Select } from '@/components/ui/Field'
import { EmptyState, PageHeader } from '@/components/ui/States'
import { IconFilter, IconSearch, IconTicket } from '@/components/ui/Icons'

export default function AdminBookings() {
  const navigate = useNavigate()
  const { page, setPage, filters, setFilters, resetFilters } = useListState({})
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput, 350)
  const [showFilters, setShowFilters] = useState(false)

  const { data: routes } = useApi(() => routeService.list({ page_size: 100 }), [])
  const { data: drivers } = useApi(() => driverService.assignable(), [])

  const { data, loading, error, refetch } = useApi(
    () => bookingService.list({ ...filters, search: search || undefined, page, page_size: 20 }),
    [filters, search, page],
  )

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  const columns = [
    {
      key: 'booking_id',
      header: 'Booking',
      card: 'title',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-mono text-xs text-ink-500">{row.booking_id}</p>
          <p className="mt-0.5 truncate font-medium text-ink-900">
            {row.route?.name || `${row.pickup?.address} → ${row.drop?.address}`}
          </p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink-800">{row.customer?.name || '—'}</p>
          <p className="truncate text-xs text-ink-500">{row.passenger_phone}</p>
        </div>
      ),
    },
    {
      key: 'scheduled_at',
      header: 'Pickup',
      render: (row) => (
        <span className="whitespace-nowrap">{formatShortDateTime(row.scheduled_at)}</span>
      ),
    },
    {
      key: 'driver',
      header: 'Driver',
      render: (row) =>
        row.driver?.name ? (
          <span className="truncate">{row.driver.name}</span>
        ) : (
          <span className="text-ink-400">Unassigned</span>
        ),
    },
    {
      key: 'vehicle_type',
      header: 'Vehicle',
      render: (row) => row.vehicle_class?.label || row.vehicle_type,
    },
    {
      key: 'total_fare',
      header: 'Fare',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap tabular font-medium">
          {formatCurrency(row.total_fare)}
        </span>
      ),
    },
    {
      key: 'payment_status',
      header: 'Payment',
      render: (row) => <StatusBadge kind="payment" status={row.payment_status} dot={false} />,
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
      <PageHeader
        title="Bookings"
        description="Every booking across the business."
      />

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[14rem] flex-1">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input
                className="pl-9"
                placeholder="Search booking ID, passenger, phone or address"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                aria-label="Search bookings"
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
            >
              <IconFilter className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-2xs font-semibold text-white">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {(activeFilterCount > 0 || searchInput) && (
              <Button
                variant="ghost"
                onClick={() => {
                  resetFilters()
                  setSearchInput('')
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="grid gap-3 border-t border-ink-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Status" htmlFor="status">
                <Select
                  id="status"
                  value={filters.status || ''}
                  placeholder="Any status"
                  onChange={(event) => setFilters({ status: event.target.value || undefined })}
                >
                  {Object.entries(BOOKING_STATUS_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Payment status" htmlFor="paymentStatus">
                <Select
                  id="paymentStatus"
                  value={filters.payment_status || ''}
                  placeholder="Any payment"
                  onChange={(event) =>
                    setFilters({ payment_status: event.target.value || undefined })
                  }
                >
                  {Object.entries(PAYMENT_STATUS_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Trip type" htmlFor="tripType">
                <Select
                  id="tripType"
                  value={filters.trip_type || ''}
                  placeholder="Any trip type"
                  onChange={(event) => setFilters({ trip_type: event.target.value || undefined })}
                >
                  {TRIP_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Driver" htmlFor="driver">
                <Select
                  id="driver"
                  value={filters.driver_id || ''}
                  placeholder="Any driver"
                  onChange={(event) => setFilters({ driver_id: event.target.value || undefined })}
                >
                  {(drivers || []).map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Route" htmlFor="route">
                <Select
                  id="route"
                  value={filters.route_id || ''}
                  placeholder="Any route"
                  onChange={(event) => setFilters({ route_id: event.target.value || undefined })}
                >
                  {(routes?.items || []).map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="From" htmlFor="dateFrom">
                  <Input
                    id="dateFrom"
                    type="date"
                    value={filters.date_from?.slice(0, 10) || ''}
                    onChange={(event) =>
                      setFilters({
                        date_from: event.target.value
                          ? `${event.target.value}T00:00:00`
                          : undefined,
                      })
                    }
                  />
                </Field>
                <Field label="To" htmlFor="dateTo">
                  <Input
                    id="dateTo"
                    type="date"
                    value={filters.date_to?.slice(0, 10) || ''}
                    onChange={(event) =>
                      setFilters({
                        date_to: event.target.value
                          ? `${event.target.value}T23:59:59`
                          : undefined,
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <DataTable
        columns={columns}
        rows={data?.items}
        loading={loading}
        error={error}
        onRetry={refetch}
        onRowClick={(row) => navigate(`/admin/bookings/${row.id}`)}
        empty={
          <EmptyState
            icon={<IconTicket />}
            title="No bookings match"
            description={
              activeFilterCount || searchInput
                ? 'Try widening your search or clearing the filters.'
                : 'Bookings will appear here as customers make them.'
            }
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
