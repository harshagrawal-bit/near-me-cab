import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/cn'
import Logo from '@/components/brand/Logo'
import NotificationBell from '@/components/shared/NotificationBell'
import UserMenu from '@/components/shared/UserMenu'
import { IconHome, IconSupport, IconTicket, IconUser } from '@/components/ui/Icons'
import { brand } from '@/config/brand'

const NAV = [
  { to: '/app', label: 'Book', icon: IconHome, end: true },
  { to: '/app/bookings', label: 'My Trips', icon: IconTicket },
  { to: '/app/support', label: 'Support', icon: IconSupport },
  { to: '/app/profile', label: 'Profile', icon: IconUser },
]

/** Mobile-first shell: sticky header, bottom tab bar on small screens. */
export default function CustomerLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Logo to="/app" />
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-ink-100 text-ink-900'
                      : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <UserMenu profilePath="/app/profile" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 md:pb-10">
        <Outlet />
      </main>

      {/* Bottom tab bar — primary navigation on mobile. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Primary"
      >
        <div className="grid grid-cols-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors',
                  isActive ? 'text-brand-700' : 'text-ink-500',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn('h-5 w-5', isActive && 'text-brand-700')} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <footer className="hidden border-t border-ink-200 bg-white py-5 md:block">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 text-sm text-ink-500">
          <p>
            © {new Date().getFullYear()} {brand.legalName}
          </p>
          <p>
            Support:{' '}
            <a className="text-brand-700 hover:underline" href={`tel:${brand.supportPhone}`}>
              {brand.supportPhone}
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
