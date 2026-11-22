import { describe, expect, it, vi } from 'vitest'
import { ProjectVersions } from '../../cms/src/collections/ProjectVersions'
import { createProjectVersion, matchVersionPages, restoreProjectVersion } from '../../cms/src/lib/project-history'
import { ProjectSettingsSchema, type ProjectVersionSnapshot } from '@webcraft/core/schema'

const user = { id: 'owner-1' }
const settings = ProjectSettingsSchema.parse({})
const snapshot: ProjectVersionSnapshot = {
  project: { name: 'Site', category: 'Business', templateId: 'business', settings },
  pages: [{ sourceId: 'page-1', title: 'Home', slug: 'home', isHome: true, nodes: [] }],
}
const project = { id: 'project-1', name: 'Site', category: 'Business', templateId: 'business', settings: {} }
const page = { id: 'page-1', title: 'Home', slug: 'home', isHome: true, nodes: [], project: 'project-1', revision: 0 }

function versionPayload(seed: any[] = []) {
  const versions = [...seed]
  const create = vi.fn(async ({ data }: any) => {
    const created = { id: `version-${versions.length + 1}`, createdAt: new Date().toISOString(), ...data }
    versions.push(created)
    return created
  })
  const payload: any = {
    versions,
    create,
    findByID: vi.fn(async ({ collection, id }: any) => {
      if (collection === 'projects') return project
      if (collection === 'project-versions') return versions.find((version) => String(version.id) === String(id))
      throw new Error(`Unexpected collection ${collection}`)
    }),
    find: vi.fn(async ({ collection, where }: any) => {
      if (collection === 'pages') return { docs: [page], totalDocs: 1 }
      if (collection === 'project-versions') {
        if (where?.and) {
          const hash = where.and.find((condition: any) => condition.contentHash)?.contentHash.equals
          return { docs: versions.filter((version) => version.project === 'project-1' && version.contentHash === hash).slice(0, 1) }
        }
        return { docs: versions.filter((version) => version.project === 'project-1').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 1) }
      }
      throw new Error(`Unexpected collection ${collection}`)
    }),
  }
  return payload
}

describe('project version history service', () => {
  it('creates meaningful automatic snapshots once and deduplicates identical project content', async () => {
    const payload = versionPayload()
    const first = await createProjectVersion(payload, 'project-1', user, 'automatic')
    const second = await createProjectVersion(payload, 'project-1', user, 'automatic')

    expect(first.created).toBe(true)
    expect(second).toMatchObject({ created: false, skipped: 'duplicate', version: first.version })
    expect(payload.create).toHaveBeenCalledTimes(1)
    expect(first.version.snapshot.pages[0].title).toBe('Home')
  })

  it('honors disabled and interval-limited automatic snapshots while allowing manual snapshots', async () => {
    const disabledPayload = versionPayload()
    disabledPayload.findByID.mockImplementation(async ({ collection }: any) => collection === 'projects' ? { ...project, settings: { historyIntervalMinutes: 0 } } : undefined)
    expect(await createProjectVersion(disabledPayload, 'project-1', user, 'automatic')).toMatchObject({ created: false, skipped: 'disabled' })
    expect(disabledPayload.create).not.toHaveBeenCalled()

    const recentVersion = { id: 'recent', project: 'project-1', contentHash: 'different', createdAt: new Date(Date.now() - 5 * 60_000).toISOString() }
    const intervalPayload = versionPayload([recentVersion])
    expect(await createProjectVersion(intervalPayload, 'project-1', user, 'automatic')).toMatchObject({ created: false, skipped: 'interval' })
    expect(intervalPayload.create).not.toHaveBeenCalled()
    expect((await createProjectVersion(intervalPayload, 'project-1', user, 'manual')).created).toBe(true)
  })

  it('keeps version records owner-scoped and unavailable for direct updates or deletes', () => {
    const read = ProjectVersions.access?.read as (args: any) => unknown
    const update = ProjectVersions.access?.update as (args: any) => unknown
    const remove = ProjectVersions.access?.delete as (args: any) => unknown
    expect(read({ req: { user } })).toEqual({ owner: { equals: user.id } })
    expect(read({ req: { user: null } })).toBe(false)
    expect(update({ req: { user } })).toBe(false)
    expect(remove({ req: { user } })).toBe(false)
  })

  it('refuses to restore a version from another project before changing project data', async () => {
    const payload: any = {
      db: { beginTransaction: vi.fn(async () => 'restore-tx'), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(async () => undefined) },
      findByID: vi.fn(async ({ collection }: any) => collection === 'projects' ? project : { id: 'foreign', project: 'another-project', snapshot }),
      update: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
      find: vi.fn(),
    }
    await expect(restoreProjectVersion(payload, 'project-1', 'foreign', user)).rejects.toThrow(/not found for this project/)
    expect(payload.update).not.toHaveBeenCalled()
    expect(payload.delete).not.toHaveBeenCalled()
    expect(payload.db.rollbackTransaction).toHaveBeenCalledWith('restore-tx')
    expect(payload.db.commitTransaction).not.toHaveBeenCalled()
  })

  it('reserves exact page-ID matches before using a slug fallback', () => {
    const exactMatch = { id: 'page-2', slug: 'current-slug' }
    const otherPage = { id: 'page-1', slug: 'former-slug' }
    const matches = matchVersionPages([
      { sourceId: 'deleted-id', slug: 'current-slug' },
      { sourceId: 'page-2', slug: 'former-slug' },
    ], [exactMatch, otherPage])

    expect(matches).toEqual([undefined, exactMatch])
  })

  it('restores deleted pages and earlier website settings, and removes pages absent from the snapshot', async () => {
    const restoredSnapshot: ProjectVersionSnapshot = {
      project: {
        name: 'Original site', category: 'Business', templateId: 'business',
        settings: ProjectSettingsSchema.parse({ title: 'Original website title', description: 'Earlier description' }),
      },
      pages: [
        { sourceId: '1', title: 'Home', slug: 'home', isHome: true, nodes: [] },
        { sourceId: 'deleted-page', title: 'About', slug: 'about', isHome: false, nodes: [{ id: 'text', type: 'paragraph', props: { text: 'Recovered content' }, style: {}, children: [] }] },
      ],
    }
    const liveProject: any = { id: 'project-1', name: 'Changed site', category: 'Business', templateId: 'business', settings: { title: 'Changed title' } }
    const currentPages: any[] = [
      { id: '1', title: 'Home', slug: 'home', isHome: true, nodes: [], project: 'project-1', revision: 2 },
      { id: '2', title: 'New draft', slug: 'new-draft', isHome: false, nodes: [], project: 'project-1', revision: 1 },
    ]
    const versions = [{ id: 'target', project: 'project-1', label: 'Before page removal', snapshot: restoredSnapshot }]
    let nextPageId = 2
    const payload: any = {
      db: { beginTransaction: vi.fn(async () => 'restore-tx'), commitTransaction: vi.fn(), rollbackTransaction: vi.fn() },
      findByID: vi.fn(async ({ collection, id }: any) => {
        if (collection === 'projects') return liveProject
        if (collection === 'project-versions') return versions.find((version) => version.id === String(id))
        throw new Error(`Unexpected collection ${collection}`)
      }),
      find: vi.fn(async ({ collection, where }: any) => {
        if (collection === 'pages') return { docs: [...currentPages], totalDocs: currentPages.length }
        if (collection === 'project-versions') {
          if (where?.and) {
            const hash = where.and.find((condition: any) => condition.contentHash)?.contentHash.equals
            return { docs: versions.filter((version: any) => version.project === 'project-1' && version.contentHash === hash).slice(0, 1) }
          }
          return { docs: versions.filter((version: any) => version.project === 'project-1').slice(-1) }
        }
        throw new Error(`Unexpected collection ${collection}`)
      }),
      create: vi.fn(async ({ collection, data }: any) => {
        if (collection === 'project-versions') {
          const created = { id: `backup-${versions.length}`, createdAt: new Date().toISOString(), ...data }
          versions.push(created)
          return created
        }
        const created = { id: String(++nextPageId), revision: 0, ...data }
        currentPages.push(created)
        return created
      }),
      update: vi.fn(async ({ collection, id, data }: any) => {
        if (collection === 'projects') { Object.assign(liveProject, data); return liveProject }
        const current = currentPages.find((item) => String(item.id) === String(id))
        if (!current) throw new Error('Page missing')
        Object.assign(current, data)
        if (data.revision !== undefined) current.revision = Number(data.revision) + 1
        return current
      }),
      delete: vi.fn(async ({ collection, id }: any) => {
        if (collection !== 'pages') throw new Error(`Unexpected delete ${collection}`)
        const index = currentPages.findIndex((item) => String(item.id) === String(id))
        if (index >= 0) currentPages.splice(index, 1)
      }),
    }

    await restoreProjectVersion(payload, 'project-1', 'target', user)

    expect(currentPages.map((item) => [item.title, item.slug, item.isHome]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
      ['About', 'about', false], ['Home', 'home', true],
    ])
    expect(currentPages.find((item) => item.slug === 'about').nodes[0].props.text).toBe('Recovered content')
    expect(liveProject.name).toBe('Original site')
    expect(liveProject.settings.description).toBe('Earlier description')
    expect(currentPages.some((item) => item.title === 'New draft')).toBe(false)
    expect(versions.some((version: any) => version.reason === 'before-restore')).toBe(true)
    expect(payload.db.commitTransaction).toHaveBeenCalledWith('restore-tx')
    expect(payload.db.rollbackTransaction).not.toHaveBeenCalled()
  })

  it('rolls back a partially failed restore and preserves a recovery snapshot after rollback', async () => {
    const targetSnapshot: ProjectVersionSnapshot = {
      project: { name: 'Older site', category: 'Business', templateId: 'business', settings },
      pages: [{ sourceId: 'page-1', title: 'Older home', slug: 'home', isHome: true, nodes: [] }],
    }
    const liveProject: any = { ...project, settings: ProjectSettingsSchema.parse({ description: 'Current website settings' }) }
    const currentPage: any = { ...page, title: 'Current home', nodes: [], revision: 3 }
    const originalProject = structuredClone(liveProject)
    const originalPage = structuredClone(currentPage)
    const versions: any[] = [{ id: 'target', project: 'project-1', label: 'Old version', snapshot: targetSnapshot }]
    const payload: any = {
      db: {
        beginTransaction: vi.fn(async () => 'restore-tx'),
        commitTransaction: vi.fn(),
        rollbackTransaction: vi.fn(async () => {
          Object.assign(liveProject, originalProject)
          Object.assign(currentPage, originalPage)
          versions.splice(1)
        }),
      },
      findByID: vi.fn(async ({ collection, id }: any) => collection === 'projects' ? liveProject : versions.find((version) => version.id === String(id))),
      find: vi.fn(async ({ collection, where }: any) => {
        if (collection === 'pages') return { docs: [currentPage], totalDocs: 1 }
        if (collection === 'project-versions') {
          if (where?.and) {
            const hash = where.and.find((condition: any) => condition.contentHash)?.contentHash.equals
            return { docs: versions.filter((version) => version.project === 'project-1' && version.contentHash === hash).slice(0, 1) }
          }
          return { docs: versions.filter((version) => version.project === 'project-1').slice(-1) }
        }
        throw new Error(`Unexpected collection ${collection}`)
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `version-${versions.length}`, createdAt: new Date().toISOString(), ...data }
        versions.push(created)
        return created
      }),
      update: vi.fn(async ({ collection, data }: any) => {
        if (collection === 'projects') throw new Error('Simulated project update failure')
        Object.assign(currentPage, data)
        if (data.revision !== undefined) currentPage.revision = Number(data.revision) + 1
        return currentPage
      }),
      delete: vi.fn(),
    }

    await expect(restoreProjectVersion(payload, 'project-1', 'target', user)).rejects.toThrow('Simulated project update failure')

    expect(payload.db.rollbackTransaction).toHaveBeenCalledWith('restore-tx')
    expect(payload.db.commitTransaction).not.toHaveBeenCalled()
    expect(currentPage.title).toBe('Current home')
    expect(liveProject.name).toBe('Site')
    expect(versions.some((version) => version.label === 'Recovery snapshot after failed restore')).toBe(true)
  })
})
