import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi, useDebounced, useListState } from '@/hooks/useApi'
import { pricingService, routeService } from '@/services'
import { formatDistance, formatDuration } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import { Checkbox, Field, Input } from '@/components/ui/Field'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Alert, EmptyState, PageHeader } from '@/components/ui/States'
import { IconEdit, IconPlus, IconRoute, IconSearch, IconTrash } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

const EMPTY_FORM = {
  origin: '',
  destination: '',
  name: '',
  distance_km: '',
  duration_minutes: '',
  is_active: true,
}

export default function AdminRoutes() {
  const toast = useToast()
  const { page, setPage } = useListState({})
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput, 350)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, refetch } = useApi(
    () => routeService.list({ search: search || undefined, page, page_size: 20 }),
    [search, page],
  )

  const remove = async () => {
    setBusy(true)
    try {
      await routeService.remove(deleting.id)
      toast.success('Route deleted.')
      setDeleting(null)
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (route) => {
    try {
      await routeService.update(route.id, { is_active: !route.is_active })
      toast.success(route.is_active ? 'Route deactivated.' : 'Route activated.')
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    }
  }

  // Which routes actually have a price row. Without this the table cannot
  // distinguish a bookable route from one that will fail at the quote.
  // GET /api/pricing returns a bare array of { route, prices } groups.
  const { data: priceBook } = useApi(() => pricingService.list(), [])
  const pricedRouteIds = Array.isArray(priceBook)
    ? new Set(priceBook.filter((g) => g.prices?.length).map((g) => g.route?.id))
    : null

  const columns = [
    {
      key: 'name',
      header: 'Route',
      card: 'title',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{row.name}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {row.origin} → {row.destination}
          </p>
          {/* An unpriced route is offered to customers and then fails at the
              quote. It looked perfectly healthy in this table before. */}
          {pricedRouteIds && !pricedRouteIds.has(row.id) && (
            <Link
              to="/admin/pricing"
              className="mt-1 inline-block text-xs font-medium text-danger-700 underline"
            >
              No prices set — add them
            </Link>
          )}
        </div>
      ),
    },
    {
      key: 'distance_km',
      header: 'Distance',
      align: 'right',
      render: (row) => <span className="tabular">{formatDistance(row.distance_km)}</span>,
    },
    {
      key: 'duration_minutes',
      header: 'Duration',
      align: 'right',
      render: (row) => <span className="tabular">{formatDuration(row.duration_minutes)}</span>,
    },
    {
      key: 'is_active',
      header: 'Status',
      card: 'aside',
      render: (row) => (
        <Badge tone={row.is_active ? 'success' : 'neutral'}>
          {row.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      card: 'hidden',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => toggleActive(row)}
            className="rounded-md px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-100"
          >
            {row.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(row)}
            className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            aria-label={`Edit ${row.name}`}
          >
            <IconEdit className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setDeleting(row)}
            className="rounded-md p-1.5 text-ink-500 hover:bg-danger-50 hover:text-danger-600"
            aria-label={`Delete ${row.name}`}
          >
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Routes"
        description="The origin–destination pairs you operate. Prices are set per route."
        action={
          <Button onClick={() => setEditing({})}>
            <IconPlus className="h-4 w-4" />
            Add route
          </Button>
        }
      />

      <Alert tone="info">
        A route needs at least one published price before customers can book it.{' '}
        <Link to="/admin/pricing" className="font-medium underline">
          Go to pricing
        </Link>
      </Alert>

      <Card>
        <CardBody>
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              className="pl-9"
              placeholder="Search origin, destination or route name"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search routes"
            />
          </div>
        </CardBody>
      </Card>

      <DataTable
        columns={columns}
        rows={data?.items}
        loading={loading}
        error={error}
        onRetry={refetch}
        empty={
          <EmptyState
            icon={<IconRoute />}
            title="No routes yet"
            description="Add the origin–destination pairs you serve."
            action={<Button onClick={() => setEditing({})}>Add route</Button>}
          />
        }
      />

      {data && (
        <Pagination
          page={data.page}
          pages={data.pages}
          total={data.total}
          pageSize={data.page_size}
          onPageChange={setPage}
        />
      )}

      <RouteModal
        open={Boolean(editing)}
        route={editing?.id ? editing : null}
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
        title="Delete this route?"
        message={`${deleting?.name} and its prices will be removed. Routes with bookings cannot be deleted — deactivate them instead.`}
        confirmLabel="Delete route"
      />
    </div>
  )
}

function RouteModal({ open, route, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setFormError(null)
    setForm(
      route
        ? {
            origin: route.origin,
            destination: route.destination,
            name: route.name,
            distance_km: route.distance_km,
            duration_minutes: route.duration_minutes,
            is_active: route.is_active,
          }
        : EMPTY_FORM,
    )
  }, [open, route])

  const submit = async () => {
    const next = {}
    if (form.origin.trim().length < 2) next.origin = 'Enter the origin city or area.'
    if (form.destination.trim().length < 2) next.destination = 'Enter the destination.'
    if (!Number(form.distance_km) || Number(form.distance_km) <= 0)
      next.distance_km = 'Enter the distance in kilometres.'
    if (!Number(form.duration_minutes) || Number(form.duration_minutes) <= 0)
      next.duration_minutes = 'Enter the typical duration in minutes.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        origin: form.origin.trim(),
        destination: form.destination.trim(),
        name: form.name.trim() || undefined,
        distance_km: Number(form.distance_km),
        duration_minutes: Number(form.duration_minutes),
        is_active: form.is_active,
      }
      if (route) await routeService.update(route.id, payload)
      else await routeService.create(payload)
      toast.success(route ? 'Route updated.' : 'Route created.')
      onSaved()
    } catch (caught) {
      setFormError(caught.message)
      setErrors(caught.fieldErrors || {})
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={route ? 'Edit route' : 'Add a route'}
      description="Local packages and airport transfers are modelled as routes too."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {route ? 'Save changes' : 'Create route'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Origin" htmlFor="origin" error={errors.origin} required>
            <Input
              id="origin"
              placeholder="Pune"
              value={form.origin}
              invalid={Boolean(errors.origin)}
              onChange={(event) => setForm({ ...form, origin: event.target.value })}
            />
          </Field>
          <Field label="Destination" htmlFor="destination" error={errors.destination} required>
            <Input
              id="destination"
              placeholder="Mumbai"
              value={form.destination}
              invalid={Boolean(errors.destination)}
              onChange={(event) => setForm({ ...form, destination: event.target.value })}
            />
          </Field>
        </div>

        <Field
          label="Display name"
          htmlFor="routeName"
          optionalLabel
          hint="Defaults to “Origin → Destination”."
        >
          <Input
            id="routeName"
            placeholder="Pune → Mumbai"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Distance (km)"
            htmlFor="distance"
            error={errors.distance_km}
            required
          >
            <Input
              id="distance"
              type="number"
              min="1"
              step="1"
              className="tabular"
              value={form.distance_km}
              invalid={Boolean(errors.distance_km)}
              onChange={(event) => setForm({ ...form, distance_km: event.target.value })}
            />
          </Field>
          <Field
            label="Duration (minutes)"
            htmlFor="duration"
            error={errors.duration_minutes}
            required
          >
            <Input
              id="duration"
              type="number"
              min="1"
              step="5"
              className="tabular"
              value={form.duration_minutes}
              invalid={Boolean(errors.duration_minutes)}
              onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })}
            />
          </Field>
        </div>

        <Checkbox
          label="Active"
          description="Inactive routes are hidden from customers."
          checked={form.is_active}
          onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
        />
      </div>
    </Modal>
  )
}
