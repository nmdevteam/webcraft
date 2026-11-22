import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiAllDocs } from '../src/api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('apiAllDocs', () => {
  it('loads every page returned by Payload pagination metadata', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ docs: [{ id: 1 }], totalPages: 3 }))
      .mockResolvedValueOnce(jsonResponse({ docs: [{ id: 2 }] }))
      .mockResolvedValueOnce(jsonResponse({ docs: [{ id: 3 }] }))
    vi.stubGlobal('sessionStorage', { getItem: () => null })
    vi.stubGlobal('fetch', fetchMock)

    const docs = await apiAllDocs<{ id: number }>('/pages?limit=1&depth=0')

    expect(docs).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/pages?limit=1&depth=0&page=1',
      '/api/pages?limit=1&depth=0&page=2',
      '/api/pages?limit=1&depth=0&page=3',
    ])
  })

  it('rejects a full page when pagination metadata is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ docs: Array.from({ length: 100 }, (_, id) => ({ id })) }))
    vi.stubGlobal('sessionStorage', { getItem: () => null })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiAllDocs('/assets?limit=100')).rejects.toThrow(/pagination metadata/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects unreasonable pagination totals instead of issuing unbounded requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ docs: [], totalPages: 1001 }))
    vi.stubGlobal('sessionStorage', { getItem: () => null })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiAllDocs('/projects?limit=100')).rejects.toThrow(/too large/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
