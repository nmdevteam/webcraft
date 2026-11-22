import { getPayload } from 'payload'
import config from '@payload-config'
import type { GeneratedFile } from '@webcraft/core/exporter'
import { readGitHubToken, saveGitHubToken, disconnectGitHub } from '../../../../../lib/github-store'
import { projectExport } from '../../../../../lib/project-export'
import { validateGeneratedSource } from '../../../../../lib/export-validation'

export const dynamic = 'force-dynamic'
type User = { id: string | number; email?: string; name?: string }
type GhResponse<T> = { data: T; status: number; headers: Headers }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

function checkOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const allowed = new Set([process.env.BUILDER_ORIGIN ?? 'http://127.0.0.1:5173', 'http://localhost:5173'])
  return allowed.has(origin)
}
async function body(request: Request, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > maxBytes) throw new Error('Request body is too large')
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Request body is too large')
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object')
  return parsed as Record<string, unknown>
}
async function authenticated(request: Request) {
  const payload = await getPayload({ config })
  const result = await payload.auth({ headers: request.headers })
  if (!result.user) throw new Error('UNAUTHORIZED')
  return { payload, user: result.user as User }
}
async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<GhResponse<T>> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...init.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })
  let data: unknown
  try { data = await response.json() } catch { data = {} }
  if (!response.ok) throw new Error(`GitHub request failed (HTTP ${response.status})`)
  return { data: data as T, status: response.status, headers: response.headers }
}
function githubProblem(error: unknown) {
  if (error instanceof Error && error.message === 'UNAUTHORIZED') return json({ error: 'Please sign in again.' }, 401)
  if (error instanceof Error && error.message === 'Request body is too large') return json({ error: error.message }, 413)
  if (error instanceof Error && error.message.startsWith('GitHub request failed')) return json({ error: error.message }, 502)
  if (error instanceof Error && /^(This project|A project|Project|Asset|An uploaded|Export|Generated project)/.test(error.message)) return json({ error: error.message }, 422)
  return json({ error: 'GitHub operation failed. Check the repository, connection, and local export configuration.' }, 500)
}

export async function GET(request: Request, { params }: { params: Promise<{ action: string[] }> }) {
  if (!checkOrigin(request)) return json({ error: 'Cross-origin request denied.' }, 403)
  try {
    await authenticated(request)
    const { action } = await params
    const path = action.join('/')
    const stored = readGitHubToken()
    if (path === 'account') return json({ connected: Boolean(stored), login: stored?.login ?? null })
    if (path === 'repositories') {
      if (!stored) return json({ error: 'Connect GitHub first.' }, 409)
      const { data } = await gh<Array<{ id: number; name: string; full_name: string; private: boolean; html_url: string; default_branch: string | null }>>(stored.token, '/user/repos?per_page=100&sort=updated&direction=desc')
      return json({ repositories: data.map(({ id, name, full_name, private: isPrivate, html_url, default_branch }) => ({ id, name, fullName: full_name, private: isPrivate, url: html_url, defaultBranch: default_branch })) })
    }
    return json({ error: 'Unknown GitHub action.' }, 404)
  } catch (error) { return githubProblem(error) }
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string[] }> }) {
  if (!checkOrigin(request)) return json({ error: 'Cross-origin request denied.' }, 403)
  try {
    const { payload, user } = await authenticated(request)
    const { action } = await params
    const path = action.join('/')
    if (path === 'connect') {
      const input = await body(request)
      if (typeof input.token !== 'string' || input.token.length < 20 || input.token.length > 500) return json({ error: 'A valid GitHub token is required.' }, 400)
      const { data: account } = await gh<{ login: string }>(input.token.trim(), '/user')
      saveGitHubToken(input.token.trim(), account.login)
      return json({ connected: true, login: account.login })
    }
    if (path === 'disconnect') { disconnectGitHub(); return json({ connected: false }) }
    const stored = readGitHubToken()
    if (!stored) return json({ error: 'Connect GitHub first.' }, 409)
    if (path === 'repositories') {
      const input = await body(request)
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) return json({ error: 'Repository name must be 1–100 letters, numbers, dots, dashes, or underscores.' }, 400)
      const { data } = await gh<{ id: number; name: string; full_name: string; private: boolean; html_url: string }>(stored.token, '/user/repos', { method: 'POST', body: JSON.stringify({ name, private: input.private !== false, auto_init: true, description: 'Website built with WebCraft' }) })
      return json({ repository: { id: data.id, name: data.name, fullName: data.full_name, private: data.private, url: data.html_url } }, 201)
    }
    if (path === 'push') {
      const input = await body(request)
      const projectId = String(input.projectId ?? '')
      const fullName = String(input.repository ?? '')
      if (!/^[A-Za-z0-9_-]+$/.test(projectId) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return json({ error: 'Project or repository identifier is invalid.' }, 400)
      if (fullName.toLowerCase() === 'nmdevteam/nmdevteam') return json({ error: 'The profile repository is protected and cannot be used as a WebCraft export target.' }, 403)
      const { files, projectName } = await projectExport(payload, projectId, user)
      await validateGeneratedSource(files)
      const { data: repo } = await gh<{ default_branch: string | null; html_url: string }>(stored.token, `/repos/${fullName}`)
      const branch = repo.default_branch || 'main'
      let baseCommit: string | null = null
      try {
        const { data: ref } = await gh<{ object: { sha: string } }>(stored.token, `/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`)
        baseCommit = ref.object.sha
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('HTTP 404')) throw error
      }
      let baseTree: string | undefined
      if (baseCommit) {
        const { data: commit } = await gh<{ tree: { sha: string } }>(stored.token, `/repos/${fullName}/git/commits/${baseCommit}`)
        baseTree = commit.tree.sha
      }
      const entries = await Promise.all(Object.entries(files).map(async ([filePath, file]: [string, GeneratedFile]) => {
        const content = file.encoding === 'base64' ? file.content : Buffer.from(file.content, 'utf8').toString('base64')
        const { data: blob } = await gh<{ sha: string }>(stored.token, `/repos/${fullName}/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) })
        return { path: filePath, mode: '100644', type: 'blob', sha: blob.sha }
      }))
      const { data: tree } = await gh<{ sha: string }>(stored.token, `/repos/${fullName}/git/trees`, { method: 'POST', body: JSON.stringify({ ...(baseTree ? { base_tree: baseTree } : {}), tree: entries }) })
      const { data: commit } = await gh<{ sha: string }>(stored.token, `/repos/${fullName}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `WebCraft export: ${projectName.slice(0, 100)}`, tree: tree.sha, ...(baseCommit ? { parents: [baseCommit] } : {}) }) })
      if (baseCommit) await gh(stored.token, `/repos/${fullName}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) })
      else await gh(stored.token, `/repos/${fullName}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) })
      return json({ success: true, commit: commit.sha, url: repo.html_url, branch, pushedAt: new Date().toISOString() })
    }
    return json({ error: 'Unknown GitHub action.' }, 404)
  } catch (error) { return githubProblem(error) }
}
