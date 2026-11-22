import { NextResponse } from 'next/server'
import { authenticateMarketplaceRequest, marketplaceError, packageSummary, readBoundedJson } from '../../../../../../lib/marketplace-route'
import { buildPackageFromProject } from '../../../../../../lib/marketplace-package-builder'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  try {
    const body = await readBoundedJson(request, 32 * 1024) as any
    if (body?.published !== undefined && typeof body.published !== 'boolean') return NextResponse.json({ error: 'published must be true or false.' }, { status: 400 })
    const packageData = await buildPackageFromProject(payload, user, body)
    const doc = await payload.create({
      collection: 'marketplace-packages',
      data: { type: packageData.type, packageData, published: body.published ?? false, owner: user.id } as any,
      user, overrideAccess: true,
    })
    return NextResponse.json({ package: packageSummary(doc), packageData }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return marketplaceError(error, 'Could not create a package from this project.') }
}
