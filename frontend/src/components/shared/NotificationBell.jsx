import { useEffect, useRef, useState } from 'react'
import { notificationService } from '@/services'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/format'
import { IconBell, IconInbox } from '@/components/ui/Icons'
import { Spinner } from '@/components/ui/Loaders'

export default function NotificationBell({ align = 'right' }) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await notificationService.unreadCount()
        if (!cancelled) setCount(result.count || 0)
      } catch {
        // A failed badge poll is not worth interrupting the user for.
      }
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
    }
    const onEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next) return
    setLoading(true)
    try {
      const page = await notificationService.list({ page_size: 12 })
      setItems(page.items || [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const markAllRead = async () => {
    try {
      await notificationService.markAllRead()
      setCount(0)
      setItems((current) => current.map((item) => ({ ...item, is_read: true })))
    } catch {
      // Ignore — the badge refreshes on the next poll.
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
        className="relative rounded-lg p-2 text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <IconBell />
        {count > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-2xs font-semibold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-slide-up overflow-hidden rounded-card border border-ink-200 bg-white shadow-overlay',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-ink-900">Notifications</p>
            {count > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="scrollbar-slim max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="h-5 w-5 text-brand-600" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <IconInbox className="h-6 w-6 text-ink-300" />
                <p className="text-sm text-ink-500">You are all caught up.</p>
              </div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={cn('px-4 py-3', !item.is_read && 'bg-brand-50/40')}
                  >
                    <div className="flex items-start gap-2">
                      {!item.is_read && (
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600"
                          aria-hidden="true"
                        />
                      )}
                      <div className={cn('min-w-0', item.is_read && 'pl-3.5')}>
                        <p className="text-sm font-medium text-ink-900">{item.title}</p>
                        <p className="mt-0.5 text-sm text-ink-600">{item.body}</p>
                        <p className="mt-1 text-xs text-ink-400">
                          {formatRelative(item.created_at)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
