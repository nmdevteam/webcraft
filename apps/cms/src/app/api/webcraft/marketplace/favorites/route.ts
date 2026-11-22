import { NextResponse } from 'next/server'
import { authenticateMarketplaceRequest, marketplaceError, packageSummary } from '../../../../../lib/marketplace-route'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  try {
    const favorites = await payload.find({ collection: 'marketplace-favorites', where: { owner: { equals: user.id } }, limit: 200, depth: 0, sort: '-updatedAt', user, overrideAccess: false })
    const packageIds = favorites.docs.map((item: any) => String(item.packageId))
    const packages = await Promise.all(packageIds.map(async (id: string) => {
      try { return await payload.findByID({ collection: 'marketplace-packages', id, depth: 0, user, overrideAccess: false }) }
      catch { return null }
    }))
    const docs = packages.filter(Boolean).map((doc: any) => packageSummary(doc, new Set([String(doc.id)])))
    return NextResponse.json({ docs, totalDocs: docs.length, limit: 200 }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return marketplaceError(error, 'Could not load marketplace favorites.') }
}
