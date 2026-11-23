import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectExport, readProjectExportAssets } from '../../../apps/cms/src/lib/project-export'

describe('persisted project export access control', () => {
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

  it('runs project, page, and asset reads with access control enabled and the authenticated owner', async () => {
    const owner = { id: 'owner-1' }
    const findByID = vi.fn(async () => ({ id: 'project-1', name: 'Owner site', settings: {} }))
    const find = vi.fn(async (query: any) => query.collection === 'pages'
      ? { docs: [{ title: 'Home', slug: 'home', isHome: true, nodes: [] }], totalDocs: 1 }
      : { docs: [], totalDocs: 0 })
    const result = await projectExport({ findByID, find }, 'project-1', owner)

    expect(result.projectName).toBe('Owner site')
    expect(result.pageCount).toBe(1)
    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'projects', id: 'project-1', user: owner, overrideAccess: false,
    }))
    expect(find).toHaveBeenCalledTimes(2)
    for (const [query] of find.mock.calls) {
      expect(query.user).toBe(owner)
      expect(query.overrideAccess).toBe(false)
      expect(query.where.project.equals).toBe('project-1')
    }
  })

  it('does not continue to pages or assets when project access is denied', async () => {
    const findByID = vi.fn(async () => { throw new Error('not found') })
    const find = vi.fn()
    await expect(projectExport({ findByID, find }, 'other-owner-project', { id: 'owner-1' })).rejects.toThrow('not found')
    expect(find).not.toHaveBeenCalled()
  })
})
