/**
 * Thin fetch wrapper around the REST API.
 *
 * Responsibilities:
 *  - attach the in-memory access token
 *  - transparently refresh once on a 401 (using the httpOnly refresh cookie)
 *  - normalise every failure into an `ApiError` with a user-safe message
 *
 * The access token is deliberately held in module scope rather than
 * localStorage so it is not readable by injected scripts. It is restored on
 * page load by calling the refresh endpoint.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

let accessToken = null
let onUnauthenticated = () => {}
let refreshInFlight = null

export class ApiError extends Error {
  constructor(message, { status, code, fields } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields || null
  }

  /** Field-level messages for form rendering, keyed by field name. */
  get fieldErrors() {
    return this.fields || {}
  }
}

export function setAccessToken(token) {
  accessToken = token || null
}

export function getAccessToken() {
  return accessToken
}

export function setUnauthenticatedHandler(handler) {
  onUnauthenticated = typeof handler === 'function' ? handler : () => {}
}

function buildUrl(path, params) {
  const url = `${BASE_URL}${path}`
  if (!params) return url
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.append(key, String(value))
  })
  const query = search.toString()
  return query ? `${url}?${query}` : url
}

async function parseBody(response) {
  const type = response.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    const text = await response.text().catch(() => '')
    return text ? { detail: text } : null
  }
  return response.json().catch(() => null)
}

async function refreshAccessToken() {
  // Collapse concurrent 401s into a single refresh request.
  if (!refreshInFlight) {
    refreshInFlight = fetch(buildUrl('/api/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return null
        const body = await parseBody(response)
        if (body?.access_token) {
          accessToken = body.access_token
          return body
        }
        return null
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

async function performRequest(method, path, { body, params, signal, retry = true } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let response
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      credentials: 'include',
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError(
      'Cannot reach the server. Check your connection and try again.',
      { status: 0, code: 'network_error' },
    )
  }

  if (response.status === 401 && retry && !path.startsWith('/api/auth/')) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      return performRequest(method, path, { body, params, signal, retry: false })
    }
    accessToken = null
    onUnauthenticated()
  }

  if (response.status === 204) return null

  const payload = await parseBody(response)
  if (!response.ok) {
    throw new ApiError(payload?.detail || 'Something went wrong. Please try again.', {
      status: response.status,
      code: payload?.code,
      fields: payload?.fields,
    })
  }
  return payload
}

export const api = {
  get: (path, options) => performRequest('GET', path, options),
  post: (path, body, options) => performRequest('POST', path, { ...options, body }),
  put: (path, body, options) => performRequest('PUT', path, { ...options, body }),
  patch: (path, body, options) => performRequest('PATCH', path, { ...options, body }),
  delete: (path, options) => performRequest('DELETE', path, options),
  refresh: refreshAccessToken,
}

export default api
