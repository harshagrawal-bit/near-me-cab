import { useEffect, useState } from 'react'
import { useApi, useListState } from '@/hooks/useApi'
import { couponService } from '@/services'
import { formatCurrency, formatDate, toDateInputValue } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import { Checkbox, Field, Input, Select } from '@/components/ui/Field'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Alert, EmptyState, PageHeader } from '@/components/ui/States'
import { IconEdit, IconPlus, IconTag, IconTrash } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

const EMPTY_FORM = {
  code: '',
  description: '',
  discount_type: 'percent',
  discount_value: '',
  min_booking_value: 0,
  max_discount: '',
  expires_at: '',
  usage_limit: '',
  is_active: true,
}

export default function AdminOffers() {
  const toast = useToast()
  const { page, setPage } = useListState({})
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, refetch } = useApi(
    () => couponService.list({ page, page_size: 20 }),
    [page],
  )

  const remove = async () => {
    setBusy(true)
    try {
      await couponService.remove(deleting.id)
      toast.success('Coupon deleted.')
      setDeleting(null)
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (coupon) => {
    try {
      await couponService.update(coupon.id, { is_active: !coupon.is_active })
      toast.success(coupon.is_active ? 'Coupon disabled.' : 'Coupon enabled.')
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    }
  }

  const isExpired = (coupon) => coupon.expires_at && new Date(coupon.expires_at) < new Date()
  const isExhausted = (coupon) =>
    coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit

  const columns = [
    {
      key: 'code',
      header: 'Code',
      card: 'title',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-ink-900">{row.code}</p>
          {row.description && (
            <p className="mt-0.5 truncate text-xs text-ink-500">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'discount',
      header: 'Discount',
      render: (row) =>
        row.discount_type === 'percent'
          ? `${row.discount_value}%${row.max_discount ? ` up to ${formatCurrency(row.max_discount)}` : ''}`
          : formatCurrency(row.discount_value),
    },
    {
      key: 'min_booking_value',
      header: 'Min booking',
      align: 'right',
      render: (row) =>
        row.min_booking_value ? (
          <span className="tabular">{formatCurrency(row.min_booking_value)}</span>
        ) : (
          '—'
        ),
    },
    {
      key: 'usage',
      header: 'Used',
      align: 'right',
      render: (row) => (
        <span className="tabular">
          {row.used_count}
          {row.usage_limit != null ? ` / ${row.usage_limit}` : ''}
        </span>
      ),
    },
    {
      key: 'expires_at',
      header: 'Expires',
      render: (row) => (row.expires_at ? formatDate(row.expires_at) : 'No expiry'),
    },
    {
      key: 'status',
      header: 'Status',
      card: 'aside',
      render: (row) => {
        if (!row.is_active) return <Badge tone="neutral">Disabled</Badge>
        if (isExpired(row)) return <Badge tone="danger">Expired</Badge>
        if (isExhausted(row)) return <Badge tone="warning">Limit reached</Badge>
        return <Badge tone="success">Active</Badge>
      },
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
            {row.is_active ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(row)}
            className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            aria-label={`Edit ${row.code}`}
          >
            <IconEdit className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setDeleting(row)}
            className="rounded-md p-1.5 text-ink-500 hover:bg-danger-50 hover:text-danger-600"
            aria-label={`Delete ${row.code}`}
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
        title="Offers"
        description="Coupon codes customers can apply at checkout."
        action={
          <Button onClick={() => setEditing({})}>
            <IconPlus className="h-4 w-4" />
            Create coupon
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.items}
        loading={loading}
        error={error}
        onRetry={refetch}
        empty={
          <EmptyState
            icon={<IconTag />}
            title="No coupons yet"
            description="Create a coupon to run a promotion."
            action={<Button onClick={() => setEditing({})}>Create coupon</Button>}
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

      <CouponModal
        open={Boolean(editing)}
        coupon={editing?.id ? editing : null}
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
        title="Delete this coupon?"
        message={`${deleting?.code} will stop working immediately. Bookings that already used it are unaffected.`}
        confirmLabel="Delete coupon"
      />
    </div>
  )
}

function CouponModal({ open, coupon, onClose, onSaved }) {
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
      coupon
        ? {
            code: coupon.code,
            description: coupon.description || '',
            discount_type: coupon.discount_type,
            discount_value: coupon.discount_value,
            min_booking_value: coupon.min_booking_value || 0,
            max_discount: coupon.max_discount ?? '',
            expires_at: toDateInputValue(coupon.expires_at),
            usage_limit: coupon.usage_limit ?? '',
            is_active: coupon.is_active,
          }
        : EMPTY_FORM,
    )
  }, [open, coupon])

  const submit = async () => {
    const next = {}
    if (!coupon && !/^[A-Za-z0-9_-]{3,24}$/.test(form.code.trim()))
      next.code = 'Use 3–24 letters, numbers, hyphen or underscore.'
    const value = Number(form.discount_value)
    if (!value || value <= 0) next.discount_value = 'Enter a discount value.'
    if (form.discount_type === 'percent' && value > 100)
      next.discount_value = 'A percentage cannot exceed 100.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        description: form.description.trim() || undefined,
        discount_type: form.discount_type,
        discount_value: value,
        min_booking_value: Number(form.min_booking_value) || 0,
        max_discount: form.max_discount === '' ? null : Number(form.max_discount),
        expires_at: form.expires_at ? `${form.expires_at}T23:59:59` : null,
        usage_limit: form.usage_limit === '' ? null : Number(form.usage_limit),
        is_active: form.is_active,
      }
      if (coupon) {
        await couponService.update(coupon.id, payload)
      } else {
        await couponService.create({ ...payload, code: form.code.trim().toUpperCase() })
      }
      toast.success(coupon ? 'Coupon updated.' : 'Coupon created.')
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
      title={coupon ? 'Edit coupon' : 'Create a coupon'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {coupon ? 'Save changes' : 'Create coupon'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Field
          label="Coupon code"
          htmlFor="code"
          error={errors.code}
          hint={coupon ? 'The code cannot be changed after creation.' : 'Customers type this in.'}
          required
        >
          <Input
            id="code"
            className="font-mono uppercase"
            maxLength={24}
            disabled={Boolean(coupon)}
            value={form.code}
            invalid={Boolean(errors.code)}
            onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
          />
        </Field>

        <Field label="Description" htmlFor="description" optionalLabel>
          <Input
            id="description"
            maxLength={160}
            placeholder="10% off your first ride, up to ₹500"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Discount type" htmlFor="discountType">
            <Select
              id="discountType"
              value={form.discount_type}
              onChange={(event) => setForm({ ...form, discount_type: event.target.value })}
            >
              <option value="percent">Percentage</option>
              <option value="flat">Flat amount</option>
            </Select>
          </Field>
          <Field
            label={form.discount_type === 'percent' ? 'Discount (%)' : 'Discount (₹)'}
            htmlFor="discountValue"
            error={errors.discount_value}
            required
          >
            <Input
              id="discountValue"
              type="number"
              min="1"
              max={form.discount_type === 'percent' ? '100' : undefined}
              className="tabular"
              value={form.discount_value}
              invalid={Boolean(errors.discount_value)}
              onChange={(event) => setForm({ ...form, discount_value: event.target.value })}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum booking value (₹)" htmlFor="minBooking">
            <Input
              id="minBooking"
              type="number"
              min="0"
              className="tabular"
              value={form.min_booking_value}
              onChange={(event) => setForm({ ...form, min_booking_value: event.target.value })}
            />
          </Field>
          <Field
            label="Maximum discount (₹)"
            htmlFor="maxDiscount"
            optionalLabel
            hint="Caps a percentage discount."
          >
            <Input
              id="maxDiscount"
              type="number"
              min="0"
              className="tabular"
              value={form.max_discount}
              onChange={(event) => setForm({ ...form, max_discount: event.target.value })}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expires on" htmlFor="expiresAt" optionalLabel>
            <Input
              id="expiresAt"
              type="date"
              min={toDateInputValue(new Date())}
              value={form.expires_at}
              onChange={(event) => setForm({ ...form, expires_at: event.target.value })}
            />
          </Field>
          <Field
            label="Usage limit"
            htmlFor="usageLimit"
            optionalLabel
            hint="Total redemptions allowed."
          >
            <Input
              id="usageLimit"
              type="number"
              min="1"
              className="tabular"
              value={form.usage_limit}
              onChange={(event) => setForm({ ...form, usage_limit: event.target.value })}
            />
          </Field>
        </div>

        <Checkbox
          label="Active"
          description="Inactive coupons are rejected at checkout."
          checked={form.is_active}
          onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
        />
      </div>
    </Modal>
  )
}
