import { Link } from 'react-router-dom'
import { brand } from '@/config/brand'
import { cn } from '@/lib/cn'

/**
 * Reusable brand mark. Reads everything from `@/config/brand`, so rebranding
 * is a one-file change — no component hard-codes the name.
 */
/**
 * The mark: a location pin carrying a car, with signal arcs.
 *
 * Drawn as inline SVG rather than shipped as a raster asset so it stays sharp
 * at every size, needs no network request, and can pick up theme colours. The
 * pin stays red in both themes — it is the brand — while the car flips with
 * `currentColor` so it reads on white and on near-black.
 */
export function LogoMark({ className, invert = false }) {
  return (
    <svg
      viewBox="0 0 44 46"
      fill="none"
      className={cn('h-8 w-auto shrink-0', invert ? 'text-white' : 'text-ink-900', className)}
      aria-hidden="true"
    >
      {/* Signal arcs, echoing the "near me" idea. */}
      <path
        d="M31.5 11a11.5 11.5 0 0 1 0 13"
        stroke="#d81f26"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M36.8 6.4a18.5 18.5 0 0 1 0 22.2"
        stroke="#d81f26"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* Pin outline. */}
      <path
        d="M15 43S28 28.6 28 17A13 13 0 1 0 2 17c0 11.4 13 26 13 26Z"
        stroke="#d81f26"
        strokeWidth="3.4"
        strokeLinejoin="round"
      />
      {/* Car, filled in the flipping colour. */}
      <path
        d="M8.4 20.4v-2.5l1.85-4.1a1.95 1.95 0 0 1 1.78-1.17h6.14c.77 0 1.47.46 1.78 1.17l1.85 4.1v2.5a.82.82 0 0 1-.82.82h-1.2a1.5 1.5 0 0 1-3 0h-3.36a1.5 1.5 0 0 1-3 0h-1.2a.82.82 0 0 1-.82-.82Z"
        fill="currentColor"
      />
    </svg>
  )
}

export default function Logo({ to = '/', className, showTagline = false, invert = false }) {
  const content = (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark invert={invert} />
      <span className="flex flex-col leading-none">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'text-[17px] font-semibold tracking-tight',
              invert ? 'text-white' : 'text-ink-900',
            )}
          >
            {brand.wordmark.lead}
          </span>
          {/* Reversed out of a red chip, matching the mark. Omitted entirely
              for a single-word brand rather than rendering an empty chip. */}
          {brand.wordmark.trail && (
            <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[13px] font-bold uppercase tracking-wide text-white">
              {brand.wordmark.trail}
            </span>
          )}
        </span>
        {showTagline && (
          <span
            className={cn('mt-1 text-xs', invert ? 'text-white/60' : 'text-ink-500')}
          >
            {brand.tagline}
          </span>
        )}
      </span>
    </span>
  )

  if (!to) return content
  return (
    <Link to={to} className="rounded-lg" aria-label={`${brand.name} home`}>
      {content}
    </Link>
  )
}
