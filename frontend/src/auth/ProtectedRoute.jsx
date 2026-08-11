import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth, homePathFor } from './AuthContext'
import { FullPageLoader } from '@/components/ui/Loaders'

/**
 * Client-side route guard.
 *
 * This is a UX affordance, not a security boundary — every endpoint enforces
 * its own role check server-side. Bypassing this guard reveals an empty shell
 * and a 403 from the API.
 */
export default function ProtectedRoute({ allow }) {
  const { isAuthenticated, initialising, role } = useAuth()
  const location = useLocation()

  if (initialising) return <FullPageLoader label="Checking your session…" />

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (allow && !allow.includes(role)) {
    // Signed in, wrong area — send them to their own home rather than a
    // dead-end error page.
    return <Navigate to={homePathFor(role)} replace />
  }

  return <Outlet />
}
