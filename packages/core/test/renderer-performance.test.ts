import { describe, expect, it } from 'vitest'
import { createAuthenticatedMediaCache } from '../src/renderer'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('authenticated media cache', () => {
  it('shares one in-flight fetch for concurrent loads of the same asset', async () => {
    const request = deferred<Blob>()
    let loads = 0
    const created: string[] = []
    const cache = createAuthenticatedMediaCache({
      createObjectUrl: () => { const url = `blob:test-${created.length}`; created.push(url); return url },
    })
    const loader = () => { loads += 1; return request.promise }

    const first = cache.load('session-a\0hero.png', loader)
    const second = cache.load('session-a\0hero.png', loader)
    expect(loads).toBe(1)
    request.resolve(new Blob(['image']))
    await expect(Promise.all([first, second])).resolves.toEqual(['blob:test-0', 'blob:test-0'])
    expect(created).toHaveLength(1)

    cache.release('session-a\0hero.png')
    cache.release('session-a\0hero.png')
    expect(cache.size).toBe(1)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('evicts failures so a later load can retry', async () => {
    let loads = 0
    const cache = createAuthenticatedMediaCache()
    const loader = () => { loads += 1; return Promise.reject(new Error('temporary failure')) }

    await expect(cache.load('session-a\0broken.png', loader)).rejects.toThrow('temporary failure')
    expect(cache.size).toBe(0)
    await expect(cache.load('session-a\0broken.png', loader)).rejects.toThrow('temporary failure')
    expect(loads).toBe(2)
  })

  it('clears session data and revokes URLs, including URLs created after an in-flight clear', async () => {
    const request = deferred<Blob>()
    const revoked: string[] = []
    const cache = createAuthenticatedMediaCache({
      createObjectUrl: () => 'blob:session-a',
      revokeObjectUrl: (url) => revoked.push(url),
    })
    const pending = cache.load('session-a\0logo.png', () => request.promise)
    cache.clear()
    expect(cache.size).toBe(0)
    request.resolve(new Blob(['logo']))
    await expect(pending).resolves.toBe('blob:session-a')
    expect(revoked).toEqual(['blob:session-a'])
    expect(cache.isCurrent('session-a\0logo.png', 'blob:session-a')).toBe(false)

    const current = cache.load('session-b\0logo.png', () => Promise.resolve(new Blob(['new logo'])))
    await expect(current).resolves.toBe('blob:session-a')
    cache.clear()
    expect(revoked).toEqual(['blob:session-a', 'blob:session-a'])
    expect(cache.size).toBe(0)
  })

  it('limits retained idle URLs while keeping active media alive', async () => {
    const revoked: string[] = []
    let serial = 0
    const cache = createAuthenticatedMediaCache({
      maxIdleEntries: 1,
      createObjectUrl: () => `blob:asset-${++serial}`,
      revokeObjectUrl: (url) => revoked.push(url),
    })
    const first = await cache.load('session-a\0first.png', () => Promise.resolve(new Blob(['first'])))
    const second = await cache.load('session-a\0second.png', () => Promise.resolve(new Blob(['second'])))
    expect(cache.size).toBe(2)
    expect(revoked).toEqual([])

    cache.release('session-a\0first.png')
    expect(cache.isCurrent('session-a\0first.png', first)).toBe(true)
    cache.release('session-a\0second.png')
    expect(cache.size).toBe(1)
    expect(cache.isCurrent('session-a\0first.png', first)).toBe(false)
    expect(cache.isCurrent('session-a\0second.png', second)).toBe(true)
    expect(revoked).toEqual([first])
  })
})
