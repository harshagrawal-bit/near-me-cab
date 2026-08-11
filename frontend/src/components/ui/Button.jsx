import { forwardRef } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Loaders'

const VARIANTS = {
  primary:
    'bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950 disabled:bg-ink-300 shadow-sm',
  secondary:
    'bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 active:bg-ink-100 disabled:text-ink-400 shadow-sm',
  brand:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 shadow-sm',
  ghost: 'text-ink-700 hover:bg-ink-100 active:bg-ink-200 disabled:text-ink-400',
  danger:
    'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700 disabled:bg-danger-100 disabled:text-danger-600 shadow-sm',
  'danger-outline':
    'bg-white text-danger-700 border border-danger-100 hover:bg-danger-50 disabled:text-ink-400',
  link: 'text-brand-700 hover:text-brand-800 hover:underline underline-offset-4 p-0 h-auto',
}

const SIZES = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-[15px] gap-2',
  lg: 'h-12 px-5 text-base gap-2',
  icon: 'h-10 w-10 justify-center',
}

const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    className,
    children,
    loading = false,
    disabled,
    fullWidth = false,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        variant !== 'link' && SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  )
})

export default Button
