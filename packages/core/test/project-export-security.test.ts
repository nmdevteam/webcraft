import { describe, expect, it, vi } from 'vitest'
import { projectExport } from '../../../apps/cms/src/lib/project-export'

describe('persisted project export access control', () => {
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
