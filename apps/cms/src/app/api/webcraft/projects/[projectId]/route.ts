import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 })
  }

  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })

  const { projectId } = await context.params
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(projectId)) return NextResponse.json({ error: 'Invalid project ID.' }, { status: 400 })

  try {
    await payload.findByID({ collection: 'projects', id: projectId, user, overrideAccess: false })
  } catch {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  }

  try {
    const transactionID = await payload.db?.beginTransaction?.()
    if (transactionID === null || transactionID === undefined) {
      return NextResponse.json({ error: 'Atomic project deletion is unavailable.' }, { status: 503 })
    }
    try {
      await payload.findByID({ collection: 'projects', id: projectId, user, overrideAccess: false, req: { transactionID } })
      for (const collection of ['pages', 'assets', 'asset-folders', 'project-versions', 'installed-components'] as const) {
        while (true) {
          const batch = await payload.find({
            collection,
            where: { project: { equals: projectId } },
            limit: 50,
            depth: 0,
            user,
            overrideAccess: false,
            req: { transactionID },
          })
          if (batch.docs.length === 0) break
          for (const doc of batch.docs) {
            // Version records are immutable to API users; permit deletion only through this
            // owner-checked project cascade after the project itself was verified above.
            await payload.delete({ collection, id: doc.id, user, overrideAccess: collection === 'project-versions' || collection === 'installed-components', req: { transactionID } })
          }
        }
      }

      await payload.delete({ collection: 'projects', id: projectId, user, overrideAccess: false, req: { transactionID } })
      await payload.db.commitTransaction(transactionID)
      return NextResponse.json({ deleted: true })
    } catch (error) {
      await payload.db.rollbackTransaction(transactionID).catch(() => undefined)
      throw error
    }
  } catch {
    return NextResponse.json({ error: 'Project deletion failed.' }, { status: 500 })
  }
}
