import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useApi } from '@/hooks/useApi'
import { driverService, fleetService } from '@/services'
import { formatCurrency, formatShortDateTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Alert, EmptyState, ErrorState } from '@/components/ui/States'
import { SkeletonStats, SkeletonList, Spinner } from '@/components/ui/Loaders'
import { IconCar, IconInbox } from '@/components/ui/Icons'
import BookingCard from '@/components/booking/BookingCard'
import TripActions from '@/components/driver/TripActions'
import { useToast } from '@/components/ui/Toast'
import Tabs from '@/components/ui/Tabs'
import OpenTripList from '@/components/driver/OpenTripList'

export default function DriverDashboard() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, error, refetch } = useApi(() => driverService.myDashboard(), [])
  const [tab, setTab] = useState('current')
  const { data: open, refetch: refetchOpen } = useApi(() => fleetService.openBookings(), [])
  const { data: wallet, refetch: refetchWallet } = useApi(() => fleetService.wallet(), [])

  const driver = data?.driver
  const isVerified = driver?.verification_status === 'verified'
  const openCount = open?.items?.length || 0

  if (loading) {
    return (
      <div className="space-y-5">
        <SkeletonStats count={2} />
        <SkeletonList count={2} />
      </div>
    )
  }
  if (error) return <ErrorState title="Could not load your dashboard" error={error} onRetry={refetch} />

  const earnings = data.earnings

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">
            {user?.name?.split(' ')[0]}
          </h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {driver?.vehicle
              ? `${driver.vehicle.model} · ${driver.vehicle.registration_number}`
              : 'No vehicle assigned yet'}
          </p>
        </div>
        <StatusBadge kind="verification" status={driver?.verification_status} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Today's earnings"
          value={formatCurrency(earnings.today.earnings)}
          hint={`${earnings.today.trips} ${earnings.today.trips === 1 ? 'trip' : 'trips'}`}
          tone="success"
        />
        <StatCard
          label="Today's trips"
          value={data.todays_trips.length}
          hint={`${earnings.lifetime.trips} completed in total`}
        />
      </div>

      {!isVerified && (
        <Alert tone="warning" title="Your documents are still being checked">
          You can accept trips once the operations team verifies them.
        </Alert>
      )}

      <Tabs
        variant="pill"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'current', label: 'My trips' },
          { key: 'open', label: 'Open trips', count: openCount },
        ]}
      />

      {tab === 'open' ? (
        <OpenTripList
          items={open?.items}
          wallet={wallet}
          onChanged={() => {
            refetchOpen()
            refetchWallet()
            refetch()
          }}
        />
      ) : (
        <>
          {/* The trip in progress is the thing a driver opens the app for, so
              it sits at the top where the online/offline switch used to be. */}
          {data.current_trip ? (
            <Card className="relative overflow-hidden border-brand-200">
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-brand-500" />
              <CardHeader
                title="Current trip"
                action={<StatusBadge status={data.current_trip.status} />}
              />
              <CardBody className="space-y-4 pl-4">
                <div>
                  <p className="font-mono text-xs text-ink-500">
                    {data.current_trip.booking_id}
                  </p>
                  <p className="mt-1 text-base font-bold text-ink-900">
                    {data.current_trip.route?.name}
                  </p>
                  <p className="mt-1 text-sm text-ink-600">
                    {formatShortDateTime(data.current_trip.scheduled_at)}
                  </p>
                </div>
                <TripActions booking={data.current_trip} onUpdated={refetch} />
                <Link to={`/driver/trips/${data.current_trip.id}`}>
                  <Button variant="secondary" fullWidth>
                    Open trip details
                  </Button>
                </Link>
              </CardBody>
            </Card>
          ) : (
            <EmptyState
              compact
              icon={<IconCar />}
              title="No trip in progress"
              description={
                openCount > 0
                  ? `${openCount} trip${openCount === 1 ? '' : 's'} waiting in Open trips.`
                  : 'New trips will appear here once you accept one.'
              }
              action={
                openCount > 0 ? (
                  <Button variant="brand" onClick={() => setTab('open')}>
                    See open trips
                  </Button>
                ) : null
              }
            />
          )}

      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">Today's schedule</h2>
          <Link to="/driver/trips" className="text-sm font-medium text-brand-700 hover:underline">
            All trips
          </Link>
        </div>
        {data.todays_trips.length === 0 ? (
          <EmptyState compact title="Nothing scheduled today" description="Enjoy the break." />
        ) : (
          <div className="space-y-3">
            {data.todays_trips.map((trip) => (
              <BookingCard
                key={trip.id}
                booking={trip}
                to={`/driver/trips/${trip.id}`}
                showFare
              />
            ))}
          </div>
        )}
      </section>

      {data.upcoming_trips.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-sm font-semibold text-ink-900">Coming up</h2>
              <div className="space-y-3">
                {data.upcoming_trips.slice(0, 3).map((trip) => (
                  <BookingCard key={trip.id} booking={trip} to={`/driver/trips/${trip.id}`} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
