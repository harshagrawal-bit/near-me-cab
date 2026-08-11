import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { useAuth } from '@/auth/AuthContext'
import Logo from '@/components/brand/Logo'
import NotificationBell from '@/components/shared/NotificationBell'
import UserMenu from '@/components/shared/UserMenu'
import {
  IconCar,
  IconDocument,
  IconHome,
  IconInbox,
  IconUser,
  IconWallet,
} from '@/components/ui/Icons'

/**
 * Two different jobs, two different navigations.
 *
 * A fleet owner hunts for work and manages a deposit. An employed driver just
 * drives what they are given — showing them a wallet they do not hold or trips
 * they cannot accept would be noise. Capped at five either way: this is a
 * thumb-reachable bottom bar on a phone, not a desktop sidebar. Everything
 * else lives one tap deeper, on the profile page.
 */
const OWNER_NAV = [
  { to: '/driver', label: 'Home', icon: IconHome, end: true },
  { to: '/driver/open-trips', label: 'Open', icon: IconInbox },
  { to: '/driver/trips', label: 'Trips', icon: IconCar },
  { to: '/driver/wallet', label: 'Wallet', icon: IconWallet },
  { to: '/driver/profile', label: 'Profile', icon: IconUser },
]

const EMPLOYED_NAV = [
  { to: '/driver', label: 'Home', icon: IconHome, end: true },
  { to: '/driver/trips', label: 'Trips', icon: IconCar },
  { to: '/driver/earnings', label: 'Earnings', icon: IconWallet },
  { to: '/driver/documents', label: 'Documents', icon: IconDocument },
  { to: '/driver/profile', label: 'Profile', icon: IconUser },
]

/** Mobile-first driver shell — drivers work from a phone. */
export default function DriverLayout() {
  const { driverProfile } = useAuth()
  // Default to the owner navigation: a self-signed-up driver is an owner, and
  // the profile can still be loading on first paint.
  const NAV = driverProfile?.driver_type === 'employed' ? EMPLOYED_NAV : OWNER_NAV

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2.5">
            <Logo to="/driver" />
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-ink-600">
              Driver
            </span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <UserMenu profilePath="/driver/profile" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-5 sm:pb-10">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
        aria-label="Primary"
      >
        <div className="grid grid-cols-5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-2xs font-medium transition-colors',
                  isActive ? 'text-brand-700' : 'text-ink-500',
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Tablet/desktop secondary nav */}
      <nav className="hidden border-t border-ink-200 bg-white sm:block" aria-label="Primary">
        <div className="mx-auto flex max-w-3xl gap-1 px-4 py-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-ink-100 text-ink-900'
                    : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
