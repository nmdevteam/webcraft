import { NextResponse } from 'next/server'
import { ComponentPackageSchema, missingDesignTokens, packageCompatibilityError } from '@webcraft/core/marketplace'
import { authenticateMarketplaceRequest, marketplaceError, readBoundedJson, validMarketplaceId } from '../../../../../../lib/marketplace-route'
import { createAssetReferenceMap, createProjectAssets, remapMediaReferences, removeCreatedAssetFiles, type CreatedMarketplaceAsset } from '../../../../../../lib/marketplace-install'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ projectId: string }> }

export async function GET(request: Request, context: Context) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const { projectId } = await context.params
  if (!validMarketplaceId(projectId)) return NextResponse.json({ error: 'Invalid project ID.' }, { status: 400 })
  try {
    await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false })
    const result = await payload.find({ collection: 'installed-components', where: { and: [{ owner: { equals: user.id } }, { project: { equals: projectId } }] }, limit: 100, depth: 0, sort: 'name', user, overrideAccess: false })
    return NextResponse.json({ docs: result.docs, totalDocs: result.totalDocs }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return marketplaceError(error, 'Could not load installed components.') }
}

export async function POST(request: Request, context: Context) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const { projectId } = await context.params
  if (!validMarketplaceId(projectId)) return NextResponse.json({ error: 'Invalid project ID.' }, { status: 400 })
  let createdFiles: CreatedMarketplaceAsset[] = []
  let transactionID: string | number | null | undefined
  try {
    const project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false })
    const body = await readBoundedJson(request, 4096) as any
    const packageId = typeof body?.packageId === 'string' ? body.packageId : ''
    if (!validMarketplaceId(packageId)) return NextResponse.json({ error: 'A valid marketplace package ID is required.' }, { status: 400 })
    const existing = await payload.find({ collection: 'installed-components', where: { and: [{ owner: { equals: user.id } }, { project: { equals: projectId } }, { sourcePackage: { equals: packageId } }] }, limit: 1, depth: 0, user, overrideAccess: false })
    if (existing.docs.length) return NextResponse.json({ installation: existing.docs[0], alreadyInstalled: true })
    const source = await payload.findByID({ collection: 'marketplace-packages', id: packageId, depth: 0, user, overrideAccess: false })
    if (source.type !== 'component') return NextResponse.json({ error: 'Only component packages can be installed in a project.' }, { status: 400 })
    const pkg = ComponentPackageSchema.parse(source.packageData)
    const compatibilityIssue = packageCompatibilityError(pkg)
    if (compatibilityIssue) return NextResponse.json({ error: compatibilityIssue }, { status: 422 })
    const missingTokens = missingDesignTokens(pkg.components, project.settings)
    if (missingTokens.length) return NextResponse.json({ error: `Add these design tokens to the project before installing: ${missingTokens.map((item) => `${item.group}:${item.id}`).join(', ')}.` }, { status: 422 })
    transactionID = await payload.db?.beginTransaction?.()
    if (transactionID === null || transactionID === undefined) return NextResponse.json({ error: 'Atomic component installation is unavailable.' }, { status: 503 })
    try {
      const references = createAssetReferenceMap(pkg.assets)
      createdFiles = await createProjectAssets(payload, user, project.id, pkg.assets, references, transactionID)
      const components = remapMediaReferences(pkg.components, references)
      const installation = await payload.create({
        collection: 'installed-components',
        data: { name: pkg.name, version: pkg.version, project: projectId, sourcePackage: packageId, components, owner: user.id } as any,
        user, overrideAccess: true, req: { transactionID },
      })
      await payload.db.commitTransaction(transactionID)
      return NextResponse.json({ installation, alreadyInstalled: false }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      await payload.db.rollbackTransaction(transactionID).catch(() => undefined)
      await removeCreatedAssetFiles(createdFiles)
      const raced = await payload.find({ collection: 'installed-components', where: { and: [{ owner: { equals: user.id } }, { project: { equals: projectId } }, { sourcePackage: { equals: packageId } }] }, limit: 1, depth: 0, user, overrideAccess: false }).catch(() => null)
      if (raced?.docs[0]) return NextResponse.json({ installation: raced.docs[0], alreadyInstalled: true }, { headers: { 'Cache-Control': 'no-store' } })
      throw error
    }
  } catch (error) {
    return marketplaceError(error, 'Could not install this component package.')
  }
}
