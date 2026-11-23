import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ComponentPackageSchema, MarketplacePackageSchema, referencedMediaFilenames, TemplatePackageSchema, type MarketplaceAsset } from '@webcraft/core/marketplace'
import { ProjectSettingsSchema, validateTree } from '@webcraft/core/schema'
import { MarketplaceApiError } from './marketplace-route'
import { getMediaStorageRoot, isPathWithin } from './storage-paths'

const MAX_PACKAGE_ASSETS = 5 * 1024 * 1024
const safeFilename = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif)$/i

function mimeFor(filename: string, declared: unknown): MarketplaceAsset['mimeType'] {
  if (declared === 'image/png' || declared === 'image/jpeg' || declared === 'image/webp' || declared === 'image/gif') return declared
  if (/\.png$/i.test(filename)) return 'image/png'
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg'
  if (/\.webp$/i.test(filename)) return 'image/webp'
  if (/\.gif$/i.test(filename)) return 'image/gif'
  throw new MarketplaceApiError('A referenced project asset has an unsupported image type.')
}

function validateSignature(buffer: Buffer, mimeType: MarketplaceAsset['mimeType']) {
  const valid = mimeType === 'image/png'
    ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === 'image/jpeg'
      ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : mimeType === 'image/gif'
        ? buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
        : buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!valid) throw new MarketplaceApiError('A referenced image does not match its declared file type.')
}

async function packageAssets(payload: any, user: any, projectId: string, references: Set<string>): Promise<MarketplaceAsset[]> {
  if (!references.size) return []
  const records = await payload.find({ collection: 'assets', where: { project: { equals: projectId } }, limit: 100, depth: 0, user, overrideAccess: false })
  if (Number(records.totalDocs ?? records.docs.length) > 100) throw new MarketplaceApiError('Packages can use assets from projects with at most 100 uploaded files.')
  const byFilename = new Map<string, any>()
  for (const record of records.docs as any[]) byFilename.set(String(record.filename ?? ''), record)
  const mediaRoot = getMediaStorageRoot()
  const assets: MarketplaceAsset[] = []
  let totalBytes = 0
  for (const filename of references) {
    if (!safeFilename.test(filename) || basename(filename) !== filename) throw new MarketplaceApiError('A project contains an unsafe image filename.')
    const record = byFilename.get(filename)
    if (!record) throw new MarketplaceApiError(`Referenced image “${filename}” is not owned by this project.`)
    const filePath = resolve(mediaRoot, filename)
    if (!isPathWithin(mediaRoot, filePath)) throw new MarketplaceApiError('A project image path is invalid.')
    const buffer = await readFile(filePath)
    if (buffer.byteLength > 5 * 1024 * 1024) throw new MarketplaceApiError('A project image exceeds the 5 MB package limit.')
    totalBytes += buffer.byteLength
    if (totalBytes > MAX_PACKAGE_ASSETS) throw new MarketplaceApiError('Referenced images exceed the 5 MB combined package limit.')
    const mimeType = mimeFor(filename, record.mimeType)
    validateSignature(buffer, mimeType)
    assets.push({ filename, mimeType, contentBase64: buffer.toString('base64') })
  }
  return assets
}

function findNode(nodes: any[], id: string): any | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children ?? [], id)
    if (found) return found
  }
  return undefined
}

function validText(value: unknown, name: string, max: number, required = true): string {
  if (typeof value !== 'string') throw new MarketplaceApiError(`${name} must be text.`)
  const result = value.trim()
  if ((required && !result) || result.length > max) throw new MarketplaceApiError(`${name} must be ${required ? '1–' : 'at most '}${max} characters.`)
  return result
}

export async function buildPackageFromProject(payload: any, user: any, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MarketplaceApiError('A project package request is required.')
  const body = input as Record<string, unknown>
  const type = body.type
  if (type !== 'component' && type !== 'template') throw new MarketplaceApiError('Package type must be component or template.')
  const projectId = typeof body.projectId === 'string' || typeof body.projectId === 'number' ? String(body.projectId) : ''
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(projectId)) throw new MarketplaceApiError('Invalid project ID.')
  const project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false })
  const pageResult = await payload.find({ collection: 'pages', where: { project: { equals: projectId } }, limit: 100, depth: 0, sort: 'slug', user, overrideAccess: false })
  if (!pageResult.docs.length) throw new MarketplaceApiError('This project has no pages to package.')
  if (Number(pageResult.totalDocs ?? pageResult.docs.length) > 100) throw new MarketplaceApiError('Packages support at most 100 project pages.')
  const pages = (pageResult.docs as any[]).map((page) => ({
    title: page.title, slug: page.slug, isHome: Boolean(page.isHome),
    ...(page.seoTitle ? { seoTitle: page.seoTitle } : {}),
    ...(page.seoDescription ? { seoDescription: page.seoDescription } : {}),
    nodes: validateTree(page.nodes),
  }))
  const name = validText(body.name, 'Package name', 120)
  const description = validText(body.description ?? '', 'Description', 1000, false)
  const category = validText(body.category, 'Category', 80)
  const common = {
    format: 'webcraft', formatVersion: 1, packageId: `${type}-${randomUUID().slice(0, 8)}`,
    name, description, version: '1.0.0', license: 'CC BY 4.0', compatibility: { minBuilderVersion: '0.1.0' },
  }
  if (type === 'template') {
    const settings = ProjectSettingsSchema.parse(project.settings)
    const references = referencedMediaFilenames({ settings, pages })
    const pkg = TemplatePackageSchema.parse({ ...common, type, category, settings, pages, assets: await packageAssets(payload, user, projectId, references) })
    return pkg
  }

  const selected = body.selected
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 20) throw new MarketplaceApiError('Select between 1 and 20 components to package.')
  const pageById = new Map((pageResult.docs as any[]).map((page) => [String(page.id), page]))
  const components: any[] = []
  const references = new Set<string>()
  const seen = new Set<string>()
  for (const [index, selection] of selected.entries()) {
    if (!selection || typeof selection !== 'object') throw new MarketplaceApiError('Each component selection must include a page and component ID.')
    const item = selection as Record<string, unknown>
    const pageId = typeof item.pageId === 'string' || typeof item.pageId === 'number' ? String(item.pageId) : ''
    const nodeId = typeof item.nodeId === 'string' ? item.nodeId : ''
    if (!pageById.has(pageId) || !/^[A-Za-z0-9_-]{1,80}$/.test(nodeId)) throw new MarketplaceApiError('A selected component is not part of this project.')
    if (seen.has(`${pageId}:${nodeId}`)) throw new MarketplaceApiError('Do not select the same component more than once.')
    seen.add(`${pageId}:${nodeId}`)
    const page = pageById.get(pageId)!
    const node = findNode(page.nodes, nodeId)
    if (!node) throw new MarketplaceApiError('A selected component could not be found on its project page.')
    const entryNodes = validateTree([structuredClone(node)])
    referencedMediaFilenames(entryNodes, references)
    components.push({
      id: `component-${index + 1}-${randomUUID().slice(0, 6)}`,
      name: validText(item.name ?? node.type, 'Component name', 80),
      description: validText(item.description ?? '', 'Component description', 500, false),
      nodes: entryNodes,
    })
  }
  const pkg = ComponentPackageSchema.parse({ ...common, type, category, components, assets: await packageAssets(payload, user, projectId, references) })
  return MarketplacePackageSchema.parse(pkg)
}
