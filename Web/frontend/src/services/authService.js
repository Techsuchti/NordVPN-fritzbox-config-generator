const REQUEST_TIMEOUT_MS = 10_000

async function request(endpoint, options = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const headers = new Headers(options.headers)
    if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await fetch(endpoint, { ...options, headers, signal: controller.signal })
    let payload = null
    if (response.status !== 204) { try { payload = await response.json() } catch {} }
    if (!response.ok) { const error = new Error(payload?.error || `HTTP ${response.status}`); error.status = response.status; throw error }
    return payload
  } finally { clearTimeout(timeoutId) }
}

export const authApi = {
  status: () => request('/local-api/auth/status'),
  register: (username, password) => request('/local-api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username, password) => request('/local-api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/local-api/auth/logout', { method: 'POST' }),
  profile: () => request('/local-api/profile'),
  saveToken: token => request('/local-api/profile/token', { method: 'PUT', body: JSON.stringify({ token }) }),
  deleteToken: () => request('/local-api/profile/token', { method: 'DELETE' }),
}
