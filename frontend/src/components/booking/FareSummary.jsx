import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'

/**
 * Itemised fare display.
 *
 * Every number shown here comes from the backend's `fare_breakdown`; nothing
 * is recomputed in the browser, so what a customer sees is exactly what the
 * server will charge.
 */
export default function FareSummary({ breakdown, total, className, compact = false }) {
  if (!breakdown) return null

  const rows = [
    { label: 'Base fare', value: breakdown.base_fare },
    { label: 'Distance charge', value: breakdown.distance_charge },
    { label: 'Driver allowance', value: breakdown.driver_allowance },
    { label: 'Toll & parking', value: breakdown.toll },
    { label: 'Night surcharge', value: breakdown.night_surcharge },
    { label: 'Airport surcharge', value: breakdown.airport_surcharge },
    { label: 'Additional charges', value: breakdown.additional_charges },
  ].filter((row) => Number(row.value) > 0)

  const discount = Number(breakdown.discount) || 0
  const tax = Number(breakdown.tax) || 0
  const grandTotal = total ?? breakdown.total

  return (
    <div className={cn('text-sm', className)}>
      <dl className={cn('space-y-2', compact && 'space-y-1.5')}>
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <dt className="text-ink-600">{row.label}</dt>
            <dd className="tabular text-ink-800">{formatCurrency(row.value)}</dd>
          </div>
        ))}

        {breakdown.trip_type_multiplier > 1 && (
          <p className="text-xs text-ink-400">
            Includes a {breakdown.trip_type_multiplier}× round-trip factor.
          </p>
        )}

        {discount > 0 && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-success-700">Discount</dt>
            <dd className="tabular text-success-700">−{formatCurrency(discount)}</dd>
          </div>
        )}

        {tax > 0 && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-600">Tax</dt>
            <dd className="tabular text-ink-800">{formatCurrency(tax)}</dd>
          </div>
        )}
      </dl>

      <div className="mt-3 flex items-center justify-between gap-4 border-t border-ink-200 pt-3">
        <p className="font-semibold text-ink-900">Total payable</p>
        <p className="text-lg font-semibold tabular text-ink-900">{formatCurrency(grandTotal)}</p>
      </div>
    </div>
  )
}
