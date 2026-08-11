import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { bookingService } from '@/services'
import { BOOKING_BUCKETS } from '@/lib/constants'
import Button from '@/components/ui/Button'
import Tabs from '@/components/ui/Tabs'
import Pagination from '@/components/ui/Pagination'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconTicket } from '@/components/ui/Icons'
import BookingCard from '@/components/booking/BookingCard'

const EMPTY_COPY = {
  upcoming: {
    title: 'No upcoming trips',
    description: 'Book a cab and it will show up here while it is being confirmed.',
  },
  active: {
    title: 'No trips in progress',
    description: 'Once a driver is assigned and on the way, the trip appears here.',
  },
  completed: {
    title: 'No completed trips yet',
    description: 'Your travel history will build up here after your first trip.',
  },
  cancelled: {
    title: 'No cancelled bookings',
    description: 'Anything you cancel will be listed here for your records.',
  },
}

export default function MyBookings() {
  const [bucket, setBucket] = useState('upcoming')
  const [page, setPage] = useState(1)

  const { data: summary } = useApi(() => bookingService.summary(), [])
  const { data, loading, error, refetch } = useApi(
    () => bookingService.list({ bucket, page, page_size: 10 }),
    [bucket, page],
  )

  const tabs = BOOKING_BUCKETS.map((item) => ({
    ...item,
    count: summary?.[item.key],
  }))

  const copy = EMPTY_COPY[bucket]

  return (
    <div className="space-y-5">
      <PageHeader
        title="My trips"
        description="Everything you have booked with us."
        action={
          <Link to="/app">
            <Button size="sm">Book a trip</Button>
          </Link>
        }
      />

      <Tabs
        tabs={tabs}
        value={bucket}
        onChange={(value) => {
          setBucket(value)
          setPage(1)
        }}
      />

      {loading ? (
        <SkeletonList count={3} />
      ) : error ? (
        <ErrorState title="Could not load your trips" error={error} onRetry={refetch} />
      ) : !data?.items?.length ? (
        <EmptyState
          icon={<IconTicket />}
          title={copy.title}
          description={copy.description}
          action={
            bucket === 'upcoming' ? (
              <Link to="/app">
                <Button>Book your first trip</Button>
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                to={`/app/bookings/${booking.id}`}
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
