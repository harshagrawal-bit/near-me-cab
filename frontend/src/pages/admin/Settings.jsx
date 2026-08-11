import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { adminService, routeService } from '@/services'
import { brand } from '@/config/brand'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Checkbox, Field, Input } from '@/components/ui/Field'
import { Alert, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonCard } from '@/components/ui/Loaders'
import { useToast } from '@/components/ui/Toast'

export default function AdminSettings() {
  const toast = useToast()
  const { data, loading, error, refetch } = useApi(() => adminService.settings(), [])
  const { data: maps } = useApi(() => routeService.mapCapabilities(), [])

  const [company, setCompany] = useState(null)
  const [pricing, setPricing] = useState(null)
  const [booking, setBooking] = useState(null)
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    if (!data) return
    setCompany(data.company)
    setPricing(data.pricing)
    setBooking(data.booking)
  }, [data])

  if (loading || !company) return <SkeletonCard lines={10} />
  if (error) return <ErrorState title="Could not load settings" error={error} onRetry={refetch} />

  const save = async (section, payload) => {
    setSaving(section)
    try {
      await adminService.updateSettings({ [section]: payload })
      toast.success('Settings saved.')
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Company details and the rules the booking and fare engines follow."
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Company"
            description="Shown to customers on the support screen."
          />
          <CardBody>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                save('company', company)
              }}
              className="space-y-4"
            >
              <Field label="Legal name" htmlFor="legalName">
                <Input
                  id="legalName"
                  value={company.legal_name}
                  onChange={(event) =>
                    setCompany({ ...company, legal_name: event.target.value })
                  }
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Support phone" htmlFor="supportPhone">
                  <Input
                    id="supportPhone"
                    value={company.support_phone}
                    onChange={(event) =>
                      setCompany({ ...company, support_phone: event.target.value })
                    }
                  />
                </Field>
                <Field label="WhatsApp number" htmlFor="whatsapp">
                  <Input
                    id="whatsapp"
                    value={company.whatsapp_number}
                    onChange={(event) =>
                      setCompany({ ...company, whatsapp_number: event.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="Support email" htmlFor="supportEmail">
                <Input
                  id="supportEmail"
                  type="email"
                  value={company.support_email}
                  onChange={(event) =>
                    setCompany({ ...company, support_email: event.target.value })
                  }
                />
              </Field>
              <Field label="Address" htmlFor="address">
                <Input
                  id="address"
                  value={company.address}
                  onChange={(event) => setCompany({ ...company, address: event.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Working hours" htmlFor="hours">
                  <Input
                    id="hours"
                    value={company.working_hours}
                    onChange={(event) =>
                      setCompany({ ...company, working_hours: event.target.value })
                    }
                  />
                </Field>
                <Field label="GST number" htmlFor="gst" optionalLabel>
                  <Input
                    id="gst"
                    value={company.gst_number || ''}
                    onChange={(event) =>
                      setCompany({ ...company, gst_number: event.target.value })
                    }
                  />
                </Field>
              </div>
              <Button type="submit" loading={saving === 'company'}>
                Save company details
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Fare engine"
            description="These knobs change what customers are quoted, immediately."
          />
          <CardBody>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                save('pricing', pricing)
              }}
              className="space-y-4"
            >
              <Alert tone="warning">
                Multipliers apply on top of the route price. A round-trip factor of 1.85 means a
                ₹3,000 one-way route quotes ₹5,550 as a round trip.
              </Alert>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="One way factor" htmlFor="oneWay">
                  <Input
                    id="oneWay"
                    type="number"
                    step="0.05"
                    min="0.1"
                    className="tabular"
                    value={pricing.one_way_multiplier}
                    onChange={(event) =>
                      setPricing({ ...pricing, one_way_multiplier: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Round trip factor" htmlFor="roundTrip">
                  <Input
                    id="roundTrip"
                    type="number"
                    step="0.05"
                    min="1"
                    className="tabular"
                    value={pricing.round_trip_multiplier}
                    onChange={(event) =>
                      setPricing({
                        ...pricing,
                        round_trip_multiplier: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Local factor" htmlFor="localFactor">
                  <Input
                    id="localFactor"
                    type="number"
                    step="0.05"
                    min="0.1"
                    className="tabular"
                    value={pricing.local_multiplier}
                    onChange={(event) =>
                      setPricing({ ...pricing, local_multiplier: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Airport factor" htmlFor="airportFactor">
                  <Input
                    id="airportFactor"
                    type="number"
                    step="0.05"
                    min="0.1"
                    className="tabular"
                    value={pricing.airport_multiplier}
                    onChange={(event) =>
                      setPricing({ ...pricing, airport_multiplier: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Night starts (hour, UTC)"
                  htmlFor="nightStart"
                  hint="Night surcharge applies from this hour."
                >
                  <Input
                    id="nightStart"
                    type="number"
                    min="0"
                    max="23"
                    className="tabular"
                    value={pricing.night_start_hour}
                    onChange={(event) =>
                      setPricing({ ...pricing, night_start_hour: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Night ends (hour, UTC)" htmlFor="nightEnd">
                  <Input
                    id="nightEnd"
                    type="number"
                    min="0"
                    max="23"
                    className="tabular"
                    value={pricing.night_end_hour}
                    onChange={(event) =>
                      setPricing({ ...pricing, night_end_hour: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tax (%)" htmlFor="tax" hint="Applied after any discount.">
                  <Input
                    id="tax"
                    type="number"
                    step="0.5"
                    min="0"
                    max="50"
                    className="tabular"
                    value={pricing.tax_percent}
                    onChange={(event) =>
                      setPricing({ ...pricing, tax_percent: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Cancellation fee (%)" htmlFor="cancelFee">
                  <Input
                    id="cancelFee"
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    className="tabular"
                    value={pricing.cancellation_fee_percent}
                    onChange={(event) =>
                      setPricing({
                        ...pricing,
                        cancellation_fee_percent: Number(event.target.value),
                      })
                    }
                  />
                </Field>
              </div>

              <Field
                label="Free cancellation window (hours)"
                htmlFor="freeCancel"
                hint="Cancellations this far ahead of pickup are always free."
              >
                <Input
                  id="freeCancel"
                  type="number"
                  min="0"
                  max="168"
                  className="tabular"
                  value={pricing.free_cancellation_hours}
                  onChange={(event) =>
                    setPricing({
                      ...pricing,
                      free_cancellation_hours: Number(event.target.value),
                    })
                  }
                />
              </Field>

              <Button type="submit" loading={saving === 'pricing'}>
                Save fare settings
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Booking rules" />
          <CardBody>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                save('booking', booking)
              }}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Minimum lead time (minutes)"
                  htmlFor="minAdvance"
                  hint="How far ahead a customer must book."
                >
                  <Input
                    id="minAdvance"
                    type="number"
                    min="0"
                    className="tabular"
                    value={booking.min_advance_minutes}
                    onChange={(event) =>
                      setBooking({ ...booking, min_advance_minutes: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Maximum advance (days)" htmlFor="maxAdvance">
                  <Input
                    id="maxAdvance"
                    type="number"
                    min="1"
                    max="365"
                    className="tabular"
                    value={booking.max_advance_days}
                    onChange={(event) =>
                      setBooking({ ...booking, max_advance_days: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>

              <Checkbox
                label="Auto-confirm new bookings"
                description="Skips manual confirmation. Leave off if you want to check availability first."
                checked={booking.auto_confirm}
                onChange={(event) =>
                  setBooking({ ...booking, auto_confirm: event.target.checked })
                }
              />

              <Button type="submit" loading={saving === 'booking'}>
                Save booking rules
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Integrations"
            description="What is actually connected in this deployment."
          />
          <CardBody className="space-y-3">
            <IntegrationRow
              label="In-app notifications"
              enabled
              detail="Notification records are written and shown in the app."
            />
            <IntegrationRow
              label="Google Maps"
              enabled={Boolean(maps?.google_maps_enabled)}
              detail={
                maps?.google_maps_enabled
                  ? 'API key configured on the server.'
                  : 'Not connected. Place suggestions come from your route catalogue.'
              }
            />
            <IntegrationRow
              label="Live driver tracking"
              enabled={Boolean(maps?.live_tracking)}
              detail="Not built. The architecture leaves room for WebSocket tracking later."
            />
            <IntegrationRow
              label="Online payments"
              enabled={false}
              detail="Payments are recorded manually. The ledger is gateway-agnostic."
            />
            <IntegrationRow
              label="SMS / WhatsApp / Push"
              enabled={false}
              detail="Channel adapters exist but no provider is wired up."
            />

            <Alert tone="neutral" className="mt-4">
              Branding is configured in <code className="font-mono">frontend/src/config/brand.js</code>
              . Currently showing <strong>{brand.name}</strong>.
            </Alert>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function IntegrationRow({ label, enabled, detail }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink-100 pb-3 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-900">{label}</p>
        <p className="mt-0.5 text-sm text-ink-500">{detail}</p>
      </div>
      <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Live' : 'Not connected'}</Badge>
    </div>
  )
}
