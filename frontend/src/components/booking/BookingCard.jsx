import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { StatusBadge } from '@/components/ui/Badge'
import { IconArrowRight, IconCar, IconClock, IconPin } from '@/components/ui/Icons'
import { formatCurrency, formatShortDateTime } from '@/lib/format'

/** Compact booking summary used in customer and driver lists. */
export default function BookingCard({ booking, to, showFare = true, className, footer }) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium tracking-tight text-ink-500">
            {booking.booking_id}
          </p>
          <p className="mt-1 truncate text-[15px] font-semibold text-ink-900">
            {booking.route?.name || `${booking.pickup?.address} → ${booking.drop?.address}`}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <dl className="mt-3 space-y-1.5">
        <div className="flex items-start gap-2 text-sm text-ink-600">
          <IconClock className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          <span>{formatShortDateTime(booking.scheduled_at)}</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-ink-600">
          <IconPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          <span className="min-w-0 truncate">{booking.pickup?.address}</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-ink-600">
          <IconCar className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          <span>
            {booking.vehicle_class?.label || booking.vehicle_type}
            {booking.driver?.name && ` · ${booking.driver.name}`}
          </span>
        </div>
      </dl>

      {(showFare || footer) && (
        <div className="mt-3.5 flex items-center justify-between border-t border-ink-100 pt-3">
          {showFare ? (
            <p className="text-base font-semibold tabular text-ink-900">
              {formatCurrency(booking.total_fare)}
            </p>
          ) : (
            <span />
          )}
          {footer || (
            <span className="flex items-center gap-1 text-sm font-medium text-brand-700">
              View details
              <IconArrowRight className="h-4 w-4" />
            </span>
          )}
        </div>
      )}
    </>
  )

  const classes = cn(
    'block rounded-card border border-ink-200 bg-white p-4 shadow-card transition-colors',
    to && 'hover:border-ink-300 active:bg-ink-50',
    className,
  )

  if (!to) return <div className={classes}>{content}</div>
  return (
    <Link to={to} className={classes}>
      {content}
    </Link>
  )
}
