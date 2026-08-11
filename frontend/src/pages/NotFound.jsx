import { Link } from 'react-router-dom'
import { homePathFor, useAuth } from '@/auth/AuthContext'
import Logo from '@/components/brand/Logo'
import Button from '@/components/ui/Button'

export default function NotFound() {
  const { isAuthenticated, role } = useAuth()
  const home = isAuthenticated ? homePathFor(role) : '/login'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-50 px-5 text-center">
      <Logo to={null} />
      <p className="mt-8 text-sm font-medium uppercase tracking-wide text-ink-400">Error 404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
        We could not find that page
      </h1>
      <p className="mt-2 max-w-sm text-sm text-ink-500">
        The link may be out of date, or the page may have moved.
      </p>
      <Link to={home} className="mt-6">
        <Button>Back to safety</Button>
      </Link>
    </div>
  )
}
