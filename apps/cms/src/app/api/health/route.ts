import { getPayload } from 'payload'
import config from '@payload-config'

export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    const payload = await getPayload({ config })
    await payload.find({ collection: 'users', limit: 1, depth: 0, overrideAccess: true })
    return Response.json({ status: 'ok', service: 'webcraft-cms' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ status: 'not-ready', service: 'webcraft-cms' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
