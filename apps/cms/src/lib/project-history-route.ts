import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function authenticateProjectHistoryRequest(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return { response: NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 }) } as const
  }
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return { response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) } as const
  return { payload, user } as const
}

export function validHistoryId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

export function asHistoryError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  if (/not found|supports up to|invalid|must be|exceeds|limit/i.test(error.message)) return error.message.slice(0, 240)
  return fallback
}
