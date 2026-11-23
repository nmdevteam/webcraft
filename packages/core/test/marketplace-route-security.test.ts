import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
  payloadAuth: vi.fn(),
  findByID: vi.fn(),
  update: vi.fn(),
  authenticate: vi.fn(),
}))

vi.mock('payload', () => ({ getPayload: mocks.getPayload }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('../../../apps/cms/src/lib/marketplace-route', async () => {
  const actual = await vi.importActual<typeof import('../../../apps/cms/src/lib/marketplace-route')>('../../../apps/cms/src/lib/marketplace-route')
  return { ...actual, authenticateMarketplaceRequest: mocks.authenticate }
})

import { parseMarketplacePackage, readBoundedJson } from '../../../apps/cms/src/lib/marketplace-route'
import { GET, PATCH } from '../../../apps/cms/src/app/api/webcraft/marketplace/packages/[packageId]/route'
import { POST as install } from '../../../apps/cms/src/app/api/webcraft/marketplace/packages/[packageId]/install/route'

function context(packageId: string) {
  return { params: Promise.resolve({ packageId }) }
}

function request(url: string, init: RequestInit = {}) {
  return new Request(url, { headers: { origin: 'https://webcraft.local', ...init.headers }, ...init })
}

describe('marketplace route security boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getPayload.mockResolvedValue({ auth: mocks.payloadAuth })
    mocks.payloadAuth.mockResolvedValue({ user: { id: 'owner-1' } })
    mocks.authenticate.mockResolvedValue({ payload: { findByID: mocks.findByID, update: mocks.update }, user: { id: 'owner-1' } })
    mocks.findByID.mockResolvedValue({ id: 'pkg-1', owner: 'owner-2', type: 'component', packageData: {} })
    mocks.update.mockResolvedValue({ id: 'pkg-1', owner: 'owner-1', type: 'component', packageData: {} })
  })

  it('rejects unauthenticated package reads before querying marketplace data', async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401 }) })
    const response = await GET(request('https://webcraft.local/api/marketplace/packages/pkg-1'), context('pkg-1'))
    if (!response) throw new Error('GET route returned no response.')
    expect(response.status).toBe(401)
    expect(mocks.findByID).not.toHaveBeenCalled()
  })

  it('enforces owner scope before reading a PATCH body or updating a package', async () => {
    const response = await PATCH(request('https://webcraft.local/api/marketplace/packages/pkg-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ published: true }),
    }), context('pkg-1'))
    if (!response) throw new Error('PATCH route returned no response.')
    expect(response.status).toBe(403)
    expect(mocks.findByID).toHaveBeenCalledWith(expect.objectContaining({ user: { id: 'owner-1' }, overrideAccess: false }))
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects invalid install package IDs after auth but before package reads or writes', async () => {
    const response = await install(request('https://webcraft.local/api/marketplace/packages/../install', { method: 'POST' }), context('../'))
    if (!response) throw new Error('Install route returned no response.')
    expect(response.status).toBe(400)
    expect(mocks.findByID).not.toHaveBeenCalled()
  })

  it('enforces JSON content type, byte bounds, and object shape for package bodies', async () => {
    await expect(readBoundedJson(request('https://webcraft.local/api/marketplace', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }))).rejects.toMatchObject({ status: 415 })
    await expect(readBoundedJson(request('https://webcraft.local/api/marketplace', { method: 'POST', body: 'x'.repeat(32), headers: { 'content-type': 'application/json' } }), 8)).rejects.toMatchObject({ status: 413 })
    await expect(readBoundedJson(request('https://webcraft.local/api/marketplace', { method: 'POST', body: '{bad', headers: { 'content-type': 'application/json' } }))).rejects.toMatchObject({ status: 400 })
  })

  it('reports malformed marketplace packages with bounded validation details', () => {
    expect(() => parseMarketplacePackage({ type: 'component', packageId: '../escape' })).toThrow(/packageId|format|name/)
  })
})
