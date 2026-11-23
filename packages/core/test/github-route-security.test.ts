import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  readToken: vi.fn(),
  saveToken: vi.fn(),
  disconnect: vi.fn(),
  projectExport: vi.fn(),
  validateSource: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('payload', () => ({ getPayload: mocks.auth }))
vi.mock('../../../apps/cms/node_modules/payload', () => ({ getPayload: mocks.auth }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('../../../apps/cms/src/lib/github-store', () => ({
  readGitHubToken: mocks.readToken,
  saveGitHubToken: mocks.saveToken,
  disconnectGitHub: mocks.disconnect,
}))
vi.mock('../../../apps/cms/src/lib/project-export', () => ({ projectExport: mocks.projectExport }))
vi.mock('../../../apps/cms/src/lib/export-validation', () => ({ validateGeneratedSource: mocks.validateSource }))

import { GET, POST } from '../../../apps/cms/src/app/api/webcraft/github/[...action]/route'

const authPayload = { auth: vi.fn() }

async function invoke(handler: typeof GET | typeof POST, action: string, request: Request) {
  return handler(request, { params: Promise.resolve({ action: action.split('/') }) })
}

function jsonRequest(url: string, value: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', ...headers },
    body: JSON.stringify(value),
  })
}

function githubResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

describe('GitHub route security boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue(authPayload)
    authPayload.auth.mockResolvedValue({ user: { id: 'owner-1' } })
    mocks.fetch.mockResolvedValue(githubResponse({ login: 'octocat' }))
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.readToken.mockReturnValue({ token: 'ghs_' + 'x'.repeat(30), login: 'octocat' })
  })

  it('rejects a cross-origin request before authentication or storage reads', async () => {
    const response = await invoke(GET, 'account', new Request('https://webcraft.local/api/webcraft/github/account', {
      headers: { origin: 'https://attacker.example' },
    }))
    expect(response.status).toBe(403)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.readToken).not.toHaveBeenCalled()
  })

  it('returns authentication failure before reading GitHub storage or calling GitHub', async () => {
    authPayload.auth.mockResolvedValue({ user: null })
    const response = await invoke(GET, 'account', new Request('https://webcraft.local/api/webcraft/github/account'))
    expect(response.status, await response.clone().text()).toBe(401)
    expect(mocks.readToken).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed and oversized connect bodies without network access', async () => {
    const malformed = await invoke(POST, 'connect', new Request('https://webcraft.local/api/webcraft/github/connect', {
      method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: '{not-json',
    }))
    expect(malformed.status, await malformed.clone().text()).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()

    const wrongType = await invoke(POST, 'connect', new Request('https://webcraft.local/api/webcraft/github/connect', {
      method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'text/plain' }, body: '{}',
    }))
    expect(wrongType.status, await wrongType.clone().text()).toBe(415)

    const oversized = await invoke(POST, 'connect', new Request('https://webcraft.local/api/webcraft/github/connect', {
      method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'content-length': '1000001' }, body: '{}',
    }))
    expect(oversized.status, await oversized.clone().text()).toBe(413)

    const chunkedBody = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1_000_001)); controller.close() } })
    const chunked = await invoke(POST, 'connect', new Request('https://webcraft.local/api/webcraft/github/connect', {
      method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: chunkedBody, duplex: 'half',
    } as unknown as RequestInit))
    expect(chunked.status, await chunked.clone().text()).toBe(413)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('never returns the GitHub token when connecting', async () => {
    mocks.fetch.mockResolvedValue(githubResponse({ login: 'octocat' }))
    const token = 'ghp_' + 'secret-token'.repeat(4)
    const response = await invoke(POST, 'connect', jsonRequest('https://webcraft.local/api/webcraft/github/connect', { token }))
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).not.toContain(token)
    expect(text).not.toContain('secret-token')
    expect(mocks.saveToken).toHaveBeenCalledWith(token, 'octocat')
  })

  it('rejects the protected nmdevteam/nmdevteam push target before exporting or networking', async () => {
    const response = await invoke(POST, 'push', jsonRequest('https://webcraft.local/api/webcraft/github/push', {
      projectId: 'project_1', repository: 'NMDEVTEAM/nmdevteam',
    }))
    expect(response.status, await response.clone().text()).toBe(403)
    expect(mocks.projectExport).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects invalid push identifiers before project reads or network access', async () => {
    const response = await invoke(POST, 'push', jsonRequest('https://webcraft.local/api/webcraft/github/push', {
      projectId: '../private', repository: 'owner/repo',
    }))
    expect(response.status, await response.clone().text()).toBe(400)
    expect(mocks.projectExport).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
