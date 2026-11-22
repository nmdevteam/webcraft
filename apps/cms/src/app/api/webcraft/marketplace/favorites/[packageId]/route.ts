import { NextResponse } from 'next/server'
import { authenticateMarketplaceRequest, marketplaceError, validMarketplaceId } from '../../../../../../lib/marketplace-route'

type Context = { params: Promise<{ packageId: string }> }
export const dynamic = 'force-dynamic'

export async function PUT(request: Request, context: Context) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const { packageId } = await context.params
  if (!validMarketplaceId(packageId)) return NextResponse.json({ error: 'Invalid marketplace package ID.' }, { status: 400 })
  try {
    const item = await payload.findByID({ collection: 'marketplace-packages', id: packageId, depth: 0, user, overrideAccess: false })
    const existing = await payload.find({ collection: 'marketplace-favorites', where: { and: [{ owner: { equals: user.id } }, { packageId: { equals: packageId } }] }, limit: 1, depth: 0, user, overrideAccess: false })
    if (existing.docs.length) return NextResponse.json({ favorite: true, id: String(existing.docs[0]!.id) })
    const saved = await payload.create({ collection: 'marketplace-favorites', data: { packageId, kind: item.type, owner: user.id } as any, user, overrideAccess: true })
    return NextResponse.json({ favorite: true, id: String(saved.id) }, { status: 201 })
  } catch (error) {
    const raced = await payload.find({ collection: 'marketplace-favorites', where: { and: [{ owner: { equals: user.id } }, { packageId: { equals: packageId } }] }, limit: 1, depth: 0, user, overrideAccess: false }).catch(() => null)
    if (raced?.docs[0]) return NextResponse.json({ favorite: true, id: String(raced.docs[0].id) })
    return marketplaceError(error, 'Could not save this marketplace favorite.')
  }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const { packageId } = await context.params
  if (!validMarketplaceId(packageId)) return NextResponse.json({ error: 'Invalid marketplace package ID.' }, { status: 400 })
  try {
    const existing = await payload.find({ collection: 'marketplace-favorites', where: { and: [{ owner: { equals: user.id } }, { packageId: { equals: packageId } }] }, limit: 10, depth: 0, user, overrideAccess: false })
    for (const favorite of existing.docs) await payload.delete({ collection: 'marketplace-favorites', id: favorite.id, user, overrideAccess: true })
    return NextResponse.json({ favorite: false })
  } catch (error) { return marketplaceError(error, 'Could not remove this marketplace favorite.') }
}
