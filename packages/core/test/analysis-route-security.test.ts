import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSource } from '../src/exporter'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  projectExport: vi.fn(),
  validateGeneratedSource: vi.fn(),
}))

vi.mock('../../../apps/cms/src/lib/project-history-route', () => ({
  authenticateProjectHistoryRequest: mocks.authenticate,
  validHistoryId: (value: string) => /^[A-Za-z0-9_-]{1,80}$/.test(value),
}))
vi.mock('../../../apps/cms/src/lib/project-export', () => ({ projectExport: mocks.projectExport }))
vi.mock('../../../apps/cms/src/lib/export-validation', () => ({ validateGeneratedSource: mocks.validateGeneratedSource }))

import { GET } from '../../../apps/cms/src/app/api/webcraft/projects/[projectId]/analysis/route'

async function invoke(request: Request, projectId = 'project_1') {
  const response = await GET(request, { params: Promise.resolve({ projectId }) })
  if (!response) throw new Error('The analysis route returned no response.')
  return response
}

describe('website analysis API security', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns the authentication response without reading project data when unauthenticated', async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response('unauthorized', { status: 401 }) })
    const response = await invoke(new Request('https://webcraft.local/api/analysis'))
    expect(response.status).toBe(401)
    expect(mocks.projectExport).not.toHaveBeenCalled()
  })

  it('does not read data after the shared same-origin guard rejects a request', async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response('cross-origin request rejected', { status: 403 }) })
    const response = await invoke(new Request('https://webcraft.local/api/analysis', { headers: { origin: 'https://attacker.example' } }))
    expect(response.status).toBe(403)
    expect(mocks.projectExport).not.toHaveBeenCalled()
  })

  it('returns only a bounded report and scopes all project reads to the authenticated owner', async () => {
    const user = { id: 'owner-1' }
    const payload = {}
    mocks.authenticate.mockResolvedValue({ payload, user })
    const files = generateSource({ name: 'Owner site', settings: {}, pages: [{
      title: 'Home', slug: 'home', isHome: true,
      nodes: [{ id: 'secret-node', type: 'paragraph', props: { text: 'PRIVATE BODY MARKER' }, style: {}, children: [] }],
    }] })
    mocks.projectExport.mockResolvedValue({ files, projectName: 'Owner site', pageCount: 1, settings: {} })
    mocks.validateGeneratedSource.mockResolvedValue({ valid: true, productionArtifacts: { outputTotalBytes: 120_000, gzipJavaScriptBytes: 32_000 } })

    const response = await invoke(new Request('https://webcraft.local/api/analysis', { headers: { origin: 'https://webcraft.local' } }))
    const report = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(report.mode).toBe('static-generated-source')
    expect(report.performance.metrics.outputTotalBytes).toBe(120_000)
    expect(report.performance.metrics.gzipJavaScriptBytes).toBe(32_000)
    expect(JSON.stringify(report)).not.toContain('PRIVATE BODY MARKER')
    expect(mocks.projectExport).toHaveBeenCalledWith(payload, 'project_1', user)
    expect(mocks.validateGeneratedSource).toHaveBeenCalledWith(files)
  })

  it('does not expose internal export errors in its response', async () => {
    mocks.authenticate.mockResolvedValue({ payload: {}, user: { id: 'owner-1' } })
    mocks.projectExport.mockRejectedValue(new Error('private storage path /srv/private/media'))
    const response = await invoke(new Request('https://webcraft.local/api/analysis'))
    expect(response.status).toBe(422)
    expect(await response.text()).not.toContain('/srv/private/media')
  })
})
