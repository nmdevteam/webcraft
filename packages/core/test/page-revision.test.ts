import { describe, expect, it } from 'vitest'
import { nextPageRevision, submittedPageRevision } from '../src/page-revision'

describe('page revision validation', () => {
  it('uses the original REST body rather than Payload-merged hook data', () => {
    expect(submittedPageRevision({ seoTitle: 'Missing token' }, 7)).toBeUndefined()
    expect(submittedPageRevision({ revision: 6 }, 7)).toBe(6)
    expect(submittedPageRevision(undefined, 7)).toBe(7)
    expect(submittedPageRevision([], 7)).toBe(7)
  })

  it('increments a matching revision', () => {
    expect(nextPageRevision(4, 4)).toEqual({ ok: true, nextRevision: 5 })
  })

  it('rejects missing, fractional, negative, or unsafe revisions as invalid input', () => {
    for (const value of [undefined, null, 1.5, -1, Number.MAX_SAFE_INTEGER + 1, '2']) {
      expect(nextPageRevision(value, 0)).toEqual({ ok: false, status: 400 })
    }
  })

  it('rejects stale metadata or content writes with conflict status', () => {
    expect(nextPageRevision(2, 3)).toEqual({ ok: false, status: 409 })
  })
})
