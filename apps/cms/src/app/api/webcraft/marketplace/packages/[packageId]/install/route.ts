import { NextResponse } from 'next/server'
import { ProjectSettingsSchema } from '@webcraft/core/schema'
import { TemplatePackageSchema, packageCompatibilityError } from '@webcraft/core/marketplace'
import { authenticateMarketplaceRequest, marketplaceError, validMarketplaceId } from '../../../../../../../lib/marketplace-route'
import { createAssetReferenceMap, createProjectAssets, remapMediaReferences, removeCreatedAssetFiles, type CreatedMarketplaceAsset } from '../../../../../../../lib/marketplace-install'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ packageId: string }> }

export async function POST(request: Request, context: Context) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const { packageId } = await context.params
  if (!validMarketplaceId(packageId)) return NextResponse.json({ error: 'Invalid marketplace package ID.' }, { status: 400 })
  let createdFiles: CreatedMarketplaceAsset[] = []
  let transactionID: string | number | null | undefined
  try {
    const record = await payload.findByID({ collection: 'marketplace-packages', id: packageId, depth: 0, user, overrideAccess: false })
    if (record.type !== 'template') return NextResponse.json({ error: 'Only template packages can create a project.' }, { status: 400 })
    const pkg = TemplatePackageSchema.parse(record.packageData)
    const compatibilityIssue = packageCompatibilityError(pkg)
    if (compatibilityIssue) return NextResponse.json({ error: compatibilityIssue }, { status: 422 })
    transactionID = await payload.db?.beginTransaction?.()
    if (transactionID === null || transactionID === undefined) return NextResponse.json({ error: 'Atomic template installation is unavailable.' }, { status: 503 })
    try {
      const references = createAssetReferenceMap(pkg.assets)
      const settings = ProjectSettingsSchema.parse(remapMediaReferences(pkg.settings, references))
      const project = await payload.create({
        collection: 'projects',
        data: { name: pkg.name, category: pkg.category, templateId: pkg.packageId, settings, owner: user.id } as any,
        user, overrideAccess: true, req: { transactionID },
      })
      createdFiles = await createProjectAssets(payload, user, project.id, pkg.assets, references, transactionID)
      for (const page of pkg.pages) {
        await payload.create({
          collection: 'pages',
          data: { ...remapMediaReferences(page, references), project: project.id, undoHistory: { past: [], future: [] } } as any,
          user, overrideAccess: true, req: { transactionID },
        })
      }
      await payload.db.commitTransaction(transactionID)
      return NextResponse.json({ projectId: String(project.id), projectName: pkg.name, pageCount: pkg.pages.length }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      await payload.db.rollbackTransaction(transactionID).catch(() => undefined)
      await removeCreatedAssetFiles(createdFiles)
      throw error
    }
  } catch (error) {
    console.error('Marketplace template installation failed:', error)
    return marketplaceError(error, 'Could not install this template.')
  }
}
