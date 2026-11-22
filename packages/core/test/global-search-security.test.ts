import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), find: vi.fn() }))

vi.mock('../../../apps/cms/src/lib/project-history-route', () => ({
  authenticateProjectHistoryRequest: mocks.authenticate,
}))

import { GET } from '../../../apps/cms/src/app/api/webcraft/search/route'

function request(query = 'needle', projectId?: string) {
  const url = new URL(`https://webcraft.local/api/webcraft/search?q=${encodeURIComponent(query)}`)
  if (projectId) url.searchParams.set('projectId', projectId)
  return new Request(url, {
    headers: { origin: 'https://webcraft.local' },
  })
}

async function invoke(query = 'needle', projectId?: string) {
  const response = await GET(request(query, projectId))
  if (!response) throw new Error('The global-search route returned no response.')
  return response
}

function payloadWith(docsByCollection: Record<string, unknown[]>) {
  mocks.find.mockImplementation(async (args: { collection: string }) => {
    const docs = docsByCollection[args.collection] ?? []
    return { docs, totalDocs: docs.length }
  })
  return { find: mocks.find }
}

describe('global workspace search API security', () => {
  beforeEach(() => vi.resetAllMocks())

  it('does not query workspace records before authentication and same-origin checks pass', async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response('unauthorized', { status: 401 }) })
    const response = await invoke()
    expect(response.status).toBe(401)
    expect(mocks.find).not.toHaveBeenCalled()
  })

  it('searches only owner-scoped project data and excludes pages or assets linked to another owner’s project', async () => {
    const user = { id: 'owner-1' }
    const payload = payloadWith({
      projects: [{ id: 'project-1', name: 'Needle site', category: 'Portfolio', settings: {} }],
      pages: [
        { id: 'page-1', title: 'Needle page', slug: 'home', project: 'project-1', nodes: [{ id: 'headline', type: 'heading', props: { text: 'Needle heading' }, children: [] }] },
        { id: 'foreign-page', title: 'Needle foreign page', slug: 'private', project: 'another-owner-project', nodes: [{ id: 'foreign-node', type: 'paragraph', props: { text: 'Needle private body' }, children: [] }] },
      ],
      assets: [
        { id: 'asset-1', name: 'Needle image', filename: 'needle.png', project: 'project-1' },
        { id: 'foreign-asset', name: 'Needle private image', filename: 'private.png', project: 'another-owner-project' },
      ],
      'installed-components': [{ id: 'installed-1', name: 'Needle component', project: 'project-1' }],
      'marketplace-packages': [{ id: 'package-1', name: 'Needle public package', type: 'component', category: 'General', description: 'Public catalog entry' }],
    })
    mocks.authenticate.mockResolvedValue({ payload, user })

    const response = await invoke()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.results.some((item: { label: string }) => item.label.includes('foreign'))).toBe(false)
    expect(body.results.some((item: { label: string }) => item.label === 'Needle site')).toBe(true)
    expect(body.results.some((item: { target: string }) => item.target.includes('page-1'))).toBe(true)
    expect(body.results.some((item: { label: string }) => item.label === 'Needle image')).toBe(true)

    const collections = new Map(mocks.find.mock.calls.map(([args]) => [args.collection, args]))
    for (const collection of ['projects', 'pages', 'assets', 'installed-components']) {
      const args = collections.get(collection) as { where: { owner: { equals: string } }; limit: number; depth: number; user: unknown; overrideAccess: boolean }
      expect(args.where.owner.equals).toBe(user.id)
      expect(args.limit).toBe(100)
      expect(args.depth).toBe(0)
      expect(args.user).toBe(user)
      expect(args.overrideAccess).toBe(false)
    }
    const packages = collections.get('marketplace-packages') as { where: { or: unknown[] }; user: unknown; overrideAccess: boolean }
    expect(packages.where.or).toEqual(expect.arrayContaining([
      { owner: { equals: user.id } },
      { published: { equals: true } },
    ]))
    expect(packages.user).toBe(user)
    expect(packages.overrideAccess).toBe(false)
  })

  it('targets built-in component results to the active project rather than the first project', async () => {
    const user = { id: 'owner-1' }
    const payload = payloadWith({ projects: [
      { id: 'project-first', name: 'First site', settings: {} },
      { id: 'project-active', name: 'Active site', settings: {} },
    ] })
    mocks.authenticate.mockResolvedValue({ payload, user })

    const response = await invoke('head', 'project-active')
    const body = await response.json()
    const addResult = body.results.find((item: { target: string }) => item.target.includes('?add='))

    expect(addResult).toMatchObject({ type: 'component', label: 'heading' })
    expect(addResult.target).toBe('/editor/project-active?add=heading')
    expect(addResult.target).not.toContain('project-first')
  })

  it('validates an active project outside the recent sample with an owner-scoped lookup and omits unowned targets', async () => {
    const user = { id: 'owner-1' }
    mocks.find.mockImplementation(async (args: { collection: string; limit?: number; where?: { and?: unknown[] } }) => {
      if (args.collection === 'projects' && args.limit === 1) return { docs: [{ id: 'older-owned-project', name: 'Older site' }], totalDocs: 1 }
      const docs = args.collection === 'projects' ? [] : []
      return { docs, totalDocs: docs.length }
    })
    const payload = { find: mocks.find }
    mocks.authenticate.mockResolvedValue({ payload, user })

    const response = await invoke('head', 'older-owned-project')
    const body = await response.json()
    const addResult = body.results.find((item: { target: string }) => item.target.includes('?add='))
    expect(addResult.target).toBe('/editor/older-owned-project?add=heading')

    const activeLookup = mocks.find.mock.calls.map(([args]) => args as { collection: string; where?: { and?: Array<Record<string, unknown>> }; limit?: number; user?: unknown; overrideAccess?: boolean }).find((args) => args.collection === 'projects' && args.limit === 1)
    expect(activeLookup?.where?.and).toEqual([{ owner: { equals: user.id } }, { id: { equals: 'older-owned-project' } }])
    expect(activeLookup?.user).toBe(user)
    expect(activeLookup?.overrideAccess).toBe(false)
  })

  it('does not offer component insertion when the requested active project is not owned by the caller', async () => {
    const user = { id: 'owner-1' }
    mocks.find.mockResolvedValue({ docs: [], totalDocs: 0 })
    mocks.authenticate.mockResolvedValue({ payload: { find: mocks.find }, user })

    const response = await invoke('head', 'foreign-project')
    const body = await response.json()
    expect(body.results.some((item: { target: string }) => item.target.includes('?add='))).toBe(false)
    const activeLookup = mocks.find.mock.calls.map(([args]) => args as { collection: string; where?: { and?: Array<Record<string, unknown>> }; limit?: number }).find((args) => args.collection === 'projects' && args.limit === 1)
    expect(activeLookup?.where?.and).toEqual([{ owner: { equals: user.id } }, { id: { equals: 'foreign-project' } }])
  })

  it('rejects overlong queries and reports when component traversal or result output is capped', async () => {
    const user = { id: 'owner-1' }
    const payload = payloadWith({
      projects: [{ id: 'project-1', name: 'My site', settings: {} }],
      pages: [{ id: 'page-1', title: 'Home', slug: 'home', project: 'project-1', nodes: Array.from({ length: 1_000 }, (_, index) => ({ id: `node-${index}`, type: 'paragraph', props: { text: 'needle' }, children: [] })) }],
    })
    mocks.authenticate.mockResolvedValue({ payload, user })

    const tooLong = await invoke('n'.repeat(81))
    expect(tooLong.status).toBe(400)
    expect(mocks.find).not.toHaveBeenCalled()

    const response = await invoke()
    const body = await response.json()
    expect(body.results.length).toBeLessThanOrEqual(60)
    expect(body.bounded).toBe(true)
  })
})
