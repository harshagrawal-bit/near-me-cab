/**
 * Inline icon set — no icon library dependency, no network fetch.
 * All icons share a 24×24 viewBox and inherit `currentColor`.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
}

const make = (paths) =>
  function Icon({ className = 'h-5 w-5', ...props }) {
    return (
      <svg className={className} {...base} {...props}>
        {paths}
      </svg>
    )
  }

export const IconHome = make(<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1v-8.5Z" />)
export const IconCar = make(
  <>
    <path d="M4 16v2.5M20 16v2.5M3 15.5h18M5.5 15.5 7 9.5a1.5 1.5 0 0 1 1.45-1.1h7.1A1.5 1.5 0 0 1 17 9.5l1.5 6" />
    <path d="M3 15.5A1.5 1.5 0 0 1 4.5 14h15a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-1Z" />
  </>,
)
export const IconTicket = make(
  <>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2 2 0 0 0 0 3v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 15.5v-2a2 2 0 0 0 0-3v-2Z" />
    <path d="M13 7v10" strokeDasharray="2 2.5" />
  </>,
)
export const IconUser = make(
  <>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5c.8-3.2 3.6-5 7-5s6.2 1.8 7 5" />
  </>,
)
export const IconUsers = make(
  <>
    <circle cx="9.5" cy="8.5" r="3" />
    <path d="M3.5 19c.7-2.8 3.1-4.5 6-4.5s5.3 1.7 6 4.5" />
    <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 14.8c1.7.7 2.8 2.1 3.2 4.2" />
  </>,
)
export const IconSupport = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1v.5" />
    <path d="M12 16.6v.1" strokeWidth="2" />
  </>,
)
export const IconBell = make(
  <>
    <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3 .7 4.6 1.5 5.5H5c.8-.9 1.5-2.5 1.5-5.5Z" />
    <path d="M10 18.5a2 2 0 0 0 4 0" />
  </>,
)
export const IconWallet = make(
  <>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H18a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 17V8.5Z" />
    <path d="M4 10h11.5A1.5 1.5 0 0 1 17 11.5v2a1.5 1.5 0 0 1-1.5 1.5H4" />
  </>,
)
export const IconChart = make(
  <>
    <path d="M4 20V5M4 20h16" />
    <path d="M8 16.5v-4M12 16.5v-7M16 16.5v-3" strokeWidth="2" />
  </>,
)
export const IconRoute = make(
  <>
    <circle cx="6.5" cy="6.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
    <path d="M9 6.5h5A3.5 3.5 0 0 1 14 13.5h-4a3.5 3.5 0 0 0 0 4h5" />
  </>,
)
export const IconTag = make(
  <>
    <path d="M4 11.2V5.5A1.5 1.5 0 0 1 5.5 4h5.7a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-5.2 5.2a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1-.6-1.4Z" />
    <circle cx="8.5" cy="8.5" r="1.25" fill="currentColor" stroke="none" />
  </>,
)
export const IconStar = make(
  <path d="m12 4.5 2.3 4.8 5.2.7-3.8 3.6.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.5 10l5.2-.7L12 4.5Z" />,
)

/** Solid variant — an outline-only star makes 5★ and 1★ look alike. */
export function IconStarFilled({ className = 'h-5 w-5', ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="m12 3.9 2.5 5.1 5.6.8-4.05 3.95.95 5.6L12 16.7l-5 2.65.95-5.6L3.9 9.8l5.6-.8L12 3.9Z" />
    </svg>
  )
}
export const IconSettings = make(
  <>
    <circle cx="12" cy="12" r="2.75" />
    <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6" />
  </>,
)
export const IconClipboard = make(
  <>
    <path d="M9 5H7.5A1.5 1.5 0 0 0 6 6.5v12A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 16.5 5H15" />
    <rect x="9" y="3.5" width="6" height="3" rx="1" />
    <path d="M9 11h6M9 14.5h4" />
  </>,
)
export const IconClock = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </>,
)
export const IconPin = make(
  <>
    <path d="M12 21c4-4.4 6-7.6 6-10a6 6 0 1 0-12 0c0 2.4 2 5.6 6 10Z" />
    <circle cx="12" cy="11" r="2.25" />
  </>,
)
export const IconPhone = make(
  <path d="M6.5 4h3l1.5 3.8-2 1.3a11 11 0 0 0 5.9 5.9l1.3-2L20 14.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4Z" />,
)
export const IconLogout = make(
  <>
    <path d="M14 6.5V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h6A1.5 1.5 0 0 0 14 19v-1.5" />
    <path d="M10 12h10m0 0-3-3m3 3-3 3" />
  </>,
)
export const IconMenu = make(<path d="M4 7h16M4 12h16M4 17h16" strokeWidth="2" />)
export const IconClose = make(<path d="M6 6l12 12M18 6 6 18" strokeWidth="2" />)
export const IconChevronRight = make(<path d="m9.5 6 6 6-6 6" strokeWidth="2" />)
export const IconChevronLeft = make(<path d="m14.5 6-6 6 6 6" strokeWidth="2" />)
export const IconArrowRight = make(<path d="M4.5 12h15m0 0-5.5-5.5M19.5 12 14 17.5" />)
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" strokeWidth="2" />
  </>,
)
export const IconPlus = make(<path d="M12 5v14M5 12h14" strokeWidth="2" />)
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7" strokeWidth="2" />)
export const IconFilter = make(<path d="M4 6h16l-6.2 7.3V19l-3.6-1.8v-3.9L4 6Z" />)
export const IconDownload = make(
  <>
    <path d="M12 4v10m0 0 4-4m-4 4-4-4" />
    <path d="M4.5 17.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
  </>,
)
export const IconEdit = make(
  <>
    <path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5l-1 3Z" />
    <path d="M14.5 7.5 17.5 10.5" />
  </>,
)
export const IconTrash = make(
  <>
    <path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" />
    <path d="M6.5 7 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
  </>,
)
export const IconDocument = make(
  <>
    <path d="M13 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V8.5L13 3.5Z" />
    <path d="M13 3.5V8a.5.5 0 0 0 .5.5H18" />
  </>,
)
export const IconInbox = make(
  <>
    <path d="M4 13.5 6.2 6a1.5 1.5 0 0 1 1.45-1H16.35A1.5 1.5 0 0 1 17.8 6L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-4.5Z" />
    <path d="M4 13.5h4l1 2.5h6l1-2.5h4" />
  </>,
)
export const IconPower = make(
  <>
    <path d="M12 4v8" strokeWidth="2" />
    <path d="M7.5 7a7 7 0 1 0 9 0" />
  </>,
)
