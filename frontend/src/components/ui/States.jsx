import { cn } from '@/lib/cn'
import Button from './Button'

/**
 * Empty, error and inline-message states.
 *
 * Every list in the app routes through these so a customer never sees a blank
 * panel or a raw exception.
 */

export function EmptyState({ icon, title, description, action, className, compact = false }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-ink-200 bg-white text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-ink-100 text-ink-400">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  onRetry,
  className,
  compact = false,
}) {
  const message =
    error?.message || 'We could not load this right now. Please try again in a moment.'
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-danger-100 bg-danger-50 text-center',
        compact ? 'px-4 py-6' : 'px-6 py-12',
        className,
      )}
      role="alert"
    >
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-danger-100 text-danger-600">
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM10 5a1 1 0 0 1 1 1v4.5a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1Zm0 9.75a1.15 1.15 0 1 1 0-2.3 1.15 1.15 0 0 1 0 2.3Z" />
        </svg>
      </div>
      <h3 className="text-[15px] font-semibold text-danger-700">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-danger-700/80">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/** Inline banner for form-level errors and contextual notices. */
export function Alert({ tone = 'info', title, children, className, onDismiss }) {
  const tones = {
    info: 'bg-info-50 border-info-100 text-info-700',
    success: 'bg-success-50 border-success-100 text-success-700',
    warning: 'bg-warning-50 border-warning-100 text-warning-700',
    danger: 'bg-danger-50 border-danger-100 text-danger-700',
    neutral: 'bg-ink-50 border-ink-200 text-ink-700',
  }
  return (
    <div
      className={cn('rounded-lg border px-3.5 py-3 text-sm', tones[tone], className)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="-m-1 shrink-0 rounded p-1 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="m4 4 8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

/** Page heading used by every screen for a consistent rhythm. */
export function PageHeader({ title, description, action, className, children }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
