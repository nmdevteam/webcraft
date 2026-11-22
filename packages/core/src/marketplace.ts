import { z } from 'zod'
import { PageDataSchema, ProjectSettingsSchema, type BuilderNode, validateTree } from './schema'
import { TEMPLATE_CATEGORIES } from './templates'

export const MARKETPLACE_PACKAGE_FORMAT = 'webcraft'
export const MARKETPLACE_PACKAGE_VERSION = 1
export const CURRENT_BUILDER_VERSION = '0.1.0'
export const MAX_MARKETPLACE_ASSET_BYTES = 5 * 1024 * 1024
export const MAX_MARKETPLACE_PACKAGE_BYTES = 10 * 1024 * 1024

export const COMPONENT_MARKETPLACE_CATEGORIES = [
  'Navigation', 'Hero sections', 'Buttons', 'Cards', 'Pricing tables', 'Testimonials', 'Forms', 'Footers', 'Galleries', 'Dashboards', 'UI elements',
] as const
export type ComponentMarketplaceCategory = (typeof COMPONENT_MARKETPLACE_CATEGORIES)[number]

const semver = z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/, 'Use a semantic version such as 1.0.0')
const packageId = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Package IDs may contain letters, numbers, dots, underscores, and hyphens')
const plainText = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 'Text contains unsupported control characters')
const assetFilename = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif)$/i)
const assetMime = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function imageSignatureMatches(contentBase64: string, mimeType: z.infer<typeof assetMime>): boolean {
  try {
    const binary = atob(contentBase64)
    const header = Array.from(binary.slice(0, 12), (character) => character.charCodeAt(0))
    if (mimeType === 'image/png') return header.length >= 8 && header.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
    if (mimeType === 'image/jpeg') return header.length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255
    if (mimeType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(binary.slice(0, 6))
    return header.length >= 12 && binary.slice(0, 4) === 'RIFF' && binary.slice(8, 12) === 'WEBP'
  } catch { return false }
}

export const MarketplaceAssetSchema = z.object({
  filename: assetFilename,
  mimeType: assetMime,
  contentBase64: z.string().min(1).max(7_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'Asset data must be valid base64'),
}).strict().superRefine((asset, ctx) => {
  const expected = /\.png$/i.test(asset.filename) ? 'image/png'
    : /\.jpe?g$/i.test(asset.filename) ? 'image/jpeg'
      : /\.webp$/i.test(asset.filename) ? 'image/webp'
        : /\.gif$/i.test(asset.filename) ? 'image/gif' : ''
  if (expected !== asset.mimeType) ctx.addIssue({ code: 'custom', path: ['mimeType'], message: 'The asset MIME type does not match its filename.' })
  const padding = asset.contentBase64.endsWith('==') ? 2 : asset.contentBase64.endsWith('=') ? 1 : 0
  const bytes = Math.floor(asset.contentBase64.length * 3 / 4) - padding
  if (bytes < 1 || bytes > MAX_MARKETPLACE_ASSET_BYTES) ctx.addIssue({ code: 'custom', path: ['contentBase64'], message: 'Each image must be at most 5 MB.' })
  if (!imageSignatureMatches(asset.contentBase64, asset.mimeType)) ctx.addIssue({ code: 'custom', path: ['contentBase64'], message: 'The image bytes do not match the declared MIME type.' })
})
export type MarketplaceAsset = z.infer<typeof MarketplaceAssetSchema>

const compatibility = z.object({
  minBuilderVersion: semver.default(CURRENT_BUILDER_VERSION),
  maxBuilderVersion: semver.optional(),
}).strict().default({ minBuilderVersion: CURRENT_BUILDER_VERSION })
const common = {
  format: z.literal(MARKETPLACE_PACKAGE_FORMAT),
  formatVersion: z.literal(MARKETPLACE_PACKAGE_VERSION),
  packageId,
  name: plainText(120),
  description: z.string().trim().max(1000).default(''),
  version: semver,
  license: plainText(100).default('CC BY 4.0'),
  compatibility,
  assets: z.array(MarketplaceAssetSchema).max(100).default([]),
}

export const ComponentEntrySchema = z.object({
  id: packageId,
  name: plainText(80),
  description: z.string().trim().max(500).default(''),
  nodes: z.array(z.any()).min(1).max(200),
}).strict()

const ProjectTemplatePageSchema = PageDataSchema

function totalNodes(nodes: BuilderNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + totalNodes(node.children), 0)
}

const mediaAssetPath = /^\/media\/([A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif))(?:[?#][^\s"'<>)]*)?$/i

export function referencedMediaFilenames(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    const addPath = (candidate: string) => {
      const match = mediaAssetPath.exec(candidate.trim())
      if (match) result.add(match[1]!)
    }
    addPath(value)
    const cssReferences = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi
    for (const cssMatch of value.matchAll(cssReferences)) addPath(cssMatch[1] ?? cssMatch[2] ?? cssMatch[3] ?? '')
  } else if (Array.isArray(value)) {
    value.forEach((item) => referencedMediaFilenames(item, result))
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => referencedMediaFilenames(item, result))
  }
  return result
}

function checkPackageAssets(assets: MarketplaceAsset[], referenced: Set<string>, ctx: z.RefinementCtx) {
  const names = assets.map((asset) => asset.filename.toLowerCase())
  if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', path: ['assets'], message: 'Package asset filenames must be unique.' })
  const totalBytes = assets.reduce((sum, asset) => {
    const padding = asset.contentBase64.endsWith('==') ? 2 : asset.contentBase64.endsWith('=') ? 1 : 0
    return sum + Math.floor(asset.contentBase64.length * 3 / 4) - padding
  }, 0)
  if (totalBytes > MAX_MARKETPLACE_ASSET_BYTES) ctx.addIssue({ code: 'custom', path: ['assets'], message: 'A package may contain at most 5 MB of images.' })
  for (const filename of referenced) {
    if (!names.includes(filename.toLowerCase())) ctx.addIssue({ code: 'custom', path: ['assets'], message: `Referenced image “${filename}” is missing from the package.` })
  }
}

function checkPackageSize(value: unknown, ctx: z.RefinementCtx) {
  const encodedBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (encodedBytes > MAX_MARKETPLACE_PACKAGE_BYTES) ctx.addIssue({ code: 'custom', message: 'The marketplace package exceeds the 10 MB limit.' })
}

export const ComponentPackageSchema = z.object({
  ...common,
  type: z.literal('component'),
  category: z.enum(COMPONENT_MARKETPLACE_CATEGORIES),
  components: z.array(ComponentEntrySchema).min(1).max(20),
}).strict().superRefine((pkg, ctx) => {
  const ids = new Set<string>()
  let count = 0
  const trees: BuilderNode[][] = []
  pkg.components.forEach((component, index) => {
    if (ids.has(component.id)) ctx.addIssue({ code: 'custom', path: ['components', index, 'id'], message: 'Component IDs must be unique within a package.' })
    ids.add(component.id)
    try {
      const tree = validateTree(component.nodes)
      trees.push(tree)
      count += totalNodes(tree)
    } catch (error) {
      ctx.addIssue({ code: 'custom', path: ['components', index, 'nodes'], message: error instanceof Error ? error.message : 'Invalid component tree.' })
    }
  })
  if (count > 2_000) ctx.addIssue({ code: 'custom', path: ['components'], message: 'A component package may contain at most 2,000 nodes.' })
  const refs = referencedMediaFilenames(trees)
  checkPackageAssets(pkg.assets, refs, ctx)
  checkPackageSize(pkg, ctx)
})
export type ComponentPackage = z.infer<typeof ComponentPackageSchema>

export const TemplatePackageSchema = z.object({
  ...common,
  type: z.literal('template'),
  category: z.enum(TEMPLATE_CATEGORIES),
  settings: ProjectSettingsSchema,
  pages: z.array(ProjectTemplatePageSchema).min(1).max(100),
}).strict().superRefine((pkg, ctx) => {
  const slugs = new Set<string>()
  let homes = 0
  let count = 0
  for (const [index, page] of pkg.pages.entries()) {
    if (slugs.has(page.slug)) ctx.addIssue({ code: 'custom', path: ['pages', index, 'slug'], message: 'Template page slugs must be unique.' })
    slugs.add(page.slug)
    if (page.isHome) homes += 1
    try { count += totalNodes(validateTree(page.nodes)) } catch (error) {
      ctx.addIssue({ code: 'custom', path: ['pages', index, 'nodes'], message: error instanceof Error ? error.message : 'Invalid page tree.' })
    }
  }
  if (homes !== 1) ctx.addIssue({ code: 'custom', path: ['pages'], message: 'A template package must contain exactly one homepage.' })
  if (count > 5_000) ctx.addIssue({ code: 'custom', path: ['pages'], message: 'A template package may contain at most 5,000 component nodes.' })
  for (const token of missingDesignTokens({ pages: pkg.pages, settings: pkg.settings }, pkg.settings)) {
    ctx.addIssue({ code: 'custom', path: ['pages'], message: `The template references missing ${token.group} design token “${token.id}”.` })
  }
  const refs = referencedMediaFilenames({ pages: pkg.pages, settings: pkg.settings })
  checkPackageAssets(pkg.assets, refs, ctx)
  checkPackageSize(pkg, ctx)
})
export type TemplatePackage = z.infer<typeof TemplatePackageSchema>

export const MarketplacePackageSchema = z.discriminatedUnion('type', [ComponentPackageSchema, TemplatePackageSchema])
export type MarketplacePackage = z.infer<typeof MarketplacePackageSchema>

function versionParts(value: string): number[] {
  return value.split('-')[0]!.split('.').map((part) => Number(part))
}
function compareVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0)
  return 0
}

export function packageCompatibilityError(pkg: Pick<MarketplacePackage, 'formatVersion' | 'compatibility'>, currentVersion = CURRENT_BUILDER_VERSION): string | null {
  if (pkg.formatVersion !== MARKETPLACE_PACKAGE_VERSION) return `Package format ${pkg.formatVersion} is not supported.`
  if (compareVersions(currentVersion, pkg.compatibility.minBuilderVersion) < 0) return `This package requires WebCraft ${pkg.compatibility.minBuilderVersion} or newer.`
  if (pkg.compatibility.maxBuilderVersion && compareVersions(currentVersion, pkg.compatibility.maxBuilderVersion) > 0) return `This package supports WebCraft only through ${pkg.compatibility.maxBuilderVersion}.`
  return null
}

export type RequiredDesignToken = { group: 'color' | 'spacing' | 'size' | 'typography'; id: string }
export function requiredDesignTokens(value: unknown): RequiredDesignToken[] {
  const text = JSON.stringify(value)
  const found = new Map<string, RequiredDesignToken>()
  for (const match of text.matchAll(/var\(--wc-(color|spacing|size|typography)-([a-z0-9-]+)(?:-[a-z0-9-]+)?\)/gi)) {
    const group = match[1]!.toLowerCase() as RequiredDesignToken['group']
    const rawId = match[2]!.toLowerCase()
    const id = group === 'typography' ? rawId.split('-')[0]! : rawId
    const token = { group, id }
    found.set(`${group}:${id}`, token)
  }
  return [...found.values()]
}

export function missingDesignTokens(value: unknown, settings: unknown): RequiredDesignToken[] {
  const tokens = requiredDesignTokens(value)
  const parsed = ProjectSettingsSchema.safeParse(settings)
  const system = parsed.success ? parsed.data.designSystem : undefined
  const palette = system?.palettes.find((item) => item.id === system.activePaletteId)
  return tokens.filter((token) => {
    if (token.group === 'color') return !palette?.tokens.some((item) => item.id === token.id)
    if (token.group === 'spacing') return !system?.spacingTokens.some((item) => item.id === token.id)
    if (token.group === 'size') return !system?.sizingTokens.some((item) => item.id === token.id)
    return !['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body'].includes(token.id)
  })
}

export function packageForJsonExport(pkg: MarketplacePackage): string {
  return JSON.stringify(MarketplacePackageSchema.parse(pkg), null, 2)
}
