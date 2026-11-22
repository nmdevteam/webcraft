import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { generateSource as createSource } from '@webcraft/core/exporter'

/** Build a standalone export only from pages and assets the signed-in owner can read. */
export async function projectExport(payload: any, projectId: string, user: any): Promise<{
  files: ReturnType<typeof createSource>
  projectName: string
  pageCount: number
}> {
  const project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user })
  const [pages, assets] = await Promise.all([
    payload.find({ collection: 'pages', where: { project: { equals: projectId } }, limit: 100, depth: 0, sort: 'slug', user }),
    payload.find({ collection: 'assets', where: { project: { equals: projectId } }, limit: 100, depth: 0, sort: 'createdAt', user }),
  ])
  if (!pages.docs.length) throw new Error('This project has no pages to export.')
  if (Number(pages.totalDocs ?? pages.docs.length) > 100) throw new Error('Exports support at most 100 pages per project.')
  if (Number(assets.totalDocs ?? assets.docs.length) > 100) throw new Error('Exports support at most 100 assets per project.')
  const mediaRoot = resolve(process.cwd(), '.webcraft/media')
  const exportAssets: { filename: string; contentBase64: string }[] = []
  let totalAssetBytes = 0
  for (const asset of assets.docs as any[]) {
    const filename = String(asset.filename ?? '')
    if (basename(filename) !== filename || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(png|jpe?g|webp|gif)$/i.test(filename)) throw new Error('An uploaded asset has an unsafe filename.')
    const path = resolve(mediaRoot, filename)
    if (!path.startsWith(`${mediaRoot}/`)) throw new Error('An uploaded asset path is invalid.')
    const buffer = await readFile(path)
    if (buffer.byteLength > 5 * 1024 * 1024) throw new Error('An uploaded asset exceeds the 5 MB limit.')
    totalAssetBytes += buffer.byteLength
    if (totalAssetBytes > 5 * 1024 * 1024) throw new Error('Uploaded images exceed the 5 MB combined export limit.')
    exportAssets.push({ filename, contentBase64: buffer.toString('base64') })
  }
  const files = createSource({
    name: String(project.name),
    settings: project.settings,
    pages: pages.docs.map((page: any) => ({
      title: page.title,
      slug: page.slug,
      isHome: page.isHome,
      seoTitle: page.seoTitle ?? undefined,
      seoDescription: page.seoDescription ?? undefined,
      nodes: page.nodes,
    })),
  }, exportAssets)
  return { files, projectName: String(project.name), pageCount: pages.docs.length }
}
