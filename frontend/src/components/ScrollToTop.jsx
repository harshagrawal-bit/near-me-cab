import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Resets scroll on route change.
 *
 * React Router keeps the scroll offset across same-document navigations, so
 * without this a customer who submits a form from the bottom of a long page
 * lands halfway down the next screen. Anchored links (#hash) are left alone.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) return
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash])

  return null
}
