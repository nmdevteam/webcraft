import { getPayload } from 'payload'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import config from '@payload-config'
import { generateSource } from '@webcraft/core/exporter'
import { validateGeneratedSource } from '../../../../../lib/export-validation'

export const dynamic = 'force-dynamic'
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
function originAllowed(request: Request) {
  const origin = request.headers.get('origin')
  return !origin || origin === (process.env.BUILDER_ORIGIN ?? 'http://127.0.0.1:5173') || origin === 'http://localhost:5173'
}
export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: 'Cross-origin request denied.' }, 403)
  try {
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > 16_000) return json({ error: 'Request is too large.' }, 413)
    const text = await request.text()
    if (Buffer.byteLength(text) > 16_000) return json({ error: 'Request is too large.' }, 413)
    const input = JSON.parse(text) as { projectId?: unknown }
    const projectId = String(input.projectId ?? '')
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(projectId)) return json({ error: 'Invalid project identifier.' }, 400)
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })
    if (!user) return json({ error: 'Sign in again before validating an export.' }, 401)
    const project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user })
    const [pages, assetResult] = await Promise.all([
      payload.find({ collection: 'pages', where: { project: { equals: projectId } }, limit: 100, depth: 0, sort: 'slug', user }),
      payload.find({ collection: 'assets', where: { project: { equals: projectId } }, limit: 100, depth: 0, user }),
    ])
    if (!pages.docs.length) return json({ error: 'This project needs at least one page before it can be exported.' }, 400)
    const mediaRoot = resolve(process.cwd(), 'public/media')
    const assets = await Promise.all(assetResult.docs.map(async (asset) => {
      const filename = String(asset.filename ?? '')
      if (basename(filename) !== filename || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(png|jpe?g|webp|gif)$/i.test(filename)) throw new Error('An uploaded asset has an unsafe filename.')
      const path = resolve(mediaRoot, filename)
      if (!path.startsWith(`${mediaRoot}/`)) throw new Error('An uploaded asset path is invalid.')
      const buffer = await readFile(path)
      if (buffer.byteLength > 5 * 1024 * 1024) throw new Error('An uploaded asset exceeds the 5 MB limit.')
      return { filename, contentBase64: buffer.toString('base64') }
    }))
    const files = generateSource({ name: project.name, settings: project.settings, pages: pages.docs.map((page) => ({ title: page.title, slug: page.slug, isHome: page.isHome, seoTitle: page.seoTitle ?? undefined, seoDescription: page.seoDescription ?? undefined, nodes: page.nodes as never })) }, assets)
    const result = await validateGeneratedSource(files)
    return json(result)
  } catch (error) {
    if (error instanceof Error && /not found|unauthorized|does not exist/i.test(error.message)) return json({ error: 'This project is unavailable.' }, 404)
    if (error instanceof Error && /^(Export|Generated project|A project|An uploaded)/.test(error.message)) return json({ error: error.message.replace(/\s+/g, ' ').slice(0, 900) }, 422)
    return json({ error: 'Export validation failed. Check the project data, uploaded images, and local build environment.' }, 422)
  }
}
