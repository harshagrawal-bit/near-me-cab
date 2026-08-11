import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { cn } from '@/lib/cn'
import { initials } from '@/lib/format'
import { IconLogout, IconUser } from '@/components/ui/Icons'
import { ConfirmDialog } from '@/components/ui/Modal'

export default function UserMenu({ profilePath }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await logout()
      navigate('/login', { replace: true })
    } finally {
      setSigningOut(false)
      setConfirmOpen(false)
    }
  }

  if (!user) return null

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-ink-100"
          aria-expanded={open}
          aria-label="Account menu"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {initials(user.name)}
          </span>
          <span className="hidden max-w-[9rem] truncate text-sm font-medium text-ink-800 sm:block">
            {user.name}
          </span>
        </button>

        {open && (
          <div className="absolute right-0 z-40 mt-2 w-56 animate-slide-up overflow-hidden rounded-card border border-ink-200 bg-white shadow-overlay">
            <div className="border-b border-ink-100 px-4 py-3">
              <p className="truncate text-sm font-semibold text-ink-900">{user.name}</p>
              <p className="truncate text-xs text-ink-500">{user.email}</p>
              <p className="mt-1.5 inline-flex rounded-full bg-ink-100 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-ink-600">
                {user.role}
              </p>
            </div>
            <div className="p-1">
              {profilePath && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    navigate(profilePath)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-700',
                    'hover:bg-ink-100',
                  )}
                >
                  <IconUser className="h-4 w-4" />
                  My profile
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setConfirmOpen(true)
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-danger-700 hover:bg-danger-50"
              >
                <IconLogout className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleSignOut}
        loading={signingOut}
        title="Sign out?"
        message="You will need to sign in again to access your account."
        confirmLabel="Sign out"
        tone="danger"
      />
    </>
  )
}
