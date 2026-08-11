import { cn } from '@/lib/cn'
import { CUSTOMER_TIMELINE } from '@/lib/constants'
import { formatShortDateTime } from '@/lib/format'

/**
 * Customer-facing trip timeline.
 *
 * Renders the six milestones from the brief. Sub-states recorded by the
 * backend (accepted, picked_up) surface as detail lines under their milestone
 * rather than adding steps, so the shape stays readable on a phone.
 */
export default function StatusTimeline({ status, history = [], cancelled = false }) {
  const reached = new Set(history.map((entry) => entry.to_status))
  const entryFor = (statuses) =>
    history.find((entry) => statuses.includes(entry.to_status)) || null

  const currentIndex = CUSTOMER_TIMELINE.findIndex((step) => step.statuses.includes(status))

  if (cancelled) {
    const cancelEntry = history.find((entry) => entry.to_status === 'cancelled')
    return (
      <ol className="space-y-0">
        {CUSTOMER_TIMELINE.map((step) => {
          const entry = entryFor(step.statuses)
          const done = step.statuses.some((value) => reached.has(value))
          if (!done) return null
          return (
            <Step key={step.key} label={step.label} state="done" entry={entry} history={history} step={step} />
          )
        })}
        <Step
          label="Cancelled"
          state="cancelled"
          entry={cancelEntry}
          isLast
          history={history}
          step={{ statuses: ['cancelled'] }}
        />
      </ol>
    )
  }

  return (
    <ol className="space-y-0">
      {CUSTOMER_TIMELINE.map((step, index) => {
        const done = step.statuses.some((value) => reached.has(value))
        const isCurrent = index === currentIndex
        const state = isCurrent ? 'current' : done ? 'done' : 'pending'
        return (
          <Step
            key={step.key}
            label={step.label}
            state={state}
            entry={entryFor(step.statuses)}
            isLast={index === CUSTOMER_TIMELINE.length - 1}
            history={history}
            step={step}
          />
        )
      })}
    </ol>
  )
}

function Step({ label, state, entry, isLast = false, history, step }) {
  // Show the secondary status (e.g. "Accepted by Driver") as a detail line.
  const secondary =
    step?.statuses?.length > 1
      ? history.filter((item) => step.statuses.includes(item.to_status)).slice(1)
      : []

  const dot = {
    done: 'border-brand-600 bg-brand-600 text-white',
    current: 'border-brand-600 bg-white text-brand-700 ring-4 ring-brand-100',
    pending: 'border-ink-200 bg-white text-ink-300',
    cancelled: 'border-danger-600 bg-danger-600 text-white',
  }[state]

  const line = {
    done: 'bg-brand-600',
    current: 'bg-ink-200',
    pending: 'bg-ink-200',
    cancelled: 'bg-danger-200',
  }[state]

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
            dot,
          )}
          aria-hidden="true"
        >
          {state === 'done' && (
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path
                d="m2.5 6 2.5 2.5L9.5 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {state === 'cancelled' && (
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
          {state === 'current' && <span className="h-2 w-2 rounded-full bg-brand-600" />}
        </span>
        {!isLast && <span className={cn('w-0.5 flex-1', line)} aria-hidden="true" />}
      </div>

      <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-5')}>
        <p
          className={cn(
            'text-sm font-medium',
            state === 'pending'
              ? 'text-ink-400'
              : state === 'cancelled'
                ? 'text-danger-700'
                : 'text-ink-900',
          )}
        >
          {label}
          {state === 'current' && (
            <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-brand-700">
              Now
            </span>
          )}
        </p>
        {entry && (
          <p className="mt-0.5 text-xs text-ink-500">{formatShortDateTime(entry.created_at)}</p>
        )}
        {entry?.note && state !== 'pending' && (
          <p className="mt-1 text-xs text-ink-500">{entry.note}</p>
        )}
        {secondary.map((item) => (
          <p key={item.id} className="mt-1 text-xs text-ink-500">
            {item.label} · {formatShortDateTime(item.created_at)}
          </p>
        ))}
      </div>
    </li>
  )
}
