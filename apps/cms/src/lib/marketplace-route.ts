import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { MarketplacePackageSchema, MAX_MARKETPLACE_PACKAGE_BYTES } from '@webcraft/core/marketplace'

export class MarketplaceApiError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

function validationMessages(error: unknown): string[] | null {
  if (!error || typeof error !== 'object' || !('issues' in error) || !Array.isArray((error as { issues: unknown }).issues)) return null
  return ((error as { issues: unknown[] }).issues).slice(0, 8).map((entry) => {
    const issue = entry && typeof entry === 'object' ? entry as { path?: unknown; message?: unknown } : {}
    const path = Array.isArray(issue.path) ? issue.path.map(String).join('.') : 'package'
    return `${path || 'package'}: ${typeof issue.message === 'string' ? issue.message : 'Invalid package data.'}`
  })
}

export async function authenticateMarketplaceRequest(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return { response: NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 }) } as const
  }
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return { response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) } as const
  return { payload, user } as const
}

export async function readBoundedJson(request: Request, maxBytes = MAX_MARKETPLACE_PACKAGE_BYTES): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new MarketplaceApiError('Send a JSON package.', 415)
  const declaredSize = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new MarketplaceApiError('The request exceeds the package size limit.', 413)
  if (!request.body) throw new MarketplaceApiError('A JSON request body is required.')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new MarketplaceApiError('The request exceeds the package size limit.', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new MarketplaceApiError('The request body is not valid JSON.')
  }
}

export function parseMarketplacePackage(value: unknown) {
  try { return MarketplacePackageSchema.parse(value) }
  catch (error) {
    const issues = validationMessages(error)
    if (issues) throw new MarketplaceApiError(issues.join('; '), 400)
    throw error
  }
}

export function packageSummary(doc: any, favoriteIds: Set<string> = new Set()) {
  const manifest = doc.packageData as Record<string, unknown> | undefined
  return {
    id: String(doc.id),
    packageId: typeof manifest?.packageId === 'string' ? manifest.packageId : '',
    type: doc.type,
    name: doc.name,
    description: doc.description ?? '',
    category: doc.category,
    version: doc.version,
    owner: typeof doc.owner === 'object' && doc.owner !== null ? String(doc.owner.id) : String(doc.owner ?? ''),
    published: Boolean(doc.published),
    favorite: favoriteIds.has(String(doc.id)),
    updatedAt: doc.updatedAt,
  }
}

export function validMarketplaceId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

export function marketplaceError(error: unknown, fallback = 'Marketplace request failed.') {
  if (error instanceof MarketplaceApiError) return NextResponse.json({ error: error.message }, { status: error.status })
  const details = validationMessages(error)
  if (details) {
    return NextResponse.json({ error: details.join('; ') }, { status: 400 })
  }
  const message = error instanceof Error ? error.message : ''
  if (/not found|unauthorized|authentication/i.test(message)) return NextResponse.json({ error: 'Marketplace item not found.' }, { status: 404 })
  return NextResponse.json({ error: fallback }, { status: 500 })
}
