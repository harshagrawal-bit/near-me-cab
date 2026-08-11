import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useApi } from '@/hooks/useApi'
import { driverService } from '@/services'
import { formatCurrency, formatShortDateTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Alert, EmptyState, ErrorState } from '@/components/ui/States'
import { SkeletonStats, SkeletonList, Spinner } from '@/components/ui/Loaders'
import { IconCar, IconPower } from '@/components/ui/Icons'
import BookingCard from '@/components/booking/BookingCard'
import TripActions from '@/components/driver/TripActions'
import { useToast } from '@/components/ui/Toast'

export default function DriverDashboard() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, error, refetch } = useApi(() => driverService.myDashboard(), [])
  const [togglingAvailability, setTogglingAvailability] = useState(false)

  const driver = data?.driver
  const isVerified = driver?.verification_status === 'verified'

  const toggleAvailability = async () => {
    setTogglingAvailability(true)
    try {
      const updated = await driverService.setAvailability(!driver.is_available)
      toast.success(updated.is_available ? 'You are online.' : 'You are offline.')
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setTogglingAvailability(false)
    }
  }

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

      {/* Availability toggle — the driver's single most-used control. */}
      <Card
        className={cn(
          'p-4 transition-colors',
          driver?.is_available && 'border-success-100 bg-success-50',
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                driver?.is_available
                  ? 'bg-success-600 text-white'
                  : 'bg-ink-200 text-ink-500',
              )}
            >
              {togglingAvailability ? (
                <Spinner className="h-5 w-5" />
              ) : (
                <IconPower className="h-5 w-5" />
              )}
            </span>
            <div>
              <p className="font-semibold text-ink-900">
                {driver?.is_available ? 'You are online' : 'You are offline'}
              </p>
              <p className="text-sm text-ink-600">
                {driver?.is_available
                  ? 'Available for new trip assignments.'
                  : 'You will not be assigned new trips.'}
              </p>
            </div>
          </div>
          <Button
            variant={driver?.is_available ? 'secondary' : 'brand'}
            onClick={toggleAvailability}
            loading={togglingAvailability}
            disabled={!isVerified}
          >
            {driver?.is_available ? 'Go offline' : 'Go online'}
          </Button>
        </div>
        {!isVerified && (
          <Alert tone="warning" className="mt-3">
            You can go online once the operations team verifies your documents.{' '}
            <Link to="/driver/documents" className="font-medium underline">
              View documents
            </Link>
          </Alert>
        )}
      </Card>

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

      {data.current_trip ? (
        <Card>
          <CardHeader
            title="Current trip"
            action={<StatusBadge status={data.current_trip.status} />}
          />
          <CardBody className="space-y-4">
            <div>
              <p className="font-mono text-xs text-ink-500">{data.current_trip.booking_id}</p>
              <p className="mt-1 font-semibold text-ink-900">
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
            driver?.is_available
              ? 'You are online. New assignments will appear here.'
              : 'Go online to start receiving trips.'
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
    </div>
  )
}
