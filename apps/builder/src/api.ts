export type User = { id: string | number; email: string; name?: string }
export type ApiError = Error & { status?: number }

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = sessionStorage.getItem('webcraft-session')
  if (token) headers.set('Authorization', `JWT ${token}`)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path.startsWith('/api') ? path : `/api${path}`, { ...init, headers, cache: 'no-store' })
  const contentType = response.headers.get('content-type') ?? ''
  const result = contentType.includes('application/json') ? await response.json().catch(() => ({})) : await response.text().catch(() => '')
  if (!response.ok) {
    const message = typeof result?.errors?.[0]?.message === 'string' ? result.errors[0].message : typeof result?.error === 'string' ? result.error : `Request failed (${response.status})`
    const error = new Error(message) as ApiError
    error.status = response.status
    throw error
  }
  return result as T
}
export async function apiDoc<T>(path: string, init: RequestInit = {}): Promise<T> {
  const result = await api<T | { doc: T }>(path, init)
  return result && typeof result === 'object' && 'doc' in result ? result.doc : result as T
}
export function jsonBody(value: unknown) { return JSON.stringify(value) }
export function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value))
  return params.toString()
}
