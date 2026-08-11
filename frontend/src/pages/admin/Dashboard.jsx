import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useApi } from '@/hooks/useApi'
import { adminService } from '@/services'
import { formatCurrency, formatDate, formatNumber, formatShortDateTime } from '@/lib/format'
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonStats, SkeletonTable } from '@/components/ui/Loaders'
import { IconArrowRight, IconTicket } from '@/components/ui/Icons'
import { BOOKING_STATUS_META } from '@/lib/constants'
import { cn } from '@/lib/cn'

export default function AdminDashboard() {
  const { data, loading, error, refetch } = useApi(() => adminService.dashboard(), [])

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonStats count={4} />
        <SkeletonStats count={4} />
        <SkeletonTable rows={5} columns={5} />
      </div>
    )
  }
  if (error) return <ErrorState title="Could not load the dashboard" error={error} onRetry={refetch} />

  const { cards, recent_bookings: recent, upcoming_trips: upcoming } = data
  const distribution = data.status_distribution || []
  const distributionTotal = distribution.reduce((sum, item) => sum + item.count, 0) || 1

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Operations overview · updated ${formatShortDateTime(data.generated_at)}`}
      />

      <section>
        <h2 className="mb-2.5 text-sm font-semibold text-ink-700">Today</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Bookings today" value={formatNumber(cards.todays_bookings)} />
          <StatCard
            label="Revenue today"
            value={formatCurrency(cards.todays_revenue)}
            hint="Completed trips only"
            tone="success"
          />
          <StatCard
            label="Available drivers"
            value={`${cards.available_drivers}/${cards.active_drivers}`}
            hint={`${cards.on_trip_drivers} on trip`}
          />
          <StatCard
            label="Pending confirmation"
            value={formatNumber(cards.pending_bookings)}
            tone={cards.pending_bookings > 0 ? 'warning' : 'default'}
            hint={cards.pending_bookings > 0 ? 'Needs action' : 'All clear'}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2.5 text-sm font-semibold text-ink-700">All time</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Confirmed" value={formatNumber(cards.confirmed_bookings)} tone="brand" />
          <StatCard label="In progress" value={formatNumber(cards.active_bookings)} />
          <StatCard
            label="Completed"
            value={formatNumber(cards.completed_bookings)}
            tone="success"
          />
          <StatCard
            label="Cancelled"
            value={formatNumber(cards.cancelled_bookings)}
            tone={cards.cancelled_bookings > 0 ? 'danger' : 'default'}
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Revenue and bookings"
            description="Last 14 days"
            action={
              <Link
                to="/admin/reports"
                className="flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
              >
                Reports
                <IconArrowRight className="h-4 w-4" />
              </Link>
            }
          />
          <CardBody>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.revenue_trend}
                  margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#227c6f" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#227c6f" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eeeff1" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#8d949f' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) =>
                      new Date(value).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })
                    }
                    minTickGap={20}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#8d949f' }}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    tickFormatter={(value) => (value >= 1000 ? `₹${value / 1000}k` : `₹${value}`)}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid #dcdee2',
                      fontSize: 13,
                      boxShadow: '0 4px 12px -2px rgb(16 24 40 / 0.08)',
                    }}
                    formatter={(value, name) =>
                      name === 'revenue'
                        ? [formatCurrency(value), 'Revenue']
                        : [value, 'Bookings']
                    }
                    labelFormatter={(value) => formatDate(value)}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#227c6f"
                    strokeWidth={2}
                    fill="url(#revenueFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Booking status" description="Distribution across all bookings" />
          <CardBody>
            {distribution.length === 0 ? (
              <EmptyState compact title="No bookings yet" />
            ) : (
              <ul className="space-y-3">
                {distribution.map((item) => {
                  const percent = Math.round((item.count / distributionTotal) * 100)
                  const tone = BOOKING_STATUS_META[item.status]?.tone || 'neutral'
                  const barColor = {
                    success: 'bg-success-600',
                    warning: 'bg-warning-600',
                    danger: 'bg-danger-600',
                    info: 'bg-info-600',
                    brand: 'bg-brand-600',
                    neutral: 'bg-ink-400',
                  }[tone]
                  return (
                    <li key={item.status}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-ink-700">{item.label}</span>
                        <span className="tabular font-medium text-ink-900">
                          {item.count}
                          <span className="ml-1.5 text-xs font-normal text-ink-400">
                            {percent}%
                          </span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <div
                          className={cn('h-full rounded-full', barColor)}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <BookingList
          title="Recent bookings"
          description="Newest requests first"
          bookings={recent}
          emptyText="No bookings have been created yet."
        />
        <BookingList
          title="Upcoming trips"
          description="Scheduled and not yet completed"
          bookings={upcoming}
          emptyText="Nothing scheduled ahead."
          showSchedule
        />
      </div>
    </div>
  )
}

function BookingList({ title, description, bookings, emptyText, showSchedule = false }) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={
          <Link
            to="/admin/bookings"
            className="flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
          >
            View all
            <IconArrowRight className="h-4 w-4" />
          </Link>
        }
      />
      <CardBody className="p-0">
        {!bookings?.length ? (
          <EmptyState compact icon={<IconTicket />} title="Nothing here" description={emptyText} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {bookings.map((booking) => (
              <li key={booking.id}>
                <Link
                  to={`/admin/bookings/${booking.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-ink-50 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {booking.route?.name || booking.pickup?.address}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-ink-500">
                      {booking.booking_id} ·{' '}
                      {showSchedule
                        ? formatShortDateTime(booking.scheduled_at)
                        : booking.customer?.name}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden text-sm font-medium tabular text-ink-900 sm:block">
                      {formatCurrency(booking.total_fare)}
                    </span>
                    <StatusBadge status={booking.status} dot={false} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
