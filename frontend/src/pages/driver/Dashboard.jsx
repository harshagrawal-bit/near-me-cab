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
import OpenTripList from '@/components/driver/OpenTripList'

export default function DriverDashboard() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, error, refetch } = useApi(() => driverService.myDashboard(), [])
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

  return (
    <div className="space-y-5">
      {!isVerified && (
        <Alert tone="warning" title="Your documents are still being checked">
          You can accept trips once the operations team verifies them.
        </Alert>
      )}

      {/* The live trip first — it is what a driver opens the app for. */}
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
                  ? 'Pick one from the open trips below.'
                  : 'New trips will appear here once you accept one.'
              }
            />
          )}

      {/* Open work, directly under the live trip — the two things a driver
          needs on one screen, in the order they matter. */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">
            Open trips
            {openCount > 0 && <span className="ml-1.5 text-ink-400">{openCount}</span>}
          </h2>
        </div>
        <OpenTripList
          items={open?.items}
          wallet={wallet}
          onChanged={() => {
            refetchOpen()
            refetchWallet()
            refetch()
          }}
        />
      </section>

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
