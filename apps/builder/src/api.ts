export type User = { id: string | number; email: string; name?: string }
export type ApiError = Error & { status?: number }
export const SESSION_CHANGED_EVENT = 'webcraft:session-change'

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = sessionStorage.getItem('webcraft-session')
  if (token) headers.set('Authorization', `JWT ${token}`)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(path.startsWith('/api') ? path : `/api${path}`, { ...init, headers, cache: 'no-store' })
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init)
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
export async function apiAllDocs<T>(path: string): Promise<T[]> {
  const pageUrl = (page: number) => `${path}${path.includes('?') ? '&' : '?'}page=${page}`
  const first = await api<{ docs: T[]; totalPages?: number }>(pageUrl(1))
  if (!Array.isArray(first.docs)) throw new Error('The server returned an invalid list response.')
  if (first.totalPages === undefined && first.docs.length >= 100) throw new Error('The server omitted pagination metadata; this list may be incomplete.')
  const totalPages = first.totalPages ?? 1
  if (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > 1000) throw new Error('This list is too large to load safely.')
  if (first.docs.length > 0 && totalPages === 0) throw new Error('The server returned inconsistent pagination metadata.')
  const docs = [...first.docs]
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await api<{ docs: T[] }>(pageUrl(page))
    if (!Array.isArray(next.docs)) throw new Error('The server returned an invalid list response.')
    docs.push(...next.docs)
  }
  return docs
}
export function jsonBody(value: unknown) { return JSON.stringify(value) }
export function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value))
  return params.toString()
}
