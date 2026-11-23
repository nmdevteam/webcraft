import { getPayload } from 'payload'
import config from '@payload-config'
import { projectExport } from '../../../../../lib/project-export'
import { validateGeneratedSource } from '../../../../../lib/export-validation'

export const dynamic = 'force-dynamic'
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
function originAllowed(request: Request) {
  const origin = request.headers.get('origin')
  return !origin || origin === (process.env.BUILDER_ORIGIN ?? 'http://127.0.0.1:5173') || origin === 'http://localhost:5173'
}
class RequestBodyError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
async function readBoundedJson(request: Request, maxBytes = 16_000): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new RequestBodyError('Content-Type must be application/json.', 415)
  const declaredSize = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new RequestBodyError('Request is too large.', 413)
  if (!request.body) throw new RequestBodyError('A JSON request body is required.', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RequestBodyError('Request is too large.', 413)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))) }
  catch { throw new RequestBodyError('Request body is not valid JSON.', 400) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestBodyError('A JSON object is required.', 400)
  return parsed
}
export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: 'Cross-origin request denied.' }, 403)
  try {
    const input = await readBoundedJson(request) as { projectId?: unknown }
    const projectId = String(input.projectId ?? '')
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(projectId)) return json({ error: 'Invalid project identifier.' }, 400)
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })
    if (!user) return json({ error: 'Sign in again before validating an export.' }, 401)
    const { files } = await projectExport(payload, projectId, user)
    return json(await validateGeneratedSource(files))
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status)
    if (error instanceof Error && /not found|unauthorized|does not exist/i.test(error.message)) return json({ error: 'This project is unavailable.' }, 404)
    if (error instanceof Error && /^(Export|Generated project|A project|An uploaded|This project)/.test(error.message)) return json({ error: error.message.replace(/\s+/g, ' ').slice(0, 900) }, 422)
    return json({ error: 'Export validation failed. Check the project data, uploaded images, and local build environment.' }, 422)
  }
}
