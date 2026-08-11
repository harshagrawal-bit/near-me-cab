import { cn } from '@/lib/cn'

export function Spinner({ className }) {
  return (
    <svg
      className={cn('animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function FullPageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50" role="status">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-7 w-7 text-brand-600" />
        <p className="text-sm text-ink-500">{label}</p>
      </div>
    </div>
  )
}

export function Skeleton({ className }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />
}

/** Card-shaped placeholder used while lists load. */
export function SkeletonCard({ lines = 3, className }) {
  return (
    <div className={cn('rounded-card border border-ink-200 bg-white p-4 shadow-card', className)}>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton key={index} className={cn('h-3', index === lines - 1 ? 'w-1/2' : 'w-full')} />
        ))}
      </div>
    </div>
  )
}

export function SkeletonList({ count = 3, lines = 3, className }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} lines={lines} />
      ))}
    </div>
  )
}

/** Matches the shape of DataTable so the swap to real rows is not jarring. */
export function SkeletonTable({ rows = 5, columns = 5 }) {
  return (
    <div className="overflow-hidden rounded-card border border-ink-200 bg-white shadow-card">
      <div className="border-b border-ink-200 bg-ink-50 px-4 py-3">
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="divide-y divide-ink-100">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }).map((_, columnIndex) => (
              <Skeleton
                key={columnIndex}
                className={cn('h-3', columnIndex === 0 ? 'w-32' : 'w-20 flex-1')}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function SkeletonStats({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="rounded-card border border-ink-200 bg-white p-4 shadow-card"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-16" />
        </div>
      ))}
    </div>
  )
}
