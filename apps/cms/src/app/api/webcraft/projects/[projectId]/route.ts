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
  if (!/^[a-f\d]{24}$/i.test(projectId)) return NextResponse.json({ error: 'Invalid project ID.' }, { status: 400 })

  try {
    await payload.findByID({ collection: 'projects', id: projectId, user, overrideAccess: false })
  } catch {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  }

  try {
    for (const collection of ['pages', 'assets'] as const) {
      while (true) {
        const batch = await payload.find({
          collection,
          where: { project: { equals: projectId } },
          limit: 50,
          depth: 0,
          user,
          overrideAccess: false,
        })
        if (batch.docs.length === 0) break
        for (const doc of batch.docs) {
          await payload.delete({ collection, id: doc.id, user, overrideAccess: false })
        }
      }
    }

    await payload.delete({ collection: 'projects', id: projectId, user, overrideAccess: false })
    return NextResponse.json({ deleted: true })
  } catch {
    return NextResponse.json({ error: 'Project deletion failed.' }, { status: 500 })
  }
}
