import { NextResponse } from 'next/server'
import { ComponentPackageSchema, missingDesignTokens, packageCompatibilityError } from '@webcraft/core/marketplace'
import { authenticateMarketplaceRequest, marketplaceError, validMarketplaceId } from '../../../../../../../lib/marketplace-route'
import { createAssetReferenceMap, createProjectAssets, remapMediaReferences, removeCreatedAssetFiles, type CreatedMarketplaceAsset } from '../../../../../../../lib/marketplace-install'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ projectId: string; installationId: string }> }

function relatedId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null && 'id' in value) return String((value as { id: string | number }).id)
  return ''
}

async function ownedInstallation(payload: any, user: any, projectId: string, installationId: string) {
  await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false })
  const installation = await payload.findByID({ collection: 'installed-components', id: installationId, depth: 0, user, overrideAccess: false })
  if (relatedId(installation.project) !== projectId) throw new Error('Installed component not found.')
  return installation
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const { projectId, installationId } = await context.params
  if (!validMarketplaceId(projectId) || !validMarketplaceId(installationId)) return NextResponse.json({ error: 'Invalid project or installation ID.' }, { status: 400 })
  let createdFiles: CreatedMarketplaceAsset[] = []
  let transactionID: string | number | null | undefined
  try {
    const installation = await ownedInstallation(payload, user, projectId, installationId)
    const sourcePackageId = relatedId(installation.sourcePackage)
    const project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false })
    const source = await payload.findByID({ collection: 'marketplace-packages', id: sourcePackageId, depth: 0, user, overrideAccess: false })
    if (source.type !== 'component') return NextResponse.json({ error: 'The source is no longer a component package.' }, { status: 409 })
    const pkg = ComponentPackageSchema.parse(source.packageData)
    const compatibilityIssue = packageCompatibilityError(pkg)
    if (compatibilityIssue) return NextResponse.json({ error: compatibilityIssue }, { status: 422 })
    const missingTokens = missingDesignTokens(pkg.components, project.settings)
    if (missingTokens.length) return NextResponse.json({ error: `Add these design tokens to the project before updating: ${missingTokens.map((item) => `${item.group}:${item.id}`).join(', ')}.` }, { status: 422 })
    if (String(installation.version) === pkg.version) return NextResponse.json({ installation, upToDate: true })
    transactionID = await payload.db?.beginTransaction?.()
    if (transactionID === null || transactionID === undefined) return NextResponse.json({ error: 'Atomic component updates are unavailable.' }, { status: 503 })
    try {
      const references = createAssetReferenceMap(pkg.assets)
      createdFiles = await createProjectAssets(payload, user, project.id, pkg.assets, references, transactionID)
      const updated = await payload.update({
        collection: 'installed-components', id: installationId,
        data: { name: pkg.name, version: pkg.version, components: remapMediaReferences(pkg.components, references) } as any,
        user, overrideAccess: true, req: { transactionID },
      })
      await payload.db.commitTransaction(transactionID)
      return NextResponse.json({ installation: updated, note: 'Previously imported images remain in this project’s Asset Manager.' }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      await payload.db.rollbackTransaction(transactionID).catch(() => undefined)
      await removeCreatedAssetFiles(createdFiles)
      throw error
    }
  } catch (error) { return marketplaceError(error, 'Could not update this installed component.') }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const { projectId, installationId } = await context.params
  if (!validMarketplaceId(projectId) || !validMarketplaceId(installationId)) return NextResponse.json({ error: 'Invalid project or installation ID.' }, { status: 400 })
  try {
    await ownedInstallation(payload, user, projectId, installationId)
    await payload.delete({ collection: 'installed-components', id: installationId, user, overrideAccess: true })
    return NextResponse.json({ uninstalled: true, note: 'Imported images remain in this project’s Asset Manager.' })
  } catch (error) { return marketplaceError(error, 'Could not uninstall this component.') }
}
