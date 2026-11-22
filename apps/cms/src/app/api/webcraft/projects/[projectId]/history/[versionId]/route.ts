import { NextResponse } from 'next/server'
import { ProjectVersionSnapshotSchema } from '@webcraft/core/schema'
import { authenticateProjectHistoryRequest, validHistoryId } from '../../../../../../../lib/project-history-route'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ projectId: string; versionId: string }> }) {
  const auth = await authenticateProjectHistoryRequest(request)
  if ('response' in auth) return auth.response
  const { projectId, versionId } = await context.params
  if (!validHistoryId(projectId) || !validHistoryId(versionId)) return NextResponse.json({ error: 'Invalid history ID.' }, { status: 400 })
  try {
    await auth.payload.findByID({ collection: 'projects', id: projectId, user: auth.user, overrideAccess: false })
    const version = await auth.payload.findByID({ collection: 'project-versions', id: versionId, depth: 0, user: auth.user, overrideAccess: false })
    const ownerProjectId = version.project && typeof version.project === 'object' ? String(version.project.id) : String(version.project)
    if (ownerProjectId !== projectId) return NextResponse.json({ error: 'Version not found for this project.' }, { status: 404 })
    const snapshot = ProjectVersionSnapshotSchema.parse(version.snapshot)
    return NextResponse.json({ version: { id: version.id, label: version.label, reason: version.reason, pageCount: version.pageCount, createdAt: version.createdAt, snapshot } })
  } catch {
    return NextResponse.json({ error: 'Version not found for this project.' }, { status: 404 })
  }
}
