import { constants as fsConstants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { generateSource as createSource } from '@webcraft/core/exporter'

export const MAX_EXPORT_ASSETS = 100
export const MAX_ASSET_BYTES = 5 * 1024 * 1024
export const MAX_COMBINED_ASSET_BYTES = 5 * 1024 * 1024

const ASSET_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(png|jpe?g|webp|gif)$/i

/** Read persisted assets sequentially, applying the same bounded policy to every export target. */
export async function readProjectExportAssets(assets: readonly any[], mediaRoot = resolve(process.cwd(), '.webcraft/media')) {
  if (assets.length > MAX_EXPORT_ASSETS) throw new Error('Exports support at most 100 assets per project.')
  mediaRoot = resolve(/*turbopackIgnore: true*/ mediaRoot)
  if (assets.length) {
    const rootStat = await lstat(mediaRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await realpath(/*turbopackIgnore: true*/ mediaRoot) !== mediaRoot) throw new Error('The uploaded asset storage directory is not safe.')
  }
  const exportAssets: { filename: string; contentBase64: string }[] = []
  const filenames = new Set<string>()
  let totalAssetBytes = 0

  for (const asset of assets) {
    const filename = String(asset.filename ?? '')
    if (basename(filename) !== filename || !ASSET_FILENAME.test(filename)) throw new Error('An uploaded asset has an unsafe filename.')
    const normalizedFilename = filename.toLowerCase()
    if (filenames.has(normalizedFilename)) throw new Error('Duplicate asset filename in export.')
    filenames.add(normalizedFilename)
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(filename.split('.')[0]!.toUpperCase())) throw new Error('An uploaded asset has a non-portable filename.')
    const path = resolve(mediaRoot, filename)
    const relativePath = relative(mediaRoot, path)
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error('An uploaded asset path is invalid.')
    const handle = await open(/*turbopackIgnore: true*/ path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    let buffer: Buffer
    try {
      const fileStat = await handle.stat()
      if (!fileStat.isFile()) throw new Error('An uploaded asset is not a regular file.')
      if (fileStat.size > MAX_ASSET_BYTES) throw new Error('An uploaded asset exceeds the 5 MB limit.')
      buffer = await handle.readFile()
    } finally { await handle.close() }
    if (buffer.byteLength > MAX_ASSET_BYTES) throw new Error('An uploaded asset exceeds the 5 MB limit.')
    totalAssetBytes += buffer.byteLength
    if (totalAssetBytes > MAX_COMBINED_ASSET_BYTES) throw new Error('Uploaded images exceed the 5 MB combined export limit.')
    exportAssets.push({ filename, contentBase64: buffer.toString('base64') })
  }
  return exportAssets
}

/** Build a standalone export only from pages and assets the signed-in owner can read. */
export async function projectExport(payload: any, projectId: string, user: any): Promise<{
  files: ReturnType<typeof createSource>
  projectName: string
  pageCount: number
  settings: unknown
}> {
  const project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false })
  const [pages, assets] = await Promise.all([
    payload.find({ collection: 'pages', where: { project: { equals: projectId } }, limit: MAX_EXPORT_ASSETS, depth: 0, sort: 'slug', user, overrideAccess: false }),
    payload.find({ collection: 'assets', where: { project: { equals: projectId } }, limit: MAX_EXPORT_ASSETS, depth: 0, sort: 'createdAt', user, overrideAccess: false }),
  ])
  if (!pages.docs.length) throw new Error('This project has no pages to export.')
  if (Number(pages.totalDocs ?? pages.docs.length) > MAX_EXPORT_ASSETS) throw new Error('Exports support at most 100 pages per project.')
  if (Number(assets.totalDocs ?? assets.docs.length) > MAX_EXPORT_ASSETS) throw new Error('Exports support at most 100 assets per project.')

  const exportAssets = await readProjectExportAssets(assets.docs)
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
  return { files, projectName: String(project.name), pageCount: pages.docs.length, settings: project.settings }
}
