import { cn } from '@/lib/cn'

/** Horizontal, scrollable tab bar with optional counts. */
export default function Tabs({ tabs, value, onChange, className, variant = 'underline' }) {
  if (variant === 'pill') {
    return (
      <div
        className={cn(
          'scrollbar-slim flex gap-1 overflow-x-auto rounded-lg bg-ink-100 p-1',
          className,
        )}
        role="tablist"
      >
        {tabs.map((tab) => {
          const active = tab.key === value
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.key)}
              className={cn(
                'flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                active ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900',
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn('ml-1.5 tabular', active ? 'text-ink-500' : 'text-ink-400')}>
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className={cn('border-b border-ink-200', className)}>
      <div className="scrollbar-slim -mb-px flex gap-5 overflow-x-auto" role="tablist">
        {tabs.map((tab) => {
          const active = tab.key === value
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.key)}
              className={cn(
                'whitespace-nowrap border-b-2 pb-2.5 pt-1 text-sm font-medium transition-colors',
                active
                  ? 'border-brand-600 text-brand-800'
                  : 'border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-800',
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'ml-1.5 rounded-full px-1.5 py-0.5 text-xs tabular',
                    active ? 'bg-brand-50 text-brand-800' : 'bg-ink-100 text-ink-500',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
