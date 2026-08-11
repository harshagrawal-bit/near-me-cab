import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { supportService } from '@/services'
import { brand } from '@/config/brand'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Alert, EmptyState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconInbox, IconPhone, IconSupport } from '@/components/ui/Icons'
import { formatDateTime, formatPhone } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'

const FAQS = [
  {
    question: 'How soon is a booking confirmed?',
    answer:
      'Our operations team reviews every request and usually confirms within a few minutes during working hours. You will get a notification as soon as it is confirmed and again when a driver is assigned.',
  },
  {
    question: 'When do I pay?',
    answer:
      'After the trip. You can pay the driver in cash, or by UPI which our team records against your booking. Nothing is charged when you book.',
  },
  {
    question: 'Can I cancel?',
    answer:
      'Yes — from the booking page, any time before the driver picks you up. Once the trip has started, call us instead.',
  },
  {
    question: 'Are tolls included in the fare?',
    answer:
      'Fares include the base trip cost. Tolls, parking and state permits are charged at actuals where applicable, and shown on the fare breakdown.',
  },
]

export default function Support() {
  const toast = useToast()
  const { data: contact } = useApi(() => supportService.contact(), [])
  const { data: requests, loading, refetch } = useApi(
    () => supportService.myRequests({ page_size: 10 }),
    [],
  )

  const [form, setForm] = useState({ subject: '', message: '', bookingId: '' })
  const [errors, setErrors] = useState({})
  const [sending, setSending] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const next = {}
    if (form.subject.trim().length < 3) next.subject = 'Add a short subject.'
    if (form.message.trim().length < 10) next.message = 'Tell us a little more (10+ characters).'
    setErrors(next)
    if (Object.keys(next).length) return

    setSending(true)
    try {
      await supportService.submit({
        subject: form.subject.trim(),
        message: form.message.trim(),
        booking_id: form.bookingId.trim() || undefined,
      })
      toast.success('Message sent. Our team will get back to you.')
      setForm({ subject: '', message: '', bookingId: '' })
      refetch()
    } catch (caught) {
      setErrors({ message: caught.message })
    } finally {
      setSending(false)
    }
  }

  const phone = contact?.support_phone || brand.supportPhone
  const email = contact?.support_email || brand.supportEmail

  return (
    <div className="space-y-5">
      <PageHeader title="Support" description="We are here if something needs sorting." />

      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href={`tel:${phone}`}
          className="flex items-center gap-3 rounded-card border border-ink-200 bg-white p-4 shadow-card transition-colors hover:border-ink-300"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <IconPhone className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900">Call us</p>
            <p className="truncate text-sm text-ink-500">{formatPhone(phone)}</p>
          </div>
        </a>
        <a
          href={`mailto:${email}`}
          className="flex items-center gap-3 rounded-card border border-ink-200 bg-white p-4 shadow-card transition-colors hover:border-ink-300"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <IconSupport className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900">Email us</p>
            <p className="truncate text-sm text-ink-500">{email}</p>
          </div>
        </a>
      </div>

      {contact?.working_hours && (
        <Alert tone="neutral">
          Available {contact.working_hours}
          {contact.address ? ` · ${contact.address}` : ''}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Send us a message"
            description="We reply by phone or email, usually the same day."
          />
          <CardBody>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field label="Subject" htmlFor="subject" error={errors.subject} required>
                <Input
                  id="subject"
                  maxLength={120}
                  placeholder="Invoice for last trip"
                  value={form.subject}
                  invalid={Boolean(errors.subject)}
                  onChange={(event) => setForm({ ...form, subject: event.target.value })}
                />
              </Field>
              <Field label="Booking ID" htmlFor="bookingId" optionalLabel>
                <Input
                  id="bookingId"
                  placeholder="LR-20260801-0001"
                  className="font-mono"
                  value={form.bookingId}
                  onChange={(event) => setForm({ ...form, bookingId: event.target.value })}
                />
              </Field>
              <Field label="Message" htmlFor="message" error={errors.message} required>
                <Textarea
                  id="message"
                  rows={5}
                  maxLength={2000}
                  placeholder="Tell us what you need…"
                  value={form.message}
                  invalid={Boolean(errors.message)}
                  onChange={(event) => setForm({ ...form, message: event.target.value })}
                />
              </Field>
              <Button type="submit" loading={sending}>
                Send message
              </Button>
            </form>
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Common questions" />
            <CardBody className="divide-y divide-ink-100">
              {FAQS.map((faq) => (
                <details key={faq.question} className="group py-3 first:pt-0 last:pb-0">
                  <summary className="cursor-pointer list-none text-sm font-medium text-ink-900 marker:hidden">
                    <span className="flex items-center justify-between gap-3">
                      {faq.question}
                      <svg
                        className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="m4 6 4 4 4-4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">{faq.answer}</p>
                </details>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Your messages" />
            <CardBody>
              {loading ? (
                <SkeletonList count={2} lines={2} />
              ) : !requests?.items?.length ? (
                <EmptyState
                  compact
                  icon={<IconInbox />}
                  title="No messages yet"
                  description="Anything you send us will be listed here."
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {requests.items.map((item) => (
                    <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-ink-900">{item.subject}</p>
                        <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-ink-600">
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-ink-600">{item.message}</p>
                      <p className="mt-1 text-xs text-ink-400">
                        {formatDateTime(item.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
