import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useApi } from '@/hooks/useApi'
import { adminService } from '@/services'
import { formatCurrency, formatDate, formatNumber, toDateInputValue, titleCase } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonStats, Skeleton } from '@/components/ui/Loaders'
import { IconChart, IconDownload, IconStar, IconStarFilled } from '@/components/ui/Icons'

/** Presets keep the common questions one click away. */
const PRESETS = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
]

function rangeFor(days) {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: toDateInputValue(from), to: toDateInputValue(to) }
}

export default function AdminReports() {
  const [preset, setPreset] = useState('30')
  const [range, setRange] = useState(rangeFor(30))

  const { data, loading, error, refetch } = useApi(
    () =>
      adminService.reports({
        date_from: range.from ? `${range.from}T00:00:00` : undefined,
        date_to: range.to ? `${range.to}T23:59:59` : undefined,
      }),
    [range.from, range.to],
  )

  const applyPreset = (item) => {
    setPreset(item.key)
    setRange(rangeFor(item.days))
  }

  /** Client-side CSV so the operator can pull numbers into a spreadsheet. */
  const exportCsv = () => {
    if (!data) return
    const lines = [
      ['Report', `${range.from} to ${range.to}`],
      [],
      ['Summary'],
      ['Total bookings', data.summary.total_bookings],
      ['Completed trips', data.summary.completed_trips],
      ['Cancelled trips', data.summary.cancelled_trips],
      ['Revenue (INR)', data.summary.revenue],
      ['Average fare (INR)', data.summary.average_fare],
      ['Completion rate (%)', data.summary.completion_rate],
      [],
      ['Driver', 'Trips', 'Revenue (INR)', 'Rating', 'Cancelled'],
      ...data.drivers.map((row) => [row.name, row.trips, row.revenue, row.rating, row.cancelled]),
      [],
      ['Route', 'Bookings', 'Completed', 'Revenue (INR)'],
      ...data.routes.map((row) => [row.name, row.bookings, row.completed, row.revenue]),
      [],
      ['Date', 'Bookings', 'Revenue (INR)'],
      ...data.daily.map((row) => [row.date, row.bookings, row.revenue]),
    ]
    const csv = lines
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `localride-report-${range.from}-to-${range.to}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const driverColumns = [
    { key: 'name', header: 'Driver', card: 'title', render: (row) => row.name },
    {
      key: 'trips',
      header: 'Trips',
      align: 'right',
      render: (row) => <span className="tabular">{row.trips}</span>,
    },
    {
      key: 'revenue',
      header: 'Revenue',
      align: 'right',
      render: (row) => (
        <span className="tabular font-medium">{formatCurrency(row.revenue)}</span>
      ),
    },
    {
      key: 'rating',
      header: 'Rating',
      align: 'right',
      render: (row) =>
        row.rating ? (
          <span className="inline-flex items-center gap-1 tabular">
            <IconStarFilled className="h-3.5 w-3.5 text-warning-600" />
            {row.rating}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'cancelled',
      header: 'Cancelled',
      align: 'right',
      card: 'aside',
      render: (row) => <span className="tabular">{row.cancelled}</span>,
    },
  ]

  const routeColumns = [
    { key: 'name', header: 'Route', card: 'title', render: (row) => row.name },
    {
      key: 'bookings',
      header: 'Bookings',
      align: 'right',
      render: (row) => <span className="tabular">{row.bookings}</span>,
    },
    {
      key: 'completed',
      header: 'Completed',
      align: 'right',
      render: (row) => <span className="tabular">{row.completed}</span>,
    },
    {
      key: 'revenue',
      header: 'Revenue',
      align: 'right',
      card: 'aside',
      render: (row) => (
        <span className="tabular font-medium">{formatCurrency(row.revenue)}</span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Bookings, revenue and performance over a chosen period."
        action={
          <Button variant="secondary" onClick={exportCsv} disabled={!data}>
            <IconDownload className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1 rounded-lg bg-ink-100 p-1">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => applyPreset(item)}
                className={
                  preset === item.key
                    ? 'rounded-md bg-white px-3 py-1.5 text-sm font-medium text-ink-900 shadow-sm'
                    : 'rounded-md px-3 py-1.5 text-sm font-medium text-ink-600 hover:text-ink-900'
                }
              >
                {item.label}
              </button>
            ))}
          </div>
          <Field label="From" htmlFor="from" className="w-40">
            <Input
              id="from"
              type="date"
              value={range.from}
              onChange={(event) => {
                setPreset('custom')
                setRange({ ...range, from: event.target.value })
              }}
            />
          </Field>
          <Field label="To" htmlFor="to" className="w-40">
            <Input
              id="to"
              type="date"
              value={range.to}
              onChange={(event) => {
                setPreset('custom')
                setRange({ ...range, to: event.target.value })
              }}
            />
          </Field>
        </CardBody>
      </Card>

      {loading ? (
        <div className="space-y-5">
          <SkeletonStats count={4} />
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      ) : error ? (
        <ErrorState title="Could not load reports" error={error} onRetry={refetch} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Total bookings"
              value={formatNumber(data.summary.total_bookings)}
            />
            <StatCard
              label="Completed trips"
              value={formatNumber(data.summary.completed_trips)}
              hint={`${data.summary.completion_rate}% completion`}
              tone="success"
            />
            <StatCard
              label="Cancelled"
              value={formatNumber(data.summary.cancelled_trips)}
              tone={data.summary.cancelled_trips > 0 ? 'danger' : 'default'}
            />
            <StatCard
              label="Revenue"
              value={formatCurrency(data.summary.revenue)}
              hint={`Avg fare ${formatCurrency(data.summary.average_fare)}`}
            />
          </div>

          <Card>
            <CardHeader title="Daily activity" description="Bookings created and revenue earned" />
            <CardBody>
              {data.daily?.length ? (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eeeff1" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: '#8d949f' }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={24}
                        tickFormatter={(value) =>
                          new Date(value).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })
                        }
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#8d949f' }}
                        axisLine={false}
                        tickLine={false}
                        width={56}
                        tickFormatter={(value) =>
                          value >= 1000 ? `₹${value / 1000}k` : `₹${value}`
                        }
                      />
                      <Tooltip
                        cursor={{ fill: '#f7f8f8' }}
                        contentStyle={{
                          borderRadius: 10,
                          border: '1px solid #dcdee2',
                          fontSize: 13,
                        }}
                        formatter={(value, name) =>
                          name === 'revenue'
                            ? [formatCurrency(value), 'Revenue']
                            : [value, 'Bookings']
                        }
                        labelFormatter={(value) => formatDate(value)}
                      />
                      <Bar dataKey="revenue" fill="#227c6f" radius={[3, 3, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState compact icon={<IconChart />} title="No activity in this period" />
              )}
            </CardBody>
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="space-y-2.5">
              <h2 className="text-sm font-semibold text-ink-700">Driver performance</h2>
              <DataTable
                columns={driverColumns}
                rows={data.drivers}
                empty={
                  <EmptyState
                    compact
                    title="No completed trips"
                    description="Driver performance appears once trips are completed."
                  />
                }
              />
            </div>

            <div className="space-y-2.5">
              <h2 className="text-sm font-semibold text-ink-700">Route performance</h2>
              <DataTable
                columns={routeColumns}
                rows={data.routes}
                empty={
                  <EmptyState
                    compact
                    title="No bookings"
                    description="Route performance appears once bookings are made."
                  />
                }
              />
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Vehicle class mix" />
              <CardBody>
                {data.vehicles?.length ? (
                  <ul className="divide-y divide-ink-100">
                    {data.vehicles.map((row) => (
                      <li
                        key={row.vehicle_type}
                        className="flex items-center justify-between gap-4 py-2.5"
                      >
                        <div>
                          <p className="text-sm font-medium text-ink-900">
                            {titleCase(row.vehicle_type)}
                          </p>
                          <p className="text-xs text-ink-500">{row.bookings} bookings</p>
                        </div>
                        <p className="text-sm font-semibold tabular text-ink-900">
                          {formatCurrency(row.revenue)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact title="No data" />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Payment status" />
              <CardBody>
                {data.payments?.length ? (
                  <ul className="divide-y divide-ink-100">
                    {data.payments.map((row) => (
                      <li
                        key={row.status}
                        className="flex items-center justify-between gap-4 py-2.5"
                      >
                        <div className="flex items-center gap-2.5">
                          <StatusBadge kind="payment" status={row.status} />
                          <span className="text-xs text-ink-500">{row.count} bookings</span>
                        </div>
                        <p className="text-sm font-semibold tabular text-ink-900">
                          {formatCurrency(row.amount)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact title="No data" />
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
