import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

const ToastContext = createContext(null)

const TONES = {
  success: {
    ring: 'ring-success-100',
    icon: 'text-success-600',
    path: 'M8 12.5 10.5 15l5.5-6',
  },
  error: {
    ring: 'ring-danger-100',
    icon: 'text-danger-600',
    path: 'M12 7.5v5M12 16.2v.1',
  },
  info: {
    ring: 'ring-info-100',
    icon: 'text-info-600',
    path: 'M12 11v5.5M12 7.6v.1',
  },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (message, { tone = 'info', title, duration = 4500 } = {}) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setToasts((current) => [...current.slice(-3), { id, message, tone, title }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      )
      return id
    },
    [dismiss],
  )

  const value = useMemo(
    () => ({
      toast: push,
      success: (message, options) => push(message, { ...options, tone: 'success' }),
      error: (message, options) => push(message, { ...options, tone: 'error', duration: 6000 }),
      info: (message, options) => push(message, { ...options, tone: 'info' }),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:top-0 sm:items-end"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const tone = TONES[toast.tone] || TONES.info
          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3',
                'rounded-lg bg-white p-3.5 shadow-overlay ring-1',
                tone.ring,
              )}
            >
              <svg
                className={cn('mt-0.5 h-5 w-5 shrink-0', tone.icon)}
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d={tone.path}
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="min-w-0 flex-1">
                {toast.title && (
                  <p className="text-sm font-semibold text-ink-900">{toast.title}</p>
                )}
                <p className={cn('text-sm text-ink-600', toast.title && 'mt-0.5')}>
                  {toast.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-m-1 shrink-0 rounded p-1 text-ink-400 hover:text-ink-700"
                aria-label="Dismiss notification"
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
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside a ToastProvider')
  return context
}
