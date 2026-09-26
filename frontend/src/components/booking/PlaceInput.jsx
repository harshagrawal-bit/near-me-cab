import { useEffect, useRef, useState } from 'react'
import { routeService } from '@/services'
import { useDebounced } from '@/hooks/useApi'
import { cn } from '@/lib/cn'
import { IconPin } from '@/components/ui/Icons'

/**
 * Type a place, pick from suggestions.
 *
 * Replaces a single grouped dropdown of every route we operate, which stopped
 * being usable somewhere past a couple of dozen entries and forced a customer
 * to know our catalogue rather than their own trip.
 *
 * Suggestions come from the places we actually serve, so choosing one leads to
 * a priced route. Free text is still allowed — a customer may want somewhere
 * we have not listed, and the right answer there is to tell them so rather
 * than refuse the keystroke.
 */
export default function PlaceInput({
  label,
  value,
  onChange,
  placeholder,
  id,
  tone = 'pickup',
}) {
  const [query, setQuery] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState([])
  const [highlight, setHighlight] = useState(-1)
  const boxRef = useRef(null)
  const debounced = useDebounced(query, 250)

  useEffect(() => {
    setQuery(value || '')
  }, [value])

  useEffect(() => {
    let cancelled = false
    if (!open || debounced.trim().length < 2) {
      setOptions([])
      return undefined
    }
    routeService
      .places(debounced.trim())
      .then((results) => {
        if (!cancelled) setOptions(Array.isArray(results) ? results.slice(0, 6) : [])
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [debounced, open])

  // Close when focus leaves the whole control, not just the input, or picking
  // a suggestion with the mouse would dismiss the list before the click lands.
  useEffect(() => {
    const onDocClick = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const choose = (text) => {
    setQuery(text)
    onChange(text)
    setOpen(false)
    setHighlight(-1)
  }

  const onKeyDown = (event) => {
    if (!open || !options.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((h) => (h + 1) % options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((h) => (h <= 0 ? options.length - 1 : h - 1))
    } else if (event.key === 'Enter' && highlight >= 0) {
      event.preventDefault()
      choose(options[highlight].description)
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-700">
        <span
          aria-hidden="true"
          className={cn(
            'h-2.5 w-2.5 rounded-full',
            tone === 'pickup' ? 'bg-brand-600' : 'border-2 border-ink-400',
          )}
        />
        {label}
      </label>

      <div className="relative">
        <IconPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          id={id}
          type="text"
          autoComplete="off"
          className="h-12 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-[15px] text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-ink-900 focus:ring-2 focus:ring-ink-900/10"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            onChange(event.target.value)
            setOpen(true)
            setHighlight(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-autocomplete="list"
        />
      </div>

      {open && options.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-ink-100 bg-white py-1 shadow-lg"
        >
          {options.map((option, index) => (
            <li key={`${option.description}-${index}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option.description)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition',
                  index === highlight ? 'bg-ink-50 text-ink-900' : 'text-ink-700',
                )}
              >
                <IconPin className="h-4 w-4 shrink-0 text-ink-400" />
                <span className="min-w-0 truncate">{option.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
