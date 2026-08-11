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
  const tripType = params.get('trip_type') || 'one_way'
  const date = params.get('date')
  const time = params.get('time') || '09:00'
  const scheduledAt = combineDateTime(date, time)

  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState('')

  const { data, loading, error, refetch } = useApi(
    () =>
      pricingService.quote({
        route_id: routeId,
        trip_type: tripType,
        scheduled_at: scheduledAt,
        coupon_code: appliedCoupon || undefined,
      }),
    [routeId, tripType, scheduledAt, appliedCoupon],
    { enabled: Boolean(routeId) },
  )

  if (!routeId) {
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
      route_id: routeId,
      trip_type: tripType,
      date,
      time,
      vehicle_type: option.vehicle_type,
    })
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
                className={cn('p-4 transition-colors', !soldOut && 'hover:border-ink-300')}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                      <IconCar className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-ink-900">{option.label}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-500">
                        <IconUsers className="h-3.5 w-3.5" />
                        {option.seating_capacity} passengers
                      </p>
                      {option.description && (
                        <p className="mt-1 text-sm text-ink-500">{option.description}</p>
                      )}
                      {soldOut && (
                        <p className="mt-1.5 text-xs font-medium text-warning-700">
                          No vehicles of this class are free right now — we will confirm
                          availability before charging you.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right">
                      {option.breakdown.discount > 0 && (
                        <p className="text-sm text-ink-400 line-through tabular">
                          {formatCurrency(
                            option.breakdown.subtotal + option.breakdown.tax,
                          )}
                        </p>
                      )}
                      <p className="text-xl font-semibold tabular tracking-tight text-ink-900">
                        {formatCurrency(option.fare)}
                      </p>
                      <p className="text-xs text-ink-500">all inclusive</p>
                    </div>
                    <Button size="sm" onClick={() => choose(option)}>
                      Select
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
