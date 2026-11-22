import { z } from 'zod'

export const COMPONENT_TYPES = [
  'section', 'container', 'heading', 'paragraph', 'text', 'button', 'link', 'image', 'video', 'icon', 'divider', 'spacer',
  'grid', 'flex', 'columns', 'card', 'navbar', 'footer', 'hero', 'features', 'testimonials', 'pricing', 'faq', 'team',
  'statistics', 'gallery', 'contact-form', 'newsletter', 'cta',
] as const
export type ComponentType = (typeof COMPONENT_TYPES)[number]

const safeCssValue = z.string().max(120).refine(
  (value) => !/[{};<>]/.test(value) && !/(url\s*\(|expression\s*\(|javascript:|@import)/i.test(value),
  'CSS value contains a prohibited construct',
)
export const StyleSchema = z.object({
  color: safeCssValue.optional(), backgroundColor: safeCssValue.optional(), fontSize: safeCssValue.optional(), fontWeight: safeCssValue.optional(),
  textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(), lineHeight: safeCssValue.optional(), letterSpacing: safeCssValue.optional(),
  padding: safeCssValue.optional(), paddingTop: safeCssValue.optional(), paddingBottom: safeCssValue.optional(), margin: safeCssValue.optional(),
  marginTop: safeCssValue.optional(), marginBottom: safeCssValue.optional(), borderRadius: safeCssValue.optional(), border: safeCssValue.optional(),
  boxShadow: safeCssValue.optional(), gap: safeCssValue.optional(), display: z.enum(['block', 'flex', 'grid']).optional(),
  gridColumns: z.number().int().min(1).max(6).optional(), maxWidth: safeCssValue.optional(), width: safeCssValue.optional(), height: safeCssValue.optional(),
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
  columns: z.number().int().min(1).max(6).optional(),
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

export const ProjectSettingsSchema = z.object({
  language: z.string().min(2).max(12).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).default('en'),
  title: z.string().max(120).default('My website'),
  description: z.string().max(300).default(''),
  primaryColor: z.string().max(50).default('#5b5ce2'),
  fontFamily: z.enum(['Inter', 'system-ui', 'Georgia', 'Arial']).default('Inter'),
}).strict()

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
  return safeHref.safeParse(trimmed).success ? trimmed : fallback
}
