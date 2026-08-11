import { currency } from '@/config/brand'

const rupeeFormatter = new Intl.NumberFormat(currency.locale, {
  style: 'currency',
  currency: currency.code,
  maximumFractionDigits: 0,
})

const rupeeFormatterPaise = new Intl.NumberFormat(currency.locale, {
  style: 'currency',
  currency: currency.code,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** ₹3,000 — Indian digit grouping, no decimals unless asked for. */
export function formatCurrency(value, { paise = false } = {}) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return paise ? rupeeFormatterPaise.format(amount) : rupeeFormatter.format(amount)
}

export function formatNumber(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat(currency.locale).format(amount)
}

function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value) {
  const date = toDate(value)
  if (!date) return '—'
  return date.toLocaleDateString(currency.locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatTime(value) {
  const date = toDate(value)
  if (!date) return '—'
  return date.toLocaleTimeString(currency.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatDateTime(value) {
  const date = toDate(value)
  if (!date) return '—'
  return `${formatDate(date)}, ${formatTime(date)}`
}

export function formatShortDateTime(value) {
  const date = toDate(value)
  if (!date) return '—'
  return `${date.toLocaleDateString(currency.locale, {
    day: '2-digit',
    month: 'short',
  })}, ${formatTime(date)}`
}

/** "in 3 hours" / "2 days ago" — for timelines and activity feeds. */
export function formatRelative(value) {
  const date = toDate(value)
  if (!date) return '—'
  const diffSeconds = (date.getTime() - Date.now()) / 1000
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat(currency.locale, { numeric: 'auto' })
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.round(diffSeconds / seconds), unit)
    }
  }
  return 'just now'
}

/** Input[type=datetime-local] wants local wall-clock, not a UTC ISO string. */
export function toLocalInputValue(value) {
  const date = toDate(value)
  if (!date) return ''
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function toDateInputValue(value) {
  const date = toDate(value)
  if (!date) return ''
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

/** Combines a date input and a time input into an absolute ISO timestamp. */
export function combineDateTime(dateValue, timeValue) {
  if (!dateValue) return null
  const [hours = '00', minutes = '00'] = (timeValue || '00:00').split(':')
  const [year, month, day] = dateValue.split('-').map(Number)
  const date = new Date(year, month - 1, day, Number(hours), Number(minutes), 0, 0)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(-10)
  if (digits.length !== 10) return value || '—'
  return `${digits.slice(0, 5)} ${digits.slice(5)}`
}

export function formatDuration(minutes) {
  const total = Number(minutes)
  if (!Number.isFinite(total) || total <= 0) return '—'
  const hours = Math.floor(total / 60)
  const rest = Math.round(total % 60)
  if (!hours) return `${rest} min`
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

export function formatDistance(km) {
  const value = Number(km)
  if (!Number.isFinite(value)) return '—'
  return `${formatNumber(Math.round(value))} km`
}

export function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

export function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
