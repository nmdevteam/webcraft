import { NextResponse } from 'next/server'
import { analyzeWebsite } from '@webcraft/core/analysis'
import { projectExport } from '../../../../../../lib/project-export'
import { validateGeneratedSource } from '../../../../../../lib/export-validation'
import { authenticateProjectHistoryRequest, validHistoryId } from '../../../../../../lib/project-history-route'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateProjectHistoryRequest(request)
  if ('response' in auth) return auth.response
  const { projectId } = await context.params
  if (!validHistoryId(projectId)) return NextResponse.json({ error: 'Invalid project ID.' }, { status: 400 })
  try {
    const exported = await projectExport(auth.payload, projectId, auth.user)
    const validation = await validateGeneratedSource(exported.files)
    const generatedSite = JSON.parse(exported.files['src/site.json']?.content ?? '')
    const report = analyzeWebsite({
      projectName: exported.projectName,
      settings: exported.settings,
      pages: generatedSite.pages,
      files: exported.files,
      productionArtifacts: validation.productionArtifacts,
    })
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Could not analyze this project. Check its saved pages, settings, and uploaded assets.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }
}
