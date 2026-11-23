import { basename } from 'node:path'
import { generateSource as createSource } from '@webcraft/core/exporter'
import { MAX_PRIVATE_MEDIA_BYTES, readPrivateMediaBuffer, validatePwaIconDimensions } from './pwa-icons'

export const MAX_EXPORT_ASSETS = 100
export const MAX_ASSET_BYTES = MAX_PRIVATE_MEDIA_BYTES
export const MAX_COMBINED_ASSET_BYTES = 5 * 1024 * 1024
const ASSET_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(png|jpe?g|webp|gif)$/i

type TransactionID = string | number

/** Read persisted assets sequentially, applying the same bounded policy to every export target. */
export async function readProjectExportAssets(assets: readonly any[], mediaRoot?: string) {
  if (assets.length > MAX_EXPORT_ASSETS) throw new Error('Exports support at most 100 assets per project.')
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
    const buffer = await readPrivateMediaBuffer(filename, mediaRoot)
    if (buffer.byteLength > MAX_ASSET_BYTES) throw new Error('An uploaded asset exceeds the 5 MB limit.')
    totalAssetBytes += buffer.byteLength
    if (totalAssetBytes > MAX_COMBINED_ASSET_BYTES) throw new Error('Uploaded images exceed the 5 MB combined export limit.')
    exportAssets.push({ filename, contentBase64: buffer.toString('base64') })
  }
  return exportAssets
}

/**
 * Build an owner-scoped export from a PostgreSQL repeatable-read snapshot.
 * PostgreSQL cannot snapshot the separate local media directory; missing, unsafe,
 * or invalid files fail the operation rather than returning a partial export.
 */
export async function projectExport(payload: any, projectId: string, user: any): Promise<{
  files: ReturnType<typeof createSource>
  projectName: string
  pageCount: number
  settings: unknown
}> {
  const transactionID: TransactionID | null | undefined = await payload.db?.beginTransaction?.({
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  })
  if (transactionID === null || transactionID === undefined) throw new Error('A consistent export snapshot is unavailable.')

  try {
    const transaction = { req: { transactionID } }
    const project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false, ...transaction })
    const [pages, assets] = await Promise.all([
      payload.find({ collection: 'pages', where: { project: { equals: projectId } }, limit: MAX_EXPORT_ASSETS + 1, depth: 0, sort: 'slug', user, overrideAccess: false, ...transaction }),
      payload.find({ collection: 'assets', where: { project: { equals: projectId } }, limit: MAX_EXPORT_ASSETS + 1, depth: 0, sort: 'createdAt', user, overrideAccess: false, ...transaction }),
    ])
    if (!pages.docs.length) throw new Error('This project has no pages to export.')
    if (Number(pages.totalDocs ?? pages.docs.length) > MAX_EXPORT_ASSETS || pages.docs.length > MAX_EXPORT_ASSETS) throw new Error('Exports support at most 100 pages per project.')
    if (Number(assets.totalDocs ?? assets.docs.length) > MAX_EXPORT_ASSETS || assets.docs.length > MAX_EXPORT_ASSETS) throw new Error('Exports support at most 100 assets per project.')

    const settings = project.settings
    await validatePwaIconDimensions((settings as any)?.pwa, assets.docs)
    const exportAssets = await readProjectExportAssets(assets.docs)
    const files = createSource({
      name: String(project.name),
      settings,
      pages: pages.docs.map((page: any) => ({
        title: page.title,
        slug: page.slug,
        isHome: page.isHome,
        seoTitle: page.seoTitle ?? undefined,
        seoDescription: page.seoDescription ?? undefined,
        nodes: page.nodes,
      })),
    }, exportAssets)
    await payload.db.commitTransaction(transactionID)
    return { files, projectName: String(project.name), pageCount: pages.docs.length, settings }
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID).catch(() => undefined)
    throw error
  }
}
