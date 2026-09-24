import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'

/**
 * How much the customer pays now.
 *
 * Three choices, and the amounts shown here are previews only — the server
 * recomputes what is owed from the stored fare when the booking is confirmed,
 * so a tampered figure changes nothing but what this box displays.
 */
export default function PaymentOptions({ total, advancePercent, settings, value, onChange }) {
  const config = settings || {}
  const partAmount = Math.round((Number(total) * Number(advancePercent || 0)) / 100)

  const options = [
    {
      id: 'pay_later',
      enabled: config.allow_pay_later !== false,
      label: 'Book now, pay later',
      hint: 'Settle the full fare with the driver',
      amount: 0,
      amountLabel: formatCurrency(0),
    },
    {
      id: 'part',
      enabled: config.allow_part_payment !== false,
      label: 'Part payment',
      hint: `Pay ${Math.round(advancePercent || 0)}% now to hold your car`,
      amount: partAmount,
      amountLabel: formatCurrency(partAmount),
      caption: 'SECURE NOW',
    },
    {
      id: 'full',
      enabled: config.allow_full_payment !== false,
      label: 'Pay in full',
      hint: 'Nothing left to pay at the drop',
      amount: Number(total),
      amountLabel: formatCurrency(total),
    },
  ].filter((option) => option.enabled)

  const recommended = config.recommended || 'part'

  return (
    <div className="space-y-2.5">
      {options.map((option) => {
        const selected = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={selected}
            className={cn(
              'relative flex w-full items-center gap-3 rounded-xl border-2 p-3.5 text-left transition',
              selected
                ? 'border-ink-900 bg-brand-50/60 shadow-sm'
                : 'border-ink-100 bg-white hover:border-ink-300',
            )}
          >
            {option.id === recommended && (
              <span className="absolute -top-2.5 left-3 rounded-full bg-amber-500 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-white">
                Recommended
              </span>
            )}

            <span
              aria-hidden="true"
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
                selected ? 'border-ink-900' : 'border-ink-300',
              )}
            >
              {selected && <span className="h-2.5 w-2.5 rounded-full bg-ink-900" />}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink-900">{option.label}</span>
              <span className="mt-0.5 block text-xs text-ink-500">{option.hint}</span>
            </span>

            <span className="shrink-0 text-right">
              <span className="block text-lg font-bold tabular text-ink-900">
                {option.amountLabel}
              </span>
              {option.caption && (
                <span className="block text-[0.625rem] font-semibold uppercase tracking-wide text-ink-500">
                  {option.caption}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
