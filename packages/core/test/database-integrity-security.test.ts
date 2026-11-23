import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ validatePwaIconDimensions: vi.fn() }))

vi.mock('../../../apps/cms/src/lib/pwa-icons', () => ({ validatePwaIconDimensions: mocks.validatePwaIconDimensions }))

import { Projects } from '../../../apps/cms/src/collections/Projects'
import { databaseConflictResponse } from '../../../apps/cms/src/lib/database-conflicts'
import { up as migrateIntegrity } from '../../../apps/cms/src/migrations/20261123_070000_integrity_guarantees'

describe('database conflict responses', () => {
  it('maps only known unique constraints and the revision guard to safe conflict messages', () => {
    expect(databaseConflictResponse({ code: '40001', message: 'WEBCRAFT_PAGE_REVISION_CONFLICT' })).toEqual({
      status: 409,
      message: 'Revision conflict: another save completed first. Reload this page before saving again.',
    })
    expect(databaseConflictResponse({ code: '23505', constraint: 'webcraft_pages_project_slug_uidx' })).toEqual({
      status: 409,
      message: 'A page with this URL slug already exists in the project.',
    })
    expect(databaseConflictResponse({ code: '23505', constraint: 'private_table_secret_uidx' })).toBeUndefined()
    expect(databaseConflictResponse({ code: '40001', message: 'unrelated serialization failure' })).toBeUndefined()
    expect(databaseConflictResponse({ code: '23503', constraint: 'pages_project_id_fkey' })).toBeUndefined()
  })

  it('finds supported PostgreSQL errors through a bounded cause chain', () => {
    const error = Object.assign(new Error('adapter wrapper'), { cause: Object.assign(new Error('conflict'), { code: '23505', constraint: 'webcraft_asset_folders_project_name_ci_uidx' }) })
    expect(databaseConflictResponse(error)).toEqual({
      status: 409,
      message: 'A folder with this name already exists in the project (folder names are case-insensitive).',
    })
  })
})

describe('project PWA icon ownership checks', () => {
  beforeEach(() => mocks.validatePwaIconDimensions.mockReset())

  it('queries only icon records owned by this project and owner, then validates the selected dimensions', async () => {
    const docs = [{ filename: 'small.png' }]
    const find = vi.fn(async () => ({ docs }))
    const req = { user: { id: 'owner-1' }, transactionID: 'txn-9', payload: { find } }
    const data = { settings: { pwa: { enabled: true, icon192Path: '/media/small.png' } } }
    const hook = (Projects.hooks?.beforeChange as any[])?.[0]

    await hook({ data, req, operation: 'update', originalDoc: { id: 'project-1', owner: 'owner-1' } })

    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'assets',
      where: { and: [
        { project: { equals: 'project-1' } },
        { owner: { equals: 'owner-1' } },
        { filename: { in: ['small.png'] } },
      ] },
      limit: 2,
      depth: 0,
      select: { filename: true },
      user: req.user,
      overrideAccess: false,
      req: { transactionID: 'txn-9' },
    }))
    expect(mocks.validatePwaIconDimensions).toHaveBeenCalledWith(data.settings.pwa, docs)
  })

  it('rejects a new-project icon path before it can refer to a foreign or unowned asset', async () => {
    const find = vi.fn()
    const req = { user: { id: 'owner-1' }, payload: { find } }
    const hook = (Projects.hooks?.beforeChange as any[])?.[0]
    await expect(hook({
      data: { settings: { pwa: { icon192Path: '/media/foreign.png' } } },
      req,
      operation: 'create',
    })).rejects.toThrow(/existing project asset library/)
    expect(find).not.toHaveBeenCalled()
  })
})

describe('integrity migration preflight', () => {
  it('stops before applying schema changes if duplicate slugs are present', async () => {
    const db = { execute: vi.fn(async () => ({ rows: [{ duplicate_count: 2 }] })) }
    await expect(migrateIntegrity({ db } as any)).rejects.toThrow(/duplicate page slugs/)
    expect(db.execute).toHaveBeenCalledTimes(1)
  })

  it('checks all legacy duplicates before issuing any DDL', async () => {
    const db = { execute: vi.fn(async () => ({ rows: [] })) }
    await migrateIntegrity({ db } as any)
    expect(db.execute).toHaveBeenCalledTimes(10)
  })
})
