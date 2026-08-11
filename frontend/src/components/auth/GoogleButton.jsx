import { useEffect, useRef, useState } from 'react'
import { authService } from '@/services'

const GSI_SRC = 'https://accounts.google.com/gsi/client'
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

/** Load Google Identity Services once, no matter how many buttons mount. */
let scriptPromise = null
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.defer = true
    script.onload = resolve
    script.onerror = () => reject(new Error('Could not reach Google.'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * "Sign in with Google".
 *
 * Renders nothing at all unless a client id is configured *and* the server
 * reports Google sign-in as available — a button that cannot possibly work is
 * worse than no button. The token Google returns goes straight to our own
 * backend, which verifies its signature; the browser never decides who you are.
 */
export default function GoogleButton({ onSuccess, onError, text = 'signin_with' }) {
  const holder = useRef(null)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!CLIENT_ID) return undefined

    authService
      .providers()
      .then((result) => {
        if (!cancelled) setEnabled(Boolean(result?.google))
      })
      .catch(() => {
        // A server that cannot answer is a server that cannot verify the
        // token either, so stay hidden rather than showing a dead button.
        if (!cancelled) setEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!enabled || !holder.current) return undefined
    let cancelled = false

    loadGsi()
      .then(() => {
        if (cancelled || !holder.current) return
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async (response) => {
            try {
              const session = await authService.google(response.credential)
              onSuccess?.(session)
            } catch (caught) {
              onError?.(caught)
            }
          },
        })
        window.google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          width: holder.current.offsetWidth || 320,
        })
      })
      .catch((caught) => onError?.(caught))

    return () => {
      cancelled = true
    }
  }, [enabled, text, onSuccess, onError])

  if (!CLIENT_ID || !enabled) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-ink-200" />
        <span className="text-xs font-medium uppercase tracking-wide text-ink-400">or</span>
        <span className="h-px flex-1 bg-ink-200" />
      </div>
      <div ref={holder} className="flex justify-center [&>div]:w-full" />
    </div>
  )
}
