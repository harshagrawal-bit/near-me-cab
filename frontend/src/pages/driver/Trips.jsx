import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { bookingService } from '@/services'
import Tabs from '@/components/ui/Tabs'
import Pagination from '@/components/ui/Pagination'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconCar } from '@/components/ui/Icons'
import BookingCard from '@/components/booking/BookingCard'

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
]

const EMPTY = {
  active: 'No trips in progress right now.',
  upcoming: 'Nothing assigned to you yet.',
  completed: 'Completed trips will be listed here.',
  cancelled: 'No cancelled trips.',
}

export default function DriverTrips() {
  const [bucket, setBucket] = useState('active')
  const [page, setPage] = useState(1)

  const { data, loading, error, refetch } = useApi(
    () => bookingService.list({ bucket, page, page_size: 10 }),
    [bucket, page],
  )

  return (
    <div className="space-y-5">
      <PageHeader title="My trips" description="Everything assigned to you." />

      <Tabs
        variant="pill"
        tabs={TABS}
        value={bucket}
        onChange={(value) => {
          setBucket(value)
          setPage(1)
        }}
      />

      {loading ? (
        <SkeletonList count={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.items?.length ? (
        <EmptyState icon={<IconCar />} title="No trips here" description={EMPTY[bucket]} />
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                to={`/driver/trips/${booking.id}`}
              />
            ))}
          </div>
          <Pagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            pageSize={data.page_size}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
