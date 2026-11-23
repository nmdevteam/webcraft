import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
  projectExport: vi.fn(),
  validateGeneratedSource: vi.fn(),
}))

vi.mock('payload', () => ({ getPayload: mocks.getPayload }))
vi.mock('../../../apps/cms/node_modules/payload', () => ({ getPayload: mocks.getPayload }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('../../../apps/cms/src/lib/project-export', () => ({ projectExport: mocks.projectExport }))
vi.mock('../../../apps/cms/src/lib/export-validation', () => ({ validateGeneratedSource: mocks.validateGeneratedSource }))

import { POST } from '../../../apps/cms/src/app/api/webcraft/export/validate/route'

const payloadClient = { auth: vi.fn() }
const url = 'https://webcraft.local/api/webcraft/export/validate'

function request(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', ...headers },
    body,
  })
}

function streamedRequest(stream: ReadableStream<Uint8Array>) {
  return new Request(url, {
    method: 'POST',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  } as unknown as RequestInit)
}

describe('export validation route security boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    payloadClient.auth.mockResolvedValue({ user: { id: 'owner-1' } })
    mocks.getPayload.mockResolvedValue(payloadClient)
    mocks.projectExport.mockResolvedValue({ files: [{ path: 'index.html', content: '<h1>Hi</h1>' }] })
    mocks.validateGeneratedSource.mockResolvedValue({ ok: true, files: 1 })
  })

  it('rejects cross-origin requests before parsing or authentication', async () => {
    const response = await POST(new Request(url, {
      method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{broken',
    }))
    expect(response.status).toBe(403)
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })

  it('returns bounded client errors for malformed, unsupported, and oversized bodies', async () => {
    const malformed = await POST(request('{broken'))
    expect(malformed.status, await malformed.clone().text()).toBe(400)

    const unsupported = await POST(request('{}', { 'content-type': 'text/plain' }))
    expect(unsupported.status, await unsupported.clone().text()).toBe(415)

    const declaredOversize = await POST(request('{}', { 'content-length': '16001' }))
    expect(declaredOversize.status, await declaredOversize.clone().text()).toBe(413)

    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(16_001)); controller.close() } })
    const chunkedOversize = await POST(streamedRequest(stream))
    expect(chunkedOversize.status, await chunkedOversize.clone().text()).toBe(413)
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })

  it('requires an authenticated owner before exporting or validating project data', async () => {
    payloadClient.auth.mockResolvedValue({ user: null })
    const response = await POST(request(JSON.stringify({ projectId: 'project_1' })))
    expect(response.status, await response.clone().text()).toBe(401)
    expect(mocks.projectExport).not.toHaveBeenCalled()
    expect(mocks.validateGeneratedSource).not.toHaveBeenCalled()
  })

  it('validates only the authenticated user’s project export', async () => {
    const response = await POST(request(JSON.stringify({ projectId: 'project_1' })))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, files: 1 })
    expect(mocks.projectExport).toHaveBeenCalledWith(await mocks.getPayload.mock.results[0]?.value, 'project_1', { id: 'owner-1' })
    expect(mocks.validateGeneratedSource).toHaveBeenCalledWith([{ path: 'index.html', content: '<h1>Hi</h1>' }])
  })
})
