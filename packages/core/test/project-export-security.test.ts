import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from '../../../apps/cms/node_modules/sharp'
import { projectExport, readProjectExportAssets } from '../../../apps/cms/src/lib/project-export'
import { validatePwaIconDimensions } from '../../../apps/cms/src/lib/pwa-icons'
import { PwaSettingsSchema } from '../src/pwa'

function dbMock(transactionID: number | null = 41) {
  return {
    beginTransaction: vi.fn(async () => transactionID),
    commitTransaction: vi.fn(async () => undefined),
    rollbackTransaction: vi.fn(async () => undefined),
  }
}

async function image(width: number, height: number) {
  return sharp({ create: { width, height, channels: 4, background: '#ffffff' } }).png().toBuffer()
}

describe('persisted project export access control and snapshots', () => {
  it('loads assets sequentially and enforces per-asset and combined caps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'webcraft-assets-test-'))
    try {
      await writeFile(join(root, 'one.png'), Buffer.alloc(4 * 1024 * 1024))
      await writeFile(join(root, 'two.png'), Buffer.alloc(2 * 1024 * 1024))
      await expect(readProjectExportAssets([{ filename: 'one.png' }, { filename: 'two.png' }], root)).rejects.toThrow('combined export limit')
      await writeFile(join(root, 'large.png'), Buffer.alloc(5 * 1024 * 1024 + 1))
      await expect(readProjectExportAssets([{ filename: 'large.png' }], root)).rejects.toThrow('5 MB limit')
      await symlink(join(root, 'one.png'), join(root, 'linked.png'))
      await expect(readProjectExportAssets([{ filename: 'linked.png' }], root)).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('loads project, pages, and assets with owner access inside one repeatable-read, read-only transaction', async () => {
    const owner = { id: 'owner-1' }
    const db = dbMock()
    const findByID = vi.fn(async () => ({ id: 'project-1', name: 'Owner site', settings: {} }))
    const find = vi.fn(async (query: any) => query.collection === 'pages'
      ? { docs: [{ title: 'Home', slug: 'home', isHome: true, nodes: [] }], totalDocs: 1 }
      : { docs: [], totalDocs: 0 })
    const result = await projectExport({ db, findByID, find }, 'project-1', owner)

    expect(result.projectName).toBe('Owner site')
    expect(result.pageCount).toBe(1)
    expect(db.beginTransaction).toHaveBeenCalledWith({ isolationLevel: 'repeatable read', accessMode: 'read only' })
    expect(db.commitTransaction).toHaveBeenCalledWith(41)
    expect(db.rollbackTransaction).not.toHaveBeenCalled()
    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'projects', id: 'project-1', user: owner, overrideAccess: false, req: { transactionID: 41 },
    }))
    expect(find).toHaveBeenCalledTimes(2)
    for (const [query] of find.mock.calls) {
      expect(query.user).toBe(owner)
      expect(query.overrideAccess).toBe(false)
      expect(query.where.project.equals).toBe('project-1')
      expect(query.req.transactionID).toBe(41)
    }
  })

  it('rolls back the database snapshot and does not read pages or assets when project access is denied', async () => {
    const db = dbMock()
    const findByID = vi.fn(async () => { throw new Error('not found') })
    const find = vi.fn()
    await expect(projectExport({ db, findByID, find }, 'other-owner-project', { id: 'owner-1' })).rejects.toThrow('not found')
    expect(db.rollbackTransaction).toHaveBeenCalledWith(41)
    expect(db.commitTransaction).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
  })

  it('fails closed if a repeatable-read transaction is unavailable', async () => {
    const db = dbMock(null)
    const findByID = vi.fn()
    const find = vi.fn()
    await expect(projectExport({ db, findByID, find }, 'project-1', { id: 'owner-1' })).rejects.toThrow('consistent export snapshot is unavailable')
    expect(findByID).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
  })
})

describe('PWA icon dimensions', () => {
  it('accepts exact 192×192 and 512×512 project images', async () => {
    const root = await mkdtemp(join(tmpdir(), 'webcraft-pwa-icons-'))
    try {
      await writeFile(join(root, 'small.png'), await image(192, 192))
      await writeFile(join(root, 'large.png'), await image(512, 512))
      const settings = PwaSettingsSchema.parse({ icon192Path: '/media/small.png', icon512Path: '/media/large.png' })
      await expect(validatePwaIconDimensions(settings, [{ filename: 'small.png' }, { filename: 'large.png' }], root)).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects mismatched dimensions, missing project assets, and invalid image bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'webcraft-pwa-icons-'))
    try {
      await writeFile(join(root, 'wrong.png'), await image(193, 192))
      await writeFile(join(root, 'broken.png'), Buffer.from('not an image'))
      await expect(validatePwaIconDimensions({ icon192Path: '/media/wrong.png' }, [{ filename: 'wrong.png' }], root)).rejects.toThrow('exactly 192×192')
      await expect(validatePwaIconDimensions({ icon192Path: '/media/missing.png' }, [], root)).rejects.toThrow('asset library')
      await expect(validatePwaIconDimensions({ icon192Path: '/media/broken.png' }, [{ filename: 'broken.png' }], root)).rejects.toThrow('not a valid supported raster image')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
