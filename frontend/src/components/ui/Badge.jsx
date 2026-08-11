import { cn } from '@/lib/cn'
import {
  ACCOUNT_STATUS_META,
  BOOKING_STATUS_META,
  DOCUMENT_STATUS_META,
  PAYMENT_STATUS_META,
  VEHICLE_STATUS_META,
  VERIFICATION_STATUS_META,
} from '@/lib/constants'
import { titleCase } from '@/lib/format'

const TONES = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  info: 'bg-info-50 text-info-700 ring-info-100',
  success: 'bg-success-50 text-success-700 ring-success-100',
  warning: 'bg-warning-50 text-warning-700 ring-warning-100',
  danger: 'bg-danger-50 text-danger-700 ring-danger-100',
  brand: 'bg-brand-50 text-brand-800 ring-brand-100',
}

export function Badge({ tone = 'neutral', children, className, dot = false }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5',
        'text-xs font-medium ring-1 ring-inset',
        TONES[tone] || TONES.neutral,
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}

/** Resolves a raw status value against the right metadata map. */
function metaFor(kind, value) {
  const maps = {
    booking: BOOKING_STATUS_META,
    payment: PAYMENT_STATUS_META,
    vehicle: VEHICLE_STATUS_META,
    document: DOCUMENT_STATUS_META,
    verification: VERIFICATION_STATUS_META,
    account: ACCOUNT_STATUS_META,
  }
  return (maps[kind] || {})[value] || { label: titleCase(value), tone: 'neutral' }
}

export function StatusBadge({ kind = 'booking', status, className, dot = true }) {
  if (!status) return null
  const { label, tone } = metaFor(kind, status)
  return (
    <Badge tone={tone} className={className} dot={dot}>
      {label}
    </Badge>
  )
}

export default Badge
