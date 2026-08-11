import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { pricingService, routeService } from '@/services'
import { formatCurrency, formatDistance } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Checkbox, Field, Input, Select } from '@/components/ui/Field'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconClipboard, IconEdit, IconPlus, IconTrash } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'

const EMPTY_FORM = {
  route_id: '',
  vehicle_type: 'sedan',
  fixed_fare: '',
  base_fare: 0,
  per_km_rate: 0,
  driver_allowance: 0,
  toll: 0,
  night_surcharge: 0,
  airport_surcharge: 0,
  additional_charges: 0,
  is_active: true,
}

export default function AdminPricing() {
  const toast = useToast()
  const [routeFilter, setRouteFilter] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

  const { data: routes } = useApi(() => routeService.list({ page_size: 200 }), [])
  const { data: classes } = useApi(() => routeService.vehicleClasses(), [])
  const { data: groups, loading, error, refetch } = useApi(
    () => pricingService.list(routeFilter || undefined),
    [routeFilter],
  )

  const remove = async () => {
    setBusy(true)
    try {
      await pricingService.remove(deleting.id)
      toast.success('Price removed.')
      setDeleting(null)
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const pricedRouteIds = new Set((groups || []).map((group) => group.route.id))
  const unpricedRoutes = (routes?.items || []).filter(
    (route) => !pricedRouteIds.has(route.id) && route.is_active,
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pricing"
        description="Fares per route and vehicle class. This is the only source of truth for what customers are charged."
        action={
          <Button onClick={() => setEditing({})}>
            <IconPlus className="h-4 w-4" />
            Add price
          </Button>
        }
      />

      <Alert tone="info">
        Fares are calculated on the server from these rows. A price the browser sends is never
        trusted — editing here changes what customers see immediately.
      </Alert>

      {unpricedRoutes.length > 0 && (
        <Alert tone="warning" title={`${unpricedRoutes.length} route(s) have no pricing`}>
          <p className="mt-1">
            Customers cannot book{' '}
            {unpricedRoutes
              .slice(0, 3)
              .map((route) => route.name)
              .join(', ')}
            {unpricedRoutes.length > 3 ? ` and ${unpricedRoutes.length - 3} more` : ''}.
          </p>
        </Alert>
      )}

      <Card>
        <CardBody>
          <Field label="Filter by route" htmlFor="routeFilter" className="max-w-md">
            <Select
              id="routeFilter"
              value={routeFilter}
              placeholder="All routes"
              onChange={(event) => setRouteFilter(event.target.value)}
            >
              {(routes?.items || []).map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {loading ? (
        <SkeletonList count={3} lines={4} />
      ) : error ? (
        <ErrorState title="Could not load pricing" error={error} onRetry={refetch} />
      ) : !groups?.length ? (
        <EmptyState
          icon={<IconClipboard />}
          title="No prices published"
          description="Add a price for a route and vehicle class so customers can book."
          action={<Button onClick={() => setEditing({})}>Add price</Button>}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <Card key={group.route.id}>
              <CardHeader
                title={group.route.name}
                description={`${formatDistance(group.route.distance_km)} · ${
                  group.prices.length
                } vehicle ${group.prices.length === 1 ? 'class' : 'classes'} priced`}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditing({ route_id: group.route.id })}
                  >
                    <IconPlus className="h-4 w-4" />
                    Add class
                  </Button>
                }
              />
              <CardBody className="p-0">
                <div className="scrollbar-slim overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                        <th className="px-4 py-2.5 font-semibold">Vehicle class</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Fare</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Allowance</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Toll</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Night</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Airport</th>
                        <th className="px-4 py-2.5 font-semibold">Status</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {group.prices.map((price) => (
                        <tr key={price.id} className={cn(!price.is_active && 'opacity-55')}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-ink-900">
                              {price.class_info?.label || price.vehicle_type}
                            </p>
                            <p className="text-xs text-ink-500">
                              {price.class_info?.seating_capacity} passengers
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="tabular font-semibold text-ink-900">
                              {price.fixed_fare != null
                                ? formatCurrency(price.fixed_fare)
                                : `${formatCurrency(price.base_fare)} + ${formatCurrency(
                                    price.per_km_rate,
                                  )}/km`}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular text-ink-600">
                            {price.driver_allowance ? formatCurrency(price.driver_allowance) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular text-ink-600">
                            {price.toll ? formatCurrency(price.toll) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular text-ink-600">
                            {price.night_surcharge ? formatCurrency(price.night_surcharge) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular text-ink-600">
                            {price.airport_surcharge
                              ? formatCurrency(price.airport_surcharge)
                              : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={price.is_active ? 'success' : 'neutral'}>
                              {price.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setEditing({ ...price, route_id: group.route.id, _edit: true })
                                }
                                className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                                aria-label="Edit price"
                              >
                                <IconEdit className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleting(price)}
                                className="rounded-md p-1.5 text-ink-500 hover:bg-danger-50 hover:text-danger-600"
                                aria-label="Delete price"
                              >
                                <IconTrash className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <PriceModal
        open={Boolean(editing)}
        price={editing?._edit ? editing : null}
        presetRouteId={editing?.route_id}
        routes={routes?.items || []}
        classes={classes || []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          refetch()
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        loading={busy}
        title="Remove this price?"
        message="Customers will no longer be able to book this vehicle class on this route."
        confirmLabel="Remove price"
      />
    </div>
  )
}

function PriceModal({ open, price, presetRouteId, routes, classes, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState('fixed')

  useEffect(() => {
    if (!open) return
    setErrors({})
    setFormError(null)
    if (price) {
      setMode(price.fixed_fare != null ? 'fixed' : 'distance')
      setForm({
        route_id: price.route_id,
        vehicle_type: price.vehicle_type,
        fixed_fare: price.fixed_fare ?? '',
        base_fare: price.base_fare ?? 0,
        per_km_rate: price.per_km_rate ?? 0,
        driver_allowance: price.driver_allowance ?? 0,
        toll: price.toll ?? 0,
        night_surcharge: price.night_surcharge ?? 0,
        airport_surcharge: price.airport_surcharge ?? 0,
        additional_charges: price.additional_charges ?? 0,
        is_active: price.is_active,
      })
    } else {
      setMode('fixed')
      setForm({ ...EMPTY_FORM, route_id: presetRouteId || '' })
    }
  }, [open, price, presetRouteId])

  const submit = async () => {
    const next = {}
    if (!form.route_id) next.route_id = 'Choose a route.'
    if (mode === 'fixed' && (!Number(form.fixed_fare) || Number(form.fixed_fare) <= 0))
      next.fixed_fare = 'Enter the fare for this route and class.'
    if (mode === 'distance' && !Number(form.per_km_rate))
      next.per_km_rate = 'Enter a per-km rate.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        route_id: form.route_id,
        vehicle_type: form.vehicle_type,
        fixed_fare: mode === 'fixed' ? Number(form.fixed_fare) : null,
        base_fare: Number(form.base_fare) || 0,
        per_km_rate: Number(form.per_km_rate) || 0,
        driver_allowance: Number(form.driver_allowance) || 0,
        toll: Number(form.toll) || 0,
        night_surcharge: Number(form.night_surcharge) || 0,
        airport_surcharge: Number(form.airport_surcharge) || 0,
        additional_charges: Number(form.additional_charges) || 0,
        is_active: form.is_active,
      }
      // PUT upserts on (route, vehicle class), so create and edit share a path.
      await pricingService.upsert(payload)
      toast.success(price ? 'Price updated.' : 'Price published.')
      onSaved()
    } catch (caught) {
      setFormError(caught.message)
      setErrors(caught.fieldErrors || {})
    } finally {
      setSaving(false)
    }
  }

  const numberField = (key, label, hint) => (
    <Field label={label} htmlFor={key} hint={hint} error={errors[key]}>
      <Input
        id={key}
        type="number"
        min="0"
        step="1"
        className="tabular"
        value={form[key]}
        invalid={Boolean(errors[key])}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </Field>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={price ? 'Edit price' : 'Publish a price'}
      description="Applies to one route and one vehicle class."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {price ? 'Save price' : 'Publish price'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Route" htmlFor="priceRoute" error={errors.route_id} required>
            <Select
              id="priceRoute"
              value={form.route_id}
              placeholder="Select a route"
              disabled={Boolean(price)}
              invalid={Boolean(errors.route_id)}
              onChange={(event) => setForm({ ...form, route_id: event.target.value })}
            >
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vehicle class" htmlFor="priceClass" required>
            <Select
              id="priceClass"
              value={form.vehicle_type}
              disabled={Boolean(price)}
              onChange={(event) => setForm({ ...form, vehicle_type: event.target.value })}
            >
              {classes.map((item) => (
                <option key={item.vehicle_type} value={item.vehicle_type}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="rounded-lg border border-ink-200 p-3.5">
          <div className="mb-3 flex gap-1 rounded-lg bg-ink-100 p-1">
            {[
              { key: 'fixed', label: 'Fixed route fare' },
              { key: 'distance', label: 'Distance based' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setMode(tab.key)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  mode === tab.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mode === 'fixed' ? (
            <Field
              label="Fare (₹)"
              htmlFor="fixedFare"
              error={errors.fixed_fare}
              hint="What the customer pays for a one-way trip on this route."
              required
            >
              <Input
                id="fixedFare"
                type="number"
                min="0"
                step="50"
                className="tabular"
                value={form.fixed_fare}
                invalid={Boolean(errors.fixed_fare)}
                onChange={(event) => setForm({ ...form, fixed_fare: event.target.value })}
              />
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField('base_fare', 'Base fare (₹)')}
              {numberField('per_km_rate', 'Per km rate (₹)')}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {numberField('driver_allowance', 'Driver allowance (₹)')}
          {numberField('toll', 'Toll & parking (₹)')}
          {numberField('night_surcharge', 'Night surcharge (₹)', 'Applied for night pickups.')}
          {numberField('airport_surcharge', 'Airport surcharge (₹)', 'Airport transfers only.')}
        </div>

        {numberField('additional_charges', 'Additional charges (₹)')}

        <Checkbox
          label="Active"
          description="Inactive prices are hidden from customers."
          checked={form.is_active}
          onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
        />
      </div>
    </Modal>
  )
}
