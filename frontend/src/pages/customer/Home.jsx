import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useApi } from '@/hooks/useApi'
import { couponService, routeService } from '@/services'
import { TRIP_TYPES } from '@/lib/constants'
import { formatDistance, formatDuration, toDateInputValue } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, RadioCards, Select } from '@/components/ui/Field'
import { Alert } from '@/components/ui/States'
import { Skeleton } from '@/components/ui/Loaders'
import { IconArrowRight, IconPin, IconTag } from '@/components/ui/Icons'

/** Tomorrow, 09:00 — a sensible default that always passes the lead-time rule. */
function defaultDate() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return toDateInputValue(date)
}

export default function CustomerHome() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const { data: routesPage, loading: routesLoading } = useApi(
    () => routeService.list({ page_size: 100 }),
    [],
  )
  const { data: popular } = useApi(() => routeService.popular(6), [])
  const { data: offers } = useApi(() => couponService.offers(), [])

  const [form, setForm] = useState({
    routeId: '',
    tripType: 'one_way',
    date: defaultDate(),
    time: '09:00',
  })
  const [error, setError] = useState(null)

  const routes = routesPage?.items || []

  // Group by origin so a long catalogue stays navigable in a single select.
  const grouped = useMemo(() => {
    const map = new Map()
    routes.forEach((route) => {
      if (!map.has(route.origin)) map.set(route.origin, [])
      map.get(route.origin).push(route)
    })
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [routes])

  const selectedRoute = routes.find((route) => route.id === form.routeId)

  const onSubmit = (event) => {
    event.preventDefault()
    if (!form.routeId) {
      setError('Choose where you are travelling.')
      return
    }
    if (!form.date || !form.time) {
      setError('Pick a travel date and time.')
      return
    }
    setError(null)
    const params = new URLSearchParams({
      route_id: form.routeId,
      trip_type: form.tripType,
      date: form.date,
      time: form.time,
    })
    navigate(`/app/search?${params.toString()}`)
  }

  const firstName = user?.name?.split(' ')[0] || 'there'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Hello, {firstName}
        </h1>
        <p className="mt-1 text-sm text-ink-500">Where are you headed?</p>
      </div>

      <Card className="p-4 sm:p-5">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}

          <Field label="Trip type">
            <RadioCards
              name="tripType"
              value={form.tripType}
              onChange={(value) => setForm({ ...form, tripType: value })}
              options={TRIP_TYPES}
              columns={2}
            />
          </Field>

          <Field
            label="Pickup and drop"
            htmlFor="route"
            required
            hint={
              selectedRoute
                ? `${formatDistance(selectedRoute.distance_km)} · about ${formatDuration(
                    selectedRoute.duration_minutes,
                  )}`
                : 'Choose from the routes we operate.'
            }
          >
            {routesLoading ? (
              <Skeleton className="h-11 w-full rounded-lg" />
            ) : (
              <Select
                id="route"
                value={form.routeId}
                placeholder="Select a route"
                onChange={(event) => setForm({ ...form, routeId: event.target.value })}
              >
                {grouped.map(([origin, items]) => (
                  <optgroup key={origin} label={`From ${origin}`}>
                    {items.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Travel date" htmlFor="date" required>
              <Input
                id="date"
                type="date"
                value={form.date}
                min={toDateInputValue(new Date())}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </Field>
            <Field label="Pickup time" htmlFor="time" required>
              <Input
                id="time"
                type="time"
                value={form.time}
                onChange={(event) => setForm({ ...form, time: event.target.value })}
              />
            </Field>
          </div>

          <Button type="submit" size="lg" fullWidth>
            Get Fare Estimate
          </Button>
        </form>
      </Card>

      {offers?.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-sm font-semibold text-ink-900">Current offers</h2>
          <div className="scrollbar-slim flex gap-3 overflow-x-auto pb-1">
            {offers.map((offer) => (
              <div
                key={offer.code}
                className="flex min-w-[15rem] items-start gap-2.5 rounded-card border border-brand-100 bg-brand-50 p-3.5"
              >
                <IconTag className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-brand-800">{offer.code}</p>
                  <p className="mt-0.5 text-xs text-brand-800/80">{offer.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {popular?.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-sm font-semibold text-ink-900">Popular routes</h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {popular.map((route) => (
              <button
                key={route.id}
                type="button"
                onClick={() => {
                  setForm({ ...form, routeId: route.id })
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                className="flex items-center justify-between gap-3 rounded-card border border-ink-200 bg-white p-3.5 text-left shadow-card transition-colors hover:border-ink-300"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
                    <IconPin className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{route.name}</p>
                    <p className="text-xs text-ink-500">
                      {formatDistance(route.distance_km)} · {formatDuration(route.duration_minutes)}
                    </p>
                  </div>
                </div>
                <IconArrowRight className="h-4 w-4 shrink-0 text-ink-400" />
              </button>
            ))}
          </div>
        </section>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-medium text-ink-900">Need something custom?</p>
          <p className="text-sm text-ink-500">
            Multi-city, long tours or a route we do not list yet.
          </p>
        </div>
        <Link to="/app/support">
          <Button variant="secondary" size="sm">
            Talk to us
          </Button>
        </Link>
      </Card>
    </div>
  )
}
