import { useApi } from '@/hooks/useApi'
import { Link } from 'react-router-dom'
import { brand } from '@/config/brand'
import { LogoMark } from '@/components/brand/Logo'
import { Card, CardBody } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { SkeletonCard } from '@/components/ui/Loaders'
import { IconChevronLeft } from '@/components/ui/Icons'

/**
 * One component for every policy page.
 *
 * The content comes from the API rather than living here, because the numbers
 * in it — the cancellation fee, the wallet floor, the advance percentage — are
 * the same settings the booking and wallet code read. A policy page that
 * quotes a fee the engine does not charge is worse than no page at all.
 */
export default function PolicyPage({ fetcher }) {
  const { data, loading, error, refetch } = useApi(fetcher, [])

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3.5 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2 text-ink-900 transition hover:opacity-80"
          >
            <IconChevronLeft className="h-4 w-4 text-ink-400" />
            <LogoMark className="h-7" />
            <span className="font-semibold">{brand.name}</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        {loading && <SkeletonCard lines={12} />}
        {error && (
          <ErrorState title="Could not load this page" error={error} onRetry={refetch} />
        )}

        {data && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
                {data.title}
              </h1>
              <p className="mt-1.5 text-ink-600">{data.subtitle}</p>
              <p className="mt-3 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                Last updated: {data.updated}
              </p>
            </div>

            <Card>
              <CardBody className="space-y-7">
                {data.sections.map((section) => (
                  <section key={section.heading}>
                    <h2 className="text-base font-semibold text-ink-900">{section.heading}</h2>
                    <ul className="mt-2.5 space-y-2">
                      {section.body.map((line, index) => (
                        <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-ink-600">
                          <span
                            aria-hidden="true"
                            className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                          />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </CardBody>
            </Card>

            <div className="mt-6 flex flex-wrap gap-4 text-sm">
              <Link to="/privacy" className="font-medium text-brand-700 hover:underline">
                Privacy Policy
              </Link>
              <Link to="/terms" className="font-medium text-brand-700 hover:underline">
                Terms of Service
              </Link>
              <Link to="/driver-terms" className="font-medium text-brand-700 hover:underline">
                Driver Agreement
              </Link>
            </div>

            <p className="mt-6 text-xs text-ink-400">
              Questions? {brand.supportEmail}
            </p>
          </>
        )}
      </main>
    </div>
  )
}
