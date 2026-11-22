import { NextResponse } from 'next/server'
import { restoreProjectVersion } from '../../../../../../../../lib/project-history'
import { authenticateProjectHistoryRequest, validHistoryId } from '../../../../../../../../lib/project-history-route'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ projectId: string; versionId: string }> }) {
  const auth = await authenticateProjectHistoryRequest(request)
  if ('response' in auth) return auth.response
  const { projectId, versionId } = await context.params
  if (!validHistoryId(projectId) || !validHistoryId(versionId)) return NextResponse.json({ error: 'Invalid history ID.' }, { status: 400 })
  try {
    await restoreProjectVersion(auth.payload, projectId, versionId, auth.user)
    return NextResponse.json({ restored: true })
  } catch (error) {
    if (error instanceof Error && /Version not found for this project/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json({ error: 'Could not restore this version. A pre-restore snapshot was preserved when possible.' }, { status: 400 })
  }
}
