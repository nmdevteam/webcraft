import { NextResponse } from 'next/server'
import { authenticateMarketplaceRequest, marketplaceError, packageSummary, parseMarketplacePackage, readBoundedJson } from '../../../../../lib/marketplace-route'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  const url = new URL(request.url)
  const page = Math.max(1, Math.min(10_000, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1))
  const limit = Math.max(1, Math.min(50, Number.parseInt(url.searchParams.get('limit') ?? '24', 10) || 24))
  const type = url.searchParams.get('type') ?? ''
  const category = (url.searchParams.get('category') ?? '').trim().slice(0, 80)
  const query = (url.searchParams.get('q') ?? '').trim().replace(/[%_]/g, '').slice(0, 80)
  const favoriteOnly = url.searchParams.get('favoriteOnly') === 'true'
  if (type && type !== 'component' && type !== 'template') return NextResponse.json({ error: 'Invalid marketplace type.' }, { status: 400 })

  try {
    const favorites = await payload.find({
      collection: 'marketplace-favorites', where: { owner: { equals: user.id } }, limit: 200, depth: 0, user, overrideAccess: false,
    })
    const favoriteIds = new Set(favorites.docs.map((item: any) => String(item.packageId)))
    const clauses: any[] = [{ or: [{ owner: { equals: user.id } }, { published: { equals: true } }] }]
    if (type) clauses.push({ type: { equals: type } })
    if (category) clauses.push({ category: { equals: category } })
    if (query) clauses.push({ or: [{ name: { like: `%${query}%` } }, { description: { like: `%${query}%` } }, { category: { like: `%${query}%` } }] })
    if (favoriteOnly) {
      if (!favoriteIds.size) return NextResponse.json({ docs: [], totalDocs: 0, page, limit, totalPages: 0 })
      clauses.push({ id: { in: [...favoriteIds] } })
    }
    const result = await payload.find({
      collection: 'marketplace-packages', where: { and: clauses }, limit, page, depth: 0, sort: '-updatedAt', user, overrideAccess: false,
    })
    return NextResponse.json({
      docs: result.docs.map((doc: any) => packageSummary(doc, favoriteIds)),
      totalDocs: result.totalDocs, page: result.page, limit: result.limit, totalPages: result.totalPages,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return marketplaceError(error, 'Could not load marketplace packages.') }
}

export async function POST(request: Request) {
  const auth = await authenticateMarketplaceRequest(request)
  if ('response' in auth) return auth.response
  const { payload, user } = auth
  try {
    const body = await readBoundedJson(request) as any
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'A package object is required.' }, { status: 400 })
    const packageData = parseMarketplacePackage(body.package)
    if (body.published !== undefined && typeof body.published !== 'boolean') return NextResponse.json({ error: 'published must be true or false.' }, { status: 400 })
    const doc = await payload.create({
      collection: 'marketplace-packages',
      data: { type: packageData.type, packageData, published: body.published ?? false, owner: user.id } as any,
      user, overrideAccess: true,
    })
    return NextResponse.json({ package: packageSummary(doc) }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return marketplaceError(error, 'Could not import the marketplace package.') }
}
