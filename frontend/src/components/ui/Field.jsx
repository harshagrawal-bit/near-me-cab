import { forwardRef, useId } from 'react'
import { cn } from '@/lib/cn'

/**
 * Label + control + help/error text.
 *
 * Always renders a real <label htmlFor>, and wires aria-describedby /
 * aria-invalid so screen readers announce validation failures.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required = false,
  className,
  children,
  optionalLabel = false,
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="flex items-center gap-1 text-sm font-medium text-ink-700"
        >
          {label}
          {required && (
            <span className="text-danger-600" aria-hidden="true">
              *
            </span>
          )}
          {optionalLabel && !required && (
            <span className="font-normal text-ink-400">(optional)</span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p className="flex items-start gap-1 text-sm text-danger-700" role="alert">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 3.25a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V5a.75.75 0 0 1 .75-.75ZM8 11.75a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z" />
          </svg>
          {error}
        </p>
      ) : (
        hint && <p className="text-sm text-ink-500">{hint}</p>
      )}
    </div>
  )
}

export const Input = forwardRef(function Input(
  { className, invalid, id, describedBy, ...props },
  ref,
) {
  const generatedId = useId()
  return (
    <input
      ref={ref}
      id={id || generatedId}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn('field-control', invalid && 'field-control-invalid', className)}
      {...props}
    />
  )
})

export const Textarea = forwardRef(function Textarea({ className, invalid, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn('field-control min-h-[96px] resize-y', invalid && 'field-control-invalid', className)}
      {...props}
    />
  )
})

export const Select = forwardRef(function Select(
  { className, invalid, children, placeholder, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'field-control appearance-none pr-9',
          invalid && 'field-control-invalid',
          className,
        )}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="m4 6 4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
})

export function Checkbox({ label, description, className, id, ...props }) {
  const generatedId = useId()
  const inputId = id || generatedId
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={inputId} className="block text-sm font-medium text-ink-700">
          {label}
        </label>
        {description && <p className="text-sm text-ink-500">{description}</p>}
      </div>
    </div>
  )
}

/** Segmented radio group — used for trip type and short filter sets. */
export function RadioCards({ name, value, onChange, options, columns = 2, className }) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'grid gap-2',
        columns === 2 ? 'grid-cols-2' : columns === 3 ? 'grid-cols-3' : 'grid-cols-4',
        className,
      )}
    >
      {options.map((option) => {
        const selected = value === option.value
        return (
          <label
            key={option.value}
            className={cn(
              'relative flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5 transition-colors',
              selected
                ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                : 'border-ink-200 bg-white hover:border-ink-300',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span
              className={cn(
                'text-sm font-medium',
                selected ? 'text-brand-800' : 'text-ink-800',
              )}
            >
              {option.label}
            </span>
            {option.hint && (
              <span className={cn('text-xs', selected ? 'text-brand-700' : 'text-ink-500')}>
                {option.hint}
              </span>
            )}
          </label>
        )
      })}
    </div>
  )
}
