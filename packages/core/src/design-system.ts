import { z } from 'zod'

const tokenId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'Use lowercase letters, numbers, and hyphens for token IDs')
const displayName = z.string().trim().min(1).max(48).refine((value) => !/[<>\u0000-\u001f]/.test(value), 'Token names must be plain text')
const cssValue = z.string().max(120).refine(
  (value) => !/[{};<>\\]/.test(value) && !/(url\s*\(|expression\s*\(|javascript:|vbscript:|@import|-moz-binding|behavior\s*:)/i.test(value),
  'CSS value contains a prohibited construct',
)
export const ColorValueSchema = z.string().max(80).refine(
  (value) => /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
    || /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.%\s,+/-]+\s*\)$/i.test(value),
  'Use a HEX, RGB, or HSL color value',
)
const colorValue = ColorValueSchema
const dimensionValue = z.string().max(32).regex(
  /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vw|vh|dvw|dvh|ch))$/i,
  'Use 0 or a non-negative CSS length in px, rem, em, %, vw, vh, dvw, dvh, or ch',
)
const fontFamily = z.enum(['Inter', 'system-ui', 'Georgia', 'Arial'])
const borderStyle = z.enum(['none', 'solid', 'dashed', 'dotted', 'double'])
const typographyPreset = z.object({
  fontSize: cssValue,
  fontWeight: z.number().int().min(100).max(900).multipleOf(50),
  lineHeight: cssValue,
  letterSpacing: cssValue,
}).strict()
const tokenDefinition = z.object({ id: tokenId, name: displayName, value: dimensionValue }).strict()
const colorToken = z.object({ id: tokenId, name: displayName, value: colorValue }).strict()
const colorPalette = z.object({
  id: tokenId,
  name: displayName,
  tokens: z.array(colorToken).min(8).max(32),
}).strict()

const globalStyles = z.object({
  button: z.object({
    backgroundColor: cssValue, color: cssValue, borderRadius: cssValue,
    paddingBlock: cssValue, paddingInline: cssValue, boxShadow: cssValue,
  }).strict(),
  link: z.object({ color: cssValue, textDecoration: z.enum(['none', 'underline']) }).strict(),
  card: z.object({
    backgroundColor: cssValue, color: cssValue, borderColor: cssValue,
    borderWidth: cssValue, borderStyle, borderRadius: cssValue, padding: cssValue, boxShadow: cssValue,
  }).strict(),
  input: z.object({
    backgroundColor: cssValue, color: cssValue, borderColor: cssValue,
    borderWidth: cssValue, borderStyle, borderRadius: cssValue, padding: cssValue,
  }).strict(),
  navigation: z.object({
    backgroundColor: cssValue, color: cssValue, borderColor: cssValue,
    borderWidth: cssValue, borderStyle, padding: cssValue,
  }).strict(),
}).strict()

const baseColorTokens: z.infer<typeof colorToken>[] = [
  { id: 'primary', name: 'Primary', value: '#5b5ce2' },
  { id: 'secondary', name: 'Secondary', value: '#334155' },
  { id: 'accent', name: 'Accent', value: '#e76f51' },
  { id: 'neutral', name: 'Neutral', value: '#64748b' },
  { id: 'background', name: 'Background', value: '#ffffff' },
  { id: 'foreground', name: 'Foreground', value: '#202338' },
  { id: 'surface', name: 'Surface', value: '#f8fafc' },
  { id: 'on-primary', name: 'On primary', value: '#ffffff' },
]

function colorRef(id: string) { return `var(--wc-color-${id})` }
function spacingRef(id: string) { return `var(--wc-spacing-${id})` }
function sizeRef(id: string) { return `var(--wc-size-${id})` }

export const DesignSystemSchema = z.object({
  activePaletteId: tokenId,
  palettes: z.array(colorPalette).min(1).max(12),
  typography: z.object({
    bodyFontFamily: fontFamily,
    headingFontFamily: fontFamily,
    presets: z.object({
      h1: typographyPreset, h2: typographyPreset, h3: typographyPreset,
      h4: typographyPreset, h5: typographyPreset, h6: typographyPreset, body: typographyPreset,
    }).strict(),
  }).strict(),
  spacingTokens: z.array(tokenDefinition).min(1).max(32),
  sizingTokens: z.array(tokenDefinition).min(1).max(32),
  globalStyles,
}).strict().superRefine((system, ctx) => {
  const paletteIds = new Set<string>()
  const paletteNames = new Set<string>()
  const canonicalTokenIds = new Set(system.palettes[0]?.tokens.map((token) => token.id) ?? [])
  for (const required of baseColorTokens.map((token) => token.id)) {
    if (!canonicalTokenIds.has(required)) ctx.addIssue({ code: 'custom', path: ['palettes', 0, 'tokens'], message: `Required color token “${required}” is missing` })
  }
  system.palettes.forEach((palette, index) => {
    if (paletteIds.has(palette.id)) ctx.addIssue({ code: 'custom', path: ['palettes', index, 'id'], message: 'Palette IDs must be unique' })
    paletteIds.add(palette.id)
    const normalizedName = palette.name.toLowerCase()
    if (paletteNames.has(normalizedName)) ctx.addIssue({ code: 'custom', path: ['palettes', index, 'name'], message: 'Palette names must be unique' })
    paletteNames.add(normalizedName)
    const ids = palette.tokens.map((token) => token.id)
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['palettes', index, 'tokens'], message: 'Color token IDs must be unique within a palette' })
    if (new Set(palette.tokens.map((token) => token.name.toLowerCase())).size !== palette.tokens.length) ctx.addIssue({ code: 'custom', path: ['palettes', index, 'tokens'], message: 'Color token names must be unique within a palette' })
    if (ids.length !== canonicalTokenIds.size || ids.some((id) => !canonicalTokenIds.has(id))) {
      ctx.addIssue({ code: 'custom', path: ['palettes', index, 'tokens'], message: 'All palettes must define the same color token IDs' })
    }
  })
  if (!paletteIds.has(system.activePaletteId)) ctx.addIssue({ code: 'custom', path: ['activePaletteId'], message: 'The active palette must exist' })
  for (const [field, tokens] of [['spacingTokens', system.spacingTokens], ['sizingTokens', system.sizingTokens]] as const) {
    const ids = tokens.map((token) => token.id)
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: [field], message: `${field} IDs must be unique` })
    if (new Set(tokens.map((token) => token.name.toLowerCase())).size !== tokens.length) ctx.addIssue({ code: 'custom', path: [field], message: `${field} names must be unique` })
  }
})

export type DesignSystem = z.infer<typeof DesignSystemSchema>
export type TypographyPresetName = keyof DesignSystem['typography']['presets']
export type DesignTokenGroup = 'color' | 'spacing' | 'size' | 'typography'

export function createDefaultDesignSystem(primaryColor = '#5b5ce2', legacyFontFamily: DesignSystem['typography']['bodyFontFamily'] = 'Inter'): DesignSystem {
  const colors = baseColorTokens.map((token) => token.id === 'primary' ? { ...token, value: primaryColor } : { ...token })
  const presets: DesignSystem['typography']['presets'] = {
    h1: { fontSize: '3rem', fontWeight: 700, lineHeight: '1.1', letterSpacing: '-0.04em' },
    h2: { fontSize: '2.25rem', fontWeight: 700, lineHeight: '1.15', letterSpacing: '-0.03em' },
    h3: { fontSize: '1.75rem', fontWeight: 650, lineHeight: '1.2', letterSpacing: '-0.02em' },
    h4: { fontSize: '1.375rem', fontWeight: 650, lineHeight: '1.25', letterSpacing: '-0.01em' },
    h5: { fontSize: '1.125rem', fontWeight: 600, lineHeight: '1.35', letterSpacing: '0' },
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: '1.4', letterSpacing: '0' },
    body: { fontSize: '1rem', fontWeight: 400, lineHeight: '1.6', letterSpacing: '0' },
  }
  return DesignSystemSchema.parse({
    activePaletteId: 'default',
    palettes: [{ id: 'default', name: 'Default palette', tokens: colors }],
    typography: { bodyFontFamily: legacyFontFamily, headingFontFamily: legacyFontFamily, presets },
    spacingTokens: [
      { id: 'xs', name: 'Extra small', value: '0.25rem' },
      { id: 'sm', name: 'Small', value: '0.5rem' },
      { id: 'md', name: 'Medium', value: '1rem' },
      { id: 'lg', name: 'Large', value: '1.5rem' },
      { id: 'xl', name: 'Extra large', value: '2rem' },
    ],
    sizingTokens: [
      { id: 'container-sm', name: 'Container small', value: '48rem' },
      { id: 'container-md', name: 'Container medium', value: '64rem' },
      { id: 'container-lg', name: 'Container large', value: '72rem' },
      { id: 'radius-sm', name: 'Radius small', value: '0.375rem' },
      { id: 'radius-md', name: 'Radius medium', value: '0.75rem' },
      { id: 'radius-lg', name: 'Radius large', value: '1rem' },
      { id: 'radius-full', name: 'Radius full', value: '9999px' },
    ],
    globalStyles: {
      button: { backgroundColor: colorRef('primary'), color: colorRef('on-primary'), borderRadius: sizeRef('radius-md'), paddingBlock: spacingRef('sm'), paddingInline: spacingRef('md'), boxShadow: '0 2px 8px rgba(20, 24, 50, 0.12)' },
      link: { color: colorRef('primary'), textDecoration: 'underline' },
      card: { backgroundColor: colorRef('surface'), color: colorRef('foreground'), borderColor: colorRef('neutral'), borderWidth: '1px', borderStyle: 'solid', borderRadius: sizeRef('radius-md'), padding: spacingRef('lg'), boxShadow: '0 8px 24px rgba(20, 24, 50, 0.08)' },
      input: { backgroundColor: colorRef('background'), color: colorRef('foreground'), borderColor: colorRef('neutral'), borderWidth: '1px', borderStyle: 'solid', borderRadius: sizeRef('radius-sm'), padding: spacingRef('sm') },
      navigation: { backgroundColor: colorRef('background'), color: colorRef('foreground'), borderColor: colorRef('neutral'), borderWidth: '1px', borderStyle: 'solid', padding: spacingRef('md') },
    },
  })
}

export function designSystemCss(input: DesignSystem): string {
  const system = DesignSystemSchema.parse(input)
  const palette = system.palettes.find((item) => item.id === system.activePaletteId)!
  const root: string[] = palette.tokens.map((token) => `--wc-color-${token.id}:${token.value}`)
  root.push('--wc-primary:var(--wc-color-primary)')
  root.push(`--wc-typography-body-font-family:${fontStack(system.typography.bodyFontFamily)}`)
  root.push(`--wc-typography-heading-font-family:${fontStack(system.typography.headingFontFamily)}`)
  for (const [name, preset] of Object.entries(system.typography.presets) as [TypographyPresetName, DesignSystem['typography']['presets'][TypographyPresetName]][]) {
    const prefix = `--wc-typography-${name}`
    const familyRef = name === 'body' ? 'var(--wc-typography-body-font-family)' : 'var(--wc-typography-heading-font-family)'
    root.push(`${prefix}-font-family:${familyRef}`)
    root.push(`${prefix}-font-size:${preset.fontSize}`)
    root.push(`${prefix}-font-weight:${preset.fontWeight}`)
    root.push(`${prefix}-line-height:${preset.lineHeight}`)
    root.push(`${prefix}-letter-spacing:${preset.letterSpacing}`)
  }
  for (const token of system.spacingTokens) root.push(`--wc-spacing-${token.id}:${token.value}`)
  for (const token of system.sizingTokens) root.push(`--wc-size-${token.id}:${token.value}`)
  for (const [group, values] of Object.entries(system.globalStyles)) {
    for (const [key, value] of Object.entries(values)) root.push(`--wc-global-${group}-${toKebab(key)}:${value}`)
  }
  const rules = [
    `.wc-site{min-height:100%;background-color:var(--wc-color-background);color:var(--wc-color-foreground);font-family:var(--wc-typography-body-font-family);font-size:var(--wc-typography-body-font-size);font-weight:var(--wc-typography-body-font-weight);line-height:var(--wc-typography-body-line-height);letter-spacing:var(--wc-typography-body-letter-spacing)}`,
    `.wc-node.wc-button,.wc-node form button{display:inline-flex;align-items:center;justify-content:center;background-color:var(--wc-global-button-background-color);color:var(--wc-global-button-color);border:0;border-radius:var(--wc-global-button-border-radius);padding-block:var(--wc-global-button-padding-block);padding-inline:var(--wc-global-button-padding-inline);box-shadow:var(--wc-global-button-box-shadow);text-decoration:none;cursor:pointer}`,
    `.wc-node.wc-link{color:var(--wc-global-link-color);text-decoration:var(--wc-global-link-text-decoration)}`,
    `.wc-node.wc-card{background-color:var(--wc-global-card-background-color);color:var(--wc-global-card-color);border:var(--wc-global-card-border-width) var(--wc-global-card-border-style) var(--wc-global-card-border-color);border-radius:var(--wc-global-card-border-radius);padding:var(--wc-global-card-padding);box-shadow:var(--wc-global-card-box-shadow)}`,
    `.wc-node.wc-navbar{display:flex;align-items:center;background-color:var(--wc-global-navigation-background-color);color:var(--wc-global-navigation-color);border-bottom:var(--wc-global-navigation-border-width) var(--wc-global-navigation-border-style) var(--wc-global-navigation-border-color);padding:var(--wc-global-navigation-padding)}`,
    `.wc-node input,.wc-node textarea,.wc-node select{background-color:var(--wc-global-input-background-color);color:var(--wc-global-input-color);border:var(--wc-global-input-border-width) var(--wc-global-input-border-style) var(--wc-global-input-border-color);border-radius:var(--wc-global-input-border-radius);padding:var(--wc-global-input-padding);font:inherit}`,
    ...(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((name) => `.wc-node.wc-heading-level-${name.slice(1)}{font-family:var(--wc-typography-heading-font-family);font-size:var(--wc-typography-${name}-font-size);font-weight:var(--wc-typography-${name}-font-weight);line-height:var(--wc-typography-${name}-line-height);letter-spacing:var(--wc-typography-${name}-letter-spacing)}`),
  ]
  return `:root{${root.join(';')}}\n${rules.join('\n')}`
}

export function safeDesignSystemCss(input: unknown): string {
  const parsed = DesignSystemSchema.safeParse(input)
  return parsed.success ? designSystemCss(parsed.data) : ''
}

function fontStack(family: DesignSystem['typography']['bodyFontFamily']): string {
  if (family === 'Georgia') return 'Georgia,"Times New Roman",serif'
  if (family === 'Arial') return 'Arial,Helvetica,sans-serif'
  if (family === 'Inter') return 'Inter,system-ui,sans-serif'
  return 'system-ui,sans-serif'
}

function toKebab(value: string) { return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`) }
