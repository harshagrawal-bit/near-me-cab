import { cn } from '@/lib/cn'

export function Card({ className, children, as: Tag = 'div', ...props }) {
  return (
    <Tag
      className={cn(
        'rounded-card border border-ink-200 bg-white shadow-card',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}

export function CardHeader({ title, description, action, className, children }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-4 py-3.5 sm:px-5',
        className,
      )}
    >
      <div className="min-w-0">
        {title && <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>}
        {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ className, children }) {
  return <div className={cn('px-4 py-4 sm:px-5', className)}>{children}</div>
}

export function CardFooter({ className, children }) {
  return (
    <div className={cn('border-t border-ink-100 bg-ink-50/60 px-4 py-3 sm:px-5', className)}>
      {children}
    </div>
  )
}

/** Compact metric tile for dashboards. */
export function StatCard({ label, value, hint, tone = 'default', icon, className }) {
  const tones = {
    default: 'text-ink-900',
    success: 'text-success-700',
    warning: 'text-warning-700',
    danger: 'text-danger-700',
    brand: 'text-brand-700',
  }
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        {icon && <span className="shrink-0 text-ink-300">{icon}</span>}
      </div>
      <p className={cn('mt-2 text-2xl font-semibold tabular tracking-tight', tones[tone])}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </Card>
  )
}

/** Label/value row used throughout detail pages. */
export function DetailRow({ label, value, className, valueClassName }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2.5', className)}>
      <dt className="shrink-0 text-sm text-ink-500">{label}</dt>
      <dd className={cn('min-w-0 text-right text-sm font-medium text-ink-900', valueClassName)}>
        {value ?? '—'}
      </dd>
    </div>
  )
}

export function DetailList({ className, children }) {
  return <dl className={cn('divide-y divide-ink-100', className)}>{children}</dl>
}

export default Card
