import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { pricingService } from '@/services'
import { TRIP_TYPES } from '@/lib/constants'
import {
  combineDateTime,
  formatCurrency,
  formatDistance,
  formatDuration,
  formatShortDateTime,
} from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconCar, IconChevronLeft, IconTag, IconUsers } from '@/components/ui/Icons'
import { cn } from '@/lib/cn'

/**
 * Fare options for the chosen route.
 *
 * Prices are fetched from `/api/pricing/quote` on every render of this screen
 * — nothing is cached client-side and no price is ever computed here.
 */
export default function SearchResults() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const routeId = params.get('route_id')
  const pickup = params.get('pickup')
  const drop = params.get('drop')
  const tripType = params.get('trip_type') || 'one_way'
  const date = params.get('date')
  const time = params.get('time') || '09:00'
  const scheduledAt = combineDateTime(date, time)

  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState('')

  const { data, loading, error, refetch } = useApi(
    () =>
      pricingService.quote({
        // Either identifies the trip; the server resolves places to a route,
        // so a customer who typed their own wording still gets a quote.
        route_id: routeId || undefined,
        pickup: routeId ? undefined : pickup || undefined,
        drop: routeId ? undefined : drop || undefined,
        trip_type: tripType,
        scheduled_at: scheduledAt,
        coupon_code: appliedCoupon || undefined,
      }),
    [routeId, pickup, drop, tripType, scheduledAt, appliedCoupon],
    { enabled: Boolean(routeId || (pickup && drop)) },
  )

  if (!routeId && !(pickup && drop)) {
    return (
      <EmptyState
        title="No route selected"
        description="Start from the booking form to see fares."
        action={
          <Link to="/app">
            <Button>Back to booking</Button>
          </Link>
        }
      />
    )
  }

  const tripLabel = TRIP_TYPES.find((item) => item.value === tripType)?.label || tripType
  const route = data?.route

  const choose = (option) => {
    const search = new URLSearchParams({
      trip_type: tripType,
      date,
      time,
      vehicle_type: option.vehicle_type,
    })
    // Carry whichever identified the trip through to the booking form.
    if (data?.route?.id || routeId) search.set('route_id', data?.route?.id || routeId)
    if (pickup) search.set('pickup', pickup)
    if (drop) search.set('drop', drop)
    if (appliedCoupon) search.set('coupon', appliedCoupon)
    navigate(`/app/book?${search.toString()}`)
  }

  return (
    <div className="space-y-5">
      <Link
        to="/app"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <IconChevronLeft className="h-4 w-4" />
        Change trip
      </Link>

      <PageHeader
        title={route?.name || 'Available fares'}
        description={
          route
            ? `${tripLabel} · ${formatDistance(route.distance_km)} · about ${formatDuration(
                route.duration_minutes,
              )}`
            : tripLabel
        }
      >
        {scheduledAt && (
          <p className="mt-1.5 text-sm text-ink-600">
            Pickup {formatShortDateTime(scheduledAt)}
          </p>
        )}
      </PageHeader>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Have a coupon?" htmlFor="coupon" className="min-w-[12rem] flex-1">
            <Input
              id="coupon"
              placeholder="e.g. FIRST10"
              value={couponInput}
              className="uppercase"
              onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={() => setAppliedCoupon(couponInput.trim())}
            disabled={!couponInput.trim()}
          >
            Apply
          </Button>
          {appliedCoupon && (
            <Button
              variant="ghost"
              onClick={() => {
                setAppliedCoupon('')
                setCouponInput('')
              }}
            >
              Remove
            </Button>
          )}
        </div>
        {appliedCoupon && data?.coupon && (
          <Alert tone="success" className="mt-3">
            <span className="flex items-center gap-1.5">
              <IconTag className="h-4 w-4" />
              <strong className="font-mono">{data.coupon.code}</strong> applied —{' '}
              {data.coupon.description}
            </span>
          </Alert>
        )}
        {appliedCoupon && data && !data.coupon && (
          <Alert tone="warning" className="mt-3">
            That coupon is not valid for this trip. Fares below are without a discount.
          </Alert>
        )}
      </Card>

      {loading ? (
        <SkeletonList count={3} lines={2} />
      ) : error ? (
        <ErrorState
          title="Could not load fares"
          error={error}
          onRetry={refetch}
        />
      ) : !data?.options?.length ? (
        <EmptyState
          icon={<IconCar />}
          title="No vehicles priced for this route"
          description="Our team has not published fares here yet. Contact support for a custom quote."
          action={
            <Link to="/app/support">
              <Button variant="secondary">Contact support</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {data.options.map((option) => {
            const soldOut = option.available_vehicles === 0
            return (
              <Card
                key={option.vehicle_type}
                className={cn(
                  'relative overflow-hidden p-4 transition-colors sm:p-5',
                  !soldOut && 'hover:border-ink-300',
                )}
              >
                {/* Accent rail: gives the card a clear left edge and lets a
                    sold-out class read as different at a glance. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-y-0 left-0 w-1',
                    soldOut ? 'bg-ink-200' : 'bg-brand-500',
                  )}
                />

                <div className="flex flex-wrap items-start justify-between gap-4 pl-2">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                      <IconCar className="h-7 w-7" />
                    </span>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-bold text-ink-900">{option.label}</p>
                        <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase text-ink-600">
                          {option.vehicle_type}
                        </span>
                        <span className="text-xs text-ink-400">or equivalent</span>
                      </div>

                      {/* What the fare does and does not cover, stated here
                          rather than discovered at the drop. */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Chip tone="neutral">
                          <IconUsers className="h-3 w-3" />
                          {option.seating_capacity} seats
                        </Chip>
                        <Chip tone="neutral">AC</Chip>
                        {Number(option.breakdown?.toll) > 0 ? (
                          <Chip tone="success">Toll included</Chip>
                        ) : (
                          <Chip tone="warn">Toll + parking extra</Chip>
                        )}
                        {Number(option.breakdown?.driver_allowance) > 0 && (
                          <Chip tone="success">Driver bata included</Chip>
                        )}
                      </div>

                      {option.description && (
                        <p className="mt-2 text-sm text-ink-500">{option.description}</p>
                      )}
                      {soldOut && (
                        <p className="mt-2 text-xs font-medium text-warning-700">
                          No vehicles of this class are free right now — we will confirm
                          availability before charging you.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right">
                      {option.breakdown.discount > 0 && (
                        <>
                          <p className="text-sm text-ink-400 line-through tabular">
                            {formatCurrency(option.breakdown.subtotal + option.breakdown.tax)}
                          </p>
                          <p className="text-xs font-semibold text-success-700">
                            Save {formatCurrency(option.breakdown.discount)}
                          </p>
                        </>
                      )}
                      <p className="text-2xl font-bold tabular tracking-tight text-ink-900">
                        {formatCurrency(option.fare)}
                      </p>
                      <p className="text-xs text-ink-500">all inclusive</p>
                    </div>
                    <Button variant="brand" onClick={() => choose(option)} className="w-full sm:w-auto">
                      Select &amp; continue →
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
          <p className="px-1 text-xs text-ink-500">
            Fares are confirmed by our team. Tolls, parking and state permits are charged at
            actuals where applicable.
          </p>
        </div>
      )}
    </div>
  )
}


/** Small labelled pill used on the vehicle cards. */
function Chip({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-ink-50 text-ink-600 ring-ink-100',
    success: 'bg-success-50 text-success-700 ring-success-100',
    warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-semibold ring-1',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}
