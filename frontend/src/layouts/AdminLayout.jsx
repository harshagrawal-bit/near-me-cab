import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/cn'
import Logo from '@/components/brand/Logo'
import NotificationBell from '@/components/shared/NotificationBell'
import UserMenu from '@/components/shared/UserMenu'
import {
  IconCar,
  IconChart,
  IconClipboard,
  IconClose,
  IconHome,
  IconMenu,
  IconRoute,
  IconSettings,
  IconStar,
  IconSupport,
  IconTag,
  IconTicket,
  IconUsers,
  IconWallet,
} from '@/components/ui/Icons'

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: IconHome, end: true },
  { to: '/admin/bookings', label: 'Bookings', icon: IconTicket },
  { to: '/admin/drivers', label: 'Drivers', icon: IconUsers },
  { to: '/admin/driver-wallets', label: 'Driver wallets', icon: IconWallet },
  { to: '/admin/customers', label: 'Customers', icon: IconUsers },
  { to: '/admin/vehicles', label: 'Vehicles', icon: IconCar },
  { to: '/admin/routes', label: 'Routes', icon: IconRoute },
  { to: '/admin/pricing', label: 'Pricing', icon: IconClipboard },
  { to: '/admin/payments', label: 'Payments', icon: IconWallet },
  { to: '/admin/offers', label: 'Offers', icon: IconTag },
  { to: '/admin/reviews', label: 'Reviews', icon: IconStar },
  { to: '/admin/reports', label: 'Reports', icon: IconChart },
  { to: '/admin/support', label: 'Support', icon: IconSupport },
  { to: '/admin/settings', label: 'Settings', icon: IconSettings },
]

/** Desktop-first admin shell with a slide-over drawer on tablet and below. */
export default function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  const navItems = (
    <nav className="space-y-0.5" aria-label="Admin sections">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-ink-800 text-white'
                : 'text-ink-300 hover:bg-ink-800/60 hover:text-white',
            )
          }
        >
          <item.icon className="h-[18px] w-[18px]" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Fixed sidebar — desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-ink-900 lg:flex">
        <div className="flex h-14 items-center border-b border-ink-800 px-4">
          <Logo to="/admin" invert />
        </div>
        <div className="scrollbar-slim flex-1 overflow-y-auto p-3">{navItems}</div>
        <div className="border-t border-ink-800 px-4 py-3">
          <p className="text-2xs uppercase tracking-wide text-ink-500">Operations Console</p>
        </div>
      </aside>

      {/* Slide-over drawer — tablet and mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-ink-950/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex h-full w-64 animate-slide-up flex-col bg-ink-900">
            <div className="flex h-14 items-center justify-between border-b border-ink-800 px-4">
              <Logo to="/admin" invert />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-800 hover:text-white"
                aria-label="Close navigation"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>
            <div className="scrollbar-slim flex-1 overflow-y-auto p-3">{navItems}</div>
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-ink-200 bg-white/95 backdrop-blur">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden"
                aria-label="Open navigation"
              >
                <IconMenu />
              </button>
              <span className="text-sm font-medium text-ink-500 lg:hidden">Admin</span>
            </div>
            <div className="flex items-center gap-1">
              <NotificationBell />
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
