import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { setAccessToken, setUnauthenticatedHandler } from '@/services/apiClient'
import { authService, userService } from '@/services'
import { ROLES } from '@/lib/constants'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [driverProfile, setDriverProfile] = useState(null)
  // `initialising` covers the silent refresh on first paint, so guarded routes
  // do not flash the sign-in screen for an already-signed-in user.
  const [initialising, setInitialising] = useState(true)

  const applySession = useCallback((session) => {
    setAccessToken(session.access_token)
    setUser(session.user)
    return session.user
  }, [])

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setUser(null)
    setDriverProfile(null)
  }, [])

  const loadProfile = useCallback(async () => {
    const profile = await userService.me()
    setUser(profile.user)
    setDriverProfile(profile.driver || null)
    return profile
  }, [])

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setUser(null)
      setDriverProfile(null)
    })
  }, [])

  // Restore the session from the httpOnly refresh cookie on page load.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const session = await authService.refresh()
        if (cancelled || !session?.access_token) return
        applySession(session)
        await loadProfile()
      } catch {
        // No valid refresh cookie — visitor is simply signed out.
      } finally {
        if (!cancelled) setInitialising(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applySession, loadProfile])

  const login = useCallback(
    async (credentials) => {
      const session = await authService.login(credentials)
      const signedIn = applySession(session)
      if (signedIn.role === ROLES.DRIVER) {
        const profile = await loadProfile()
        return profile.user
      }
      return signedIn
    },
    [applySession, loadProfile],
  )

  const register = useCallback(
    async (payload) => applySession(await authService.register(payload)),
    [applySession],
  )

  const registerDriver = useCallback(
    async (payload) => {
      applySession(await authService.driverSignup(payload))
      // A driver's workspace needs the driver record, not just the user.
      const profile = await loadProfile()
      return profile.user
    },
    [applySession, loadProfile],
  )

  /** Adopt a session minted elsewhere — currently the Google sign-in button. */
  const adoptSession = useCallback(
    async (session) => {
      const signedIn = applySession(session)
      if (signedIn.role === ROLES.DRIVER) {
        const profile = await loadProfile()
        return profile.user
      }
      return signedIn
    },
    [applySession, loadProfile],
  )

  const logout = useCallback(async () => {
    try {
      await authService.logout()
    } finally {
      clearSession()
    }
  }, [clearSession])

  const updateUser = useCallback((patch) => {
    setUser((current) => (current ? { ...current, ...patch } : current))
  }, [])

  const value = useMemo(
    () => ({
      user,
      driverProfile,
      setDriverProfile,
      initialising,
      isAuthenticated: Boolean(user),
      role: user?.role || null,
      isCustomer: user?.role === ROLES.CUSTOMER,
      isDriver: user?.role === ROLES.DRIVER,
      isAdmin: user?.role === ROLES.ADMIN,
      login,
      register,
      registerDriver,
      adoptSession,
      logout,
      updateUser,
      reloadProfile: loadProfile,
    }),
    [
      user,
      driverProfile,
      initialising,
      login,
      register,
      registerDriver,
      adoptSession,
      logout,
      updateUser,
      loadProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an AuthProvider')
  return context
}

/** Where each role lands after signing in. */
export function homePathFor(role) {
  if (role === ROLES.ADMIN) return '/admin'
  if (role === ROLES.DRIVER) return '/driver'
  return '/app'
}
