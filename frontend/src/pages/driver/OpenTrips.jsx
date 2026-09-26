import { useApi } from '@/hooks/useApi'
import { fleetService } from '@/services'
import { ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import OpenTripList from '@/components/driver/OpenTripList'

/** Full-page view of the same list the home screen shows in a tab. */
export default function OpenTrips() {
  const { data, loading, error, refetch } = useApi(() => fleetService.openBookings(), [])
  const { data: wallet, refetch: refetchWallet } = useApi(() => fleetService.wallet(), [])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Open trips"
        description="Paid trips waiting for a fleet. First to accept gets it."
      />

      {loading ? (
        <SkeletonList count={3} lines={3} />
      ) : error ? (
        <ErrorState title="Could not load open trips" error={error} onRetry={refetch} />
      ) : (
        <OpenTripList
          items={data?.items}
          wallet={wallet}
          onChanged={() => {
            refetch()
            refetchWallet()
          }}
        />
      )}
    </div>
  )
}
