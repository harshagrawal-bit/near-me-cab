import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Data-fetching hook with the four states every screen needs:
 * loading, data, error and a retry.
 *
 * Deliberately small — TanStack Query is available for caching-heavy screens,
 * but most pages here are simple reads and benefit from staying explicit.
 */
export function useApi(fetcher, deps = [], { enabled = true, initialData = null } = {}) {
  const [data, setData] = useState(initialData)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(enabled)
  const mounted = useRef(true)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return undefined
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetcherRef.current()
      if (mounted.current) setData(result)
      return result
    } catch (caught) {
      if (mounted.current) setError(caught)
      return undefined
    } finally {
      if (mounted.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  useEffect(() => {
    run()
  }, [run])

  return { data, error, loading, refetch: run, setData }
}

/**
 * Wraps a write operation with loading + error state, so buttons can show a
 * spinner and forms can surface field errors without bespoke plumbing.
 */
export function useMutation(mutator) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const mutate = useCallback(
    async (...args) => {
      setLoading(true)
      setError(null)
      try {
        return await mutator(...args)
      } catch (caught) {
        if (mounted.current) setError(caught)
        throw caught
      } finally {
        if (mounted.current) setLoading(false)
      }
    },
    [mutator],
  )

  return { mutate, loading, error, reset: () => setError(null) }
}

/** Debounces a rapidly-changing value (search boxes, autocomplete). */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Page/filter state for list screens, resetting to page 1 when filters change. */
export function useListState(initialFilters = {}, pageSize = 20) {
  const [page, setPage] = useState(1)
  const [filters, setFiltersState] = useState(initialFilters)

  const setFilters = useCallback((update) => {
    setFiltersState((current) =>
      typeof update === 'function' ? update(current) : { ...current, ...update },
    )
    setPage(1)
  }, [])

  const resetFilters = useCallback(() => {
    setFiltersState(initialFilters)
    setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const params = { page, page_size: pageSize, ...filters }

  return { page, setPage, filters, setFilters, resetFilters, params, pageSize }
}
