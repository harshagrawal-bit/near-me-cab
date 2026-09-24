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
    {
      label: 'Distance charge',
      value: breakdown.distance_charge,
      // The working, shown the way the reference apps do it: people trust a
      // number they can check far more than one that simply appears.
      detail:
        breakdown.distance_km && breakdown.per_km_rate
          ? `${breakdown.distance_km} km × ${formatCurrency(breakdown.per_km_rate)}/km`
          : null,
    },
    { label: 'Driver allowance', value: breakdown.driver_allowance },
    { label: 'Toll & parking', value: breakdown.toll },
    { label: 'Night surcharge', value: breakdown.night_surcharge },
    { label: 'Airport surcharge', value: breakdown.airport_surcharge },
    { label: 'Additional charges', value: breakdown.additional_charges },
  ].filter((row) => Number(row.value) > 0)

  const discount = Number(breakdown.discount) || 0
  const tax = Number(breakdown.tax) || 0
  const grandTotal = total ?? breakdown.total

  /** What the fare does NOT cover. Stated up front, never discovered at the drop. */
  const exclusions = [
    Number(breakdown.toll) > 0
      ? { label: 'Toll included', included: true }
      : { label: 'Toll extra', included: false },
    { label: 'Parking extra', included: false },
    Number(breakdown.driver_allowance) > 0
      ? { label: 'Driver bata included', included: true }
      : null,
  ].filter(Boolean)

  return (
    <div className={cn('text-sm', className)}>
      <dl className={cn('space-y-2.5', compact && 'space-y-2')}>
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="font-medium text-ink-800">{row.label}</dt>
              <dd className="tabular font-semibold text-ink-900">{formatCurrency(row.value)}</dd>
            </div>
            {row.detail && (
              <p className="mt-0.5 text-xs text-ink-400">↳ {row.detail}</p>
            )}
          </div>
        ))}

        {breakdown.trip_type_multiplier > 1 && (
          <p className="text-xs text-ink-400">
            Includes a {breakdown.trip_type_multiplier}× round-trip factor.
          </p>
        )}

        {discount > 0 && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-medium text-success-700">Discount</dt>
            <dd className="tabular font-semibold text-success-700">
              −{formatCurrency(discount)}
            </dd>
          </div>
        )}

        {tax > 0 && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-medium text-ink-800">Tax</dt>
            <dd className="tabular font-semibold text-ink-900">{formatCurrency(tax)}</dd>
          </div>
        )}
      </dl>

      <div className="mt-3.5 flex items-end justify-between gap-4 border-t-2 border-ink-900 pt-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Total payable
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-ink-400">Inclusive of applicable taxes</p>
        </div>
        <p className="text-2xl font-bold tabular tracking-tight text-ink-900">
          {formatCurrency(grandTotal)}
        </p>
      </div>

      {!compact && exclusions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {exclusions.map((item) => (
            <span
              key={item.label}
              className={cn(
                'rounded-md px-2 py-1 text-[0.6875rem] font-semibold',
                item.included
                  ? 'bg-success-50 text-success-700 ring-1 ring-success-100'
                  : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
              )}
            >
              {item.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
