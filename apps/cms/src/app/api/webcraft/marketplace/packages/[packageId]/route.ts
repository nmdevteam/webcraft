import { NextResponse } from 'next/server'
import { authenticateMarketplaceRequest, marketplaceError, packageSummary, parseMarketplacePackage, readBoundedJson, validMarketplaceId } from '../../../../../../lib/marketplace-route'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ packageId: string }> }

export async function GET(request: Request, context: Context) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const { packageId } = await context.params
  if (!validMarketplaceId(packageId)) return NextResponse.json({ error: 'Invalid marketplace package ID.' }, { status: 400 })
  try {
    const doc = await payload.findByID({ collection: 'marketplace-packages', id: packageId, depth: 0, user, overrideAccess: false })
    const favorite = await payload.find({ collection: 'marketplace-favorites', where: { and: [{ owner: { equals: user.id } }, { packageId: { equals: packageId } }] }, limit: 1, depth: 0, user, overrideAccess: false })
    return NextResponse.json({ package: packageSummary(doc, new Set(favorite.docs.length ? [packageId] : [])), packageData: doc.packageData }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return marketplaceError(error, 'Could not load marketplace package.') }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const { packageId } = await context.params
  if (!validMarketplaceId(packageId)) return NextResponse.json({ error: 'Invalid marketplace package ID.' }, { status: 400 })
  try {
    const current = await payload.findByID({ collection: 'marketplace-packages', id: packageId, depth: 0, user, overrideAccess: false })
    if (String((current.owner as any)?.id ?? current.owner) !== String(user.id)) return NextResponse.json({ error: 'Only the package owner can manage this item.' }, { status: 403 })
    const body = await readBoundedJson(request) as any
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'A package update object is required.' }, { status: 400 })
    const packageData = body.package === undefined ? current.packageData : parseMarketplacePackage(body.package)
    if (packageData.type !== current.type) return NextResponse.json({ error: 'Package type cannot be changed.' }, { status: 400 })
    if (body.published !== undefined && typeof body.published !== 'boolean') return NextResponse.json({ error: 'published must be true or false.' }, { status: 400 })
    const updated = await payload.update({ collection: 'marketplace-packages', id: packageId, data: { type: packageData.type, packageData, published: body.published ?? current.published } as any, user, overrideAccess: true })
    return NextResponse.json({ package: packageSummary(updated) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return marketplaceError(error, 'Could not update marketplace package.') }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const { packageId } = await context.params
  if (!validMarketplaceId(packageId)) return NextResponse.json({ error: 'Invalid marketplace package ID.' }, { status: 400 })
  try {
    const current = await payload.findByID({ collection: 'marketplace-packages', id: packageId, depth: 0, user, overrideAccess: false })
    if (String((current.owner as any)?.id ?? current.owner) !== String(user.id)) return NextResponse.json({ error: 'Only the package owner can manage this item.' }, { status: 403 })
    const installed = await payload.find({ collection: 'installed-components', where: { sourcePackage: { equals: packageId } }, limit: 1, depth: 0, user, overrideAccess: true })
    if (installed.docs.length) return NextResponse.json({ error: 'Uninstall this component package from its projects before deleting it.' }, { status: 409 })
    const transactionID = await payload.db?.beginTransaction?.()
    if (transactionID === null || transactionID === undefined) return NextResponse.json({ error: 'Atomic package removal is unavailable.' }, { status: 503 })
    try {
      while (true) {
        const favorites = await payload.find({ collection: 'marketplace-favorites', where: { packageId: { equals: packageId } }, limit: 100, depth: 0, user, overrideAccess: true, req: { transactionID } })
        if (!favorites.docs.length) break
        for (const favorite of favorites.docs) await payload.delete({ collection: 'marketplace-favorites', id: favorite.id, user, overrideAccess: true, req: { transactionID } })
      }
      await payload.delete({ collection: 'marketplace-packages', id: packageId, user, overrideAccess: true, req: { transactionID } })
      await payload.db.commitTransaction(transactionID)
      return NextResponse.json({ deleted: true })
    } catch (error) {
      await payload.db.rollbackTransaction(transactionID).catch(() => undefined)
      throw error
    }
  } catch (error) { return marketplaceError(error, 'Could not delete marketplace package.') }
}
