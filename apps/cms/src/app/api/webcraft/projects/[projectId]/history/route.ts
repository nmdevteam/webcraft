import { NextResponse } from 'next/server'
import { VERSION_REASONS, type VersionReason } from '@webcraft/core/schema'
import { createProjectVersion } from '../../../../../../lib/project-history'
import { asHistoryError, authenticateProjectHistoryRequest, validHistoryId } from '../../../../../../lib/project-history-route'

export const dynamic = 'force-dynamic'

async function readBoundedJsonBody(request: Request, limit: number): Promise<{ raw: string; tooLarge: boolean; invalidEncoding: boolean }> {
  const reader = request.body?.getReader()
  if (!reader) return { raw: '', tooLarge: false, invalidEncoding: false }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => undefined)
        return { raw: '', tooLarge: true, invalidEncoding: false }
      }
      chunks.push(value)
    }
  } catch {
    return { raw: '', tooLarge: false, invalidEncoding: true }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { raw: new TextDecoder('utf-8', { fatal: true }).decode(bytes), tooLarge: false, invalidEncoding: false }
  } catch {
    return { raw: '', tooLarge: false, invalidEncoding: true }
  }
}

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateProjectHistoryRequest(request)
  if ('response' in auth) return auth.response
  const { projectId } = await context.params
  if (!validHistoryId(projectId)) return NextResponse.json({ error: 'Invalid project ID.' }, { status: 400 })
  try {
    await auth.payload.findByID({ collection: 'projects', id: projectId, user: auth.user, overrideAccess: false })
    const requestedPage = Number(new URL(request.url).searchParams.get('page') ?? '1')
    const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 1000 ? requestedPage : 1
    const result = await auth.payload.find({
      collection: 'project-versions',
      where: { project: { equals: projectId } },
      limit: 50,
      page,
      sort: '-createdAt',
      depth: 0,
      select: { id: true, label: true, reason: true, pageCount: true, createdAt: true },
      user: auth.user,
      overrideAccess: false,
    })
    return NextResponse.json({ versions: result.docs, page, totalPages: Number(result.totalPages ?? 1), totalDocs: Number(result.totalDocs ?? result.docs.length) })
  } catch {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateProjectHistoryRequest(request)
  if ('response' in auth) return auth.response
  const { projectId } = await context.params
  if (!validHistoryId(projectId)) return NextResponse.json({ error: 'Invalid project ID.' }, { status: 400 })
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/i.test(contentType.trim())) return NextResponse.json({ error: 'Content-Type must be application/json.' }, { status: 415 })
  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > 4096) return NextResponse.json({ error: 'History request is too large.' }, { status: 413 })
  const bodyResult = await readBoundedJsonBody(request, 4096)
  if (bodyResult.tooLarge) return NextResponse.json({ error: 'History request is too large.' }, { status: 413 })
  if (bodyResult.invalidEncoding) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  let body: any = {}
  try { body = bodyResult.raw ? JSON.parse(bodyResult.raw) : {} } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid history request.' }, { status: 400 })
  const reason: VersionReason = body.reason
  if (!VERSION_REASONS.includes(reason) || reason === 'before-restore') return NextResponse.json({ error: 'Invalid snapshot reason.' }, { status: 400 })
  if (body.label !== undefined && (typeof body.label !== 'string' || body.label.length > 200)) return NextResponse.json({ error: 'Snapshot labels must be 200 characters or fewer.' }, { status: 400 })

  try {
    await auth.payload.findByID({ collection: 'projects', id: projectId, user: auth.user, overrideAccess: false })
    const result = await createProjectVersion(auth.payload, projectId, auth.user, reason, body.label)
    return NextResponse.json({
      version: result.version ? { id: result.version.id, label: result.version.label, reason: result.version.reason, createdAt: result.version.createdAt, pageCount: result.version.pageCount } : null,
      created: result.created,
      skipped: result.skipped,
    }, { status: result.created ? 201 : 200 })
  } catch (error) {
    return NextResponse.json({ error: asHistoryError(error, 'Could not create a project snapshot.') }, { status: 400 })
  }
}
