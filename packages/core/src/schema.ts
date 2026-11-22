import { z } from 'zod'

export const COMPONENT_TYPES = [
  'section', 'container', 'heading', 'paragraph', 'text', 'button', 'link', 'image', 'video', 'icon', 'divider', 'spacer',
  'grid', 'flex', 'columns', 'card', 'navbar', 'footer', 'hero', 'features', 'testimonials', 'pricing', 'faq', 'team',
  'statistics', 'gallery', 'contact-form', 'newsletter', 'cta',
] as const
export type ComponentType = (typeof COMPONENT_TYPES)[number]

const safeCssValue = z.string().max(120).refine(
  (value) => !/[{};<>]/.test(value) && !/(url\s*\(|expression\s*\(|javascript:|vbscript:|@import|-moz-binding|behavior\s*:)/i.test(value),
  'CSS value contains a prohibited construct',
)

const BaseStyleSchema = z.object({
  color: safeCssValue.optional(), backgroundColor: safeCssValue.optional(), fontSize: safeCssValue.optional(), fontWeight: safeCssValue.optional(),
  fontStyle: z.enum(['normal', 'italic', 'oblique']).optional(), textDecoration: z.enum(['none', 'underline', 'line-through']).optional(),
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
  textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(), lineHeight: safeCssValue.optional(), letterSpacing: safeCssValue.optional(),
  padding: safeCssValue.optional(), paddingTop: safeCssValue.optional(), paddingRight: safeCssValue.optional(), paddingBottom: safeCssValue.optional(), paddingLeft: safeCssValue.optional(),
  margin: safeCssValue.optional(), marginTop: safeCssValue.optional(), marginRight: safeCssValue.optional(), marginBottom: safeCssValue.optional(), marginLeft: safeCssValue.optional(),
  borderRadius: safeCssValue.optional(), border: safeCssValue.optional(), borderWidth: safeCssValue.optional(), borderStyle: z.enum(['none', 'solid', 'dashed', 'dotted', 'double']).optional(), borderColor: safeCssValue.optional(),
  boxShadow: safeCssValue.optional(), gap: safeCssValue.optional(), rowGap: safeCssValue.optional(), columnGap: safeCssValue.optional(),
  display: z.enum(['block', 'flex', 'grid', 'inline-flex']).optional(), flexDirection: z.enum(['row', 'row-reverse', 'column', 'column-reverse']).optional(),
  justifyContent: z.enum(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']).optional(),
  alignItems: z.enum(['stretch', 'flex-start', 'center', 'flex-end', 'baseline']).optional(), flexWrap: z.enum(['nowrap', 'wrap', 'wrap-reverse']).optional(),
  gridColumns: z.number().int().min(1).max(12).optional(), maxWidth: safeCssValue.optional(), minWidth: safeCssValue.optional(), width: safeCssValue.optional(),
  maxHeight: safeCssValue.optional(), minHeight: safeCssValue.optional(), height: safeCssValue.optional(), overflow: z.enum(['visible', 'hidden', 'auto']).optional(),
  opacity: z.number().min(0).max(1).optional(),
}).strict()
export type BaseNodeStyle = z.infer<typeof BaseStyleSchema>
const PartialBaseStyleSchema = BaseStyleSchema.partial().strict()
export const StyleSchema = BaseStyleSchema.extend({
  responsive: z.object({
    tablet: PartialBaseStyleSchema.default({}),
    mobile: PartialBaseStyleSchema.default({}),
  }).strict().optional(),
}).strict()
export type NodeStyle = z.infer<typeof StyleSchema>

const safeHref = z.string().max(500).refine((value) => {
  const v = value.trim().toLowerCase()
  return !v.startsWith('javascript:') && !v.startsWith('vbscript:') && !v.startsWith('data:') && !v.startsWith('file:')
    && (/^(https:\/\/|mailto:|tel:|\/|#|\?|\.\/|\.\.\/)/i.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value))
}, 'Only web links and local paths are allowed')
const safeAsset = z.string().max(1000).refine((value) => !/^(javascript|vbscript|data|file):/i.test(value.trim()), 'Unsafe asset URL')
const propsSchema = z.object({
  text: z.string().max(2000).optional(), href: safeHref.optional(), src: safeAsset.optional(), alt: z.string().max(500).optional(),
  level: z.number().int().min(1).max(6).optional(), placeholder: z.string().max(300).optional(), label: z.string().max(200).optional(),
  columns: z.number().int().min(1).max(12).optional(),
}).strict()

export interface BuilderNode {
  id: string
  type: ComponentType
  props: z.infer<typeof propsSchema>
  style: NodeStyle
  children: BuilderNode[]
}
const recursiveNode: z.ZodType<BuilderNode> = z.lazy(() => z.object({
  id: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(COMPONENT_TYPES),
  props: propsSchema.default({}),
  style: StyleSchema.default({}),
  children: z.array(recursiveNode).max(100).default([]),
}).strict())
export const NodeSchema = recursiveNode

export function validateTree(input: unknown): BuilderNode[] {
  const nodes = z.array(NodeSchema).max(200).parse(input)
  const ids = new Set<string>()
  let count = 0
  const walk = (items: BuilderNode[], depth: number) => {
    if (depth > 12) throw new Error('Page tree nesting exceeds 12 levels')
    for (const node of items) {
      count += 1
      if (count > 500) throw new Error('Page tree exceeds 500 components')
      if (ids.has(node.id)) throw new Error(`Duplicate component ID: ${node.id}`)
      ids.add(node.id)
      walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return nodes
}

const mediaPath = /^\/media\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif)$/i
const safeMediaPath = z.string().max(220).refine((value) => value === '' || mediaPath.test(value), 'Choose an image from this project’s asset library')
const safeCustomCss = z.string().max(20_000).refine(
  (value) => !/@import\b|expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|url\s*\(\s*['"]?\s*(?:javascript|vbscript|data|file):|<\/style/i.test(value),
  'Custom CSS contains a prohibited construct',
)
const MetaTagSchema = z.object({
  attribute: z.enum(['name', 'property']).default('name'),
  key: z.string().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9:_-]*$/),
  content: z.string().max(300),
}).strict()

export const ProjectSettingsSchema = z.object({
  language: z.string().min(2).max(12).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).default('en'),
  title: z.string().max(120).default('My website'),
  description: z.string().max(300).default(''),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#5b5ce2'),
  fontFamily: z.enum(['Inter', 'system-ui', 'Georgia', 'Arial']).default('Inter'),
  logoPath: safeMediaPath.default(''),
  faviconPath: safeMediaPath.default(''),
  customCss: safeCustomCss.default(''),
  customMetaTags: z.array(MetaTagSchema).max(16).default([]),
  breakpoints: z.object({
    mobile: z.number().int().min(360).max(767).default(600),
    tablet: z.number().int().min(768).max(1280).default(900),
  }).strict().default({ mobile: 600, tablet: 900 }).superRefine((value, ctx) => {
    if (value.mobile >= value.tablet) ctx.addIssue({ code: 'custom', path: ['mobile'], message: 'The mobile breakpoint must be smaller than the tablet breakpoint.' })
  }),
}).strict()
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>

const safeHrefForPage = safeHref
export const PageDataSchema = z.object({
  title: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  isHome: z.boolean().default(false),
  seoTitle: z.string().max(120).optional(),
  seoDescription: z.string().max(300).optional(),
  nodes: z.array(NodeSchema).max(200),
}).strict().superRefine((page, ctx) => {
  try { validateTree(page.nodes) } catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid tree' }) }
})

export function safeUrl(value: string | undefined, fallback = '#'): string {
  if (!value) return fallback
  const trimmed = value.trim()
  return safeHrefForPage.safeParse(trimmed).success ? trimmed : fallback
}

const cssProperties: Partial<Record<keyof BaseNodeStyle, string>> = {
  color: 'color', backgroundColor: 'background-color', fontSize: 'font-size', fontWeight: 'font-weight', fontStyle: 'font-style',
  textDecoration: 'text-decoration', textTransform: 'text-transform', textAlign: 'text-align', lineHeight: 'line-height', letterSpacing: 'letter-spacing',
  padding: 'padding', paddingTop: 'padding-top', paddingRight: 'padding-right', paddingBottom: 'padding-bottom', paddingLeft: 'padding-left',
  margin: 'margin', marginTop: 'margin-top', marginRight: 'margin-right', marginBottom: 'margin-bottom', marginLeft: 'margin-left',
  borderRadius: 'border-radius', border: 'border', borderWidth: 'border-width', borderStyle: 'border-style', borderColor: 'border-color',
  boxShadow: 'box-shadow', gap: 'gap', rowGap: 'row-gap', columnGap: 'column-gap', display: 'display', flexDirection: 'flex-direction',
  justifyContent: 'justify-content', alignItems: 'align-items', flexWrap: 'flex-wrap', maxWidth: 'max-width', minWidth: 'min-width', width: 'width',
  maxHeight: 'max-height', minHeight: 'min-height', height: 'height', overflow: 'overflow', opacity: 'opacity',
}

export function styleDeclarations(style: Partial<BaseNodeStyle>): string {
  const parsed = PartialBaseStyleSchema.safeParse(style)
  if (!parsed.success) return ''
  const declarations: string[] = []
  for (const [rawKey, value] of Object.entries(parsed.data) as [keyof BaseNodeStyle, BaseNodeStyle[keyof BaseNodeStyle]][]) {
    if (value === undefined) continue
    if (rawKey === 'gridColumns') declarations.push(`grid-template-columns:repeat(${value}, minmax(0, 1fr))`)
    else {
      const property = cssProperties[rawKey]
      if (property) declarations.push(`${property}:${String(value)}`)
    }
  }
  return declarations.join(';')
}

export function responsiveStyleCss(nodes: BuilderNode[], breakpoints: ProjectSettings['breakpoints']): string {
  const rules: Record<'tablet' | 'mobile', string[]> = { tablet: [], mobile: [] }
  const visit = (items: BuilderNode[]) => {
    for (const node of items) {
      for (const mode of ['tablet', 'mobile'] as const) {
        const declarations = styleDeclarations(node.style.responsive?.[mode] ?? {})
        if (declarations) rules[mode].push(`[data-node-id="${node.id}"]{${declarations}}`)
      }
      visit(node.children)
    }
  }
  visit(nodes)
  const parts: string[] = []
  if (rules.tablet.length) parts.push(`@media(max-width:${breakpoints.tablet}px){${rules.tablet.join('')}}`)
  if (rules.mobile.length) parts.push(`@media(max-width:${breakpoints.mobile}px){${rules.mobile.join('')}}`)
  return parts.join('\n')
}
