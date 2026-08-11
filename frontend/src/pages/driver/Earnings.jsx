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
import { driverService } from '@/services'
import { formatCurrency, formatDate } from '@/lib/format'
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card'
import { ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonStats, Skeleton } from '@/components/ui/Loaders'

export default function DriverEarnings() {
  const { data, loading, error, refetch } = useApi(() => driverService.myEarnings(), [])

  if (loading) {
    return (
      <div className="space-y-5">
        <SkeletonStats count={4} />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorState title="Could not load earnings" error={error} onRetry={refetch} />

  const chartData = (data.daily || []).map((entry) => ({
    ...entry,
    label: new Date(entry.date).toLocaleDateString('en-IN', { weekday: 'short' }),
  }))

  return (
    <div className="space-y-5">
      <PageHeader
        title="Earnings"
        description="Fares from completed trips only. Cancelled trips do not count."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Today"
          value={formatCurrency(data.today.earnings)}
          hint={`${data.today.trips} trips`}
          tone="success"
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
        />
      </div>

      <Card>
        <CardHeader title="Last 7 days" description="Completed trip earnings per day." />
        <CardBody>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eeeff1" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickFormatter={(value) => `₹${value >= 1000 ? `${value / 1000}k` : value}`}
                />
                <Tooltip
                  cursor={{ fill: '#f7f8f8' }}
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid #dcdee2',
                    fontSize: 13,
                    boxShadow: '0 4px 12px -2px rgb(16 24 40 / 0.08)',
                  }}
                  formatter={(value) => [formatCurrency(value), 'Earnings']}
                  labelFormatter={(_, payload) =>
                    payload?.[0] ? formatDate(payload[0].payload.date) : ''
                  }
                />
                <Bar dataKey="earnings" fill="#227c6f" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Daily breakdown" />
        <CardBody>
          <ul className="divide-y divide-ink-100">
            {[...(data.daily || [])].reverse().map((entry) => (
              <li key={entry.date} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-ink-900">{formatDate(entry.date)}</p>
                  <p className="text-xs text-ink-500">
                    {entry.trips} {entry.trips === 1 ? 'trip' : 'trips'}
                  </p>
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
