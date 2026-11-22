import { z } from 'zod'
import type { BuilderNode } from './schema'

export const AnimationSchema = z.object({
  enabled: z.boolean().default(false),
  trigger: z.enum(['entrance', 'scroll', 'hover', 'exit']).default('entrance'),
  effect: z.enum(['fade', 'slide', 'scale', 'rotate']).default('fade'),
  direction: z.enum(['up', 'down', 'left', 'right']).default('up'),
  distancePx: z.number().int().min(0).max(200).default(24),
  scaleFrom: z.number().min(0.1).max(2).default(0.9),
  rotationFrom: z.number().int().min(-180).max(180).default(-8),
  durationMs: z.number().int().min(0).max(5_000).default(500),
  delayMs: z.number().int().min(0).max(10_000).default(0),
  easing: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']).default('ease-out'),
  once: z.boolean().default(true),
  disabledOn: z.array(z.enum(['tablet', 'mobile'])).max(2).default([]),
}).strict()
export type AnimationConfig = z.infer<typeof AnimationSchema>

export function createDefaultAnimation(): AnimationConfig { return AnimationSchema.parse({ enabled: true }) }

function transformFrom(config: AnimationConfig, trigger: 'in' | 'out' | 'hover'): string {
  if (config.effect === 'slide') {
    const distance = config.distancePx * (trigger === 'out' ? 1 : 1)
    const direction = trigger === 'out'
      ? ({ up: 'translateY(-', down: 'translateY(', left: 'translateX(-', right: 'translateX(' } as const)[config.direction]
      : ({ up: 'translateY(', down: 'translateY(-', left: 'translateX(', right: 'translateX(-' } as const)[config.direction]
    return `${direction}${distance}px)`
  }
  if (config.effect === 'scale') return `scale(${trigger === 'hover' ? Math.max(1, config.scaleFrom) : trigger === 'out' ? 1 / config.scaleFrom : config.scaleFrom})`
  if (config.effect === 'rotate') return `rotate(${trigger === 'hover' ? -config.rotationFrom : trigger === 'out' ? -config.rotationFrom : config.rotationFrom}deg)`
  return 'none'
}

export function animationPreviewKeyframes(config: AnimationConfig): Keyframe[] {
  const finalTransform = config.effect === 'slide' || config.effect === 'scale' || config.effect === 'rotate' ? transformFrom(config, 'in') : 'none'
  const startOpacity = config.effect === 'fade' || config.effect === 'slide' ? 0 : 1
  return [{ opacity: startOpacity, transform: finalTransform }, { opacity: 1, transform: 'none' }]
}

function cssId(value: string) { return value.replace(/[^A-Za-z0-9_-]/g, '_') }

function keyframes(name: string, config: AnimationConfig, trigger: AnimationConfig['trigger']): string {
  if (trigger === 'hover') {
    const transform = transformFrom(config, 'hover')
    const opacity = config.effect === 'fade' ? 0.72 : 1
    return `@keyframes ${name}{from{opacity:1;transform:none}to{opacity:${opacity};transform:${transform}}}`
  }
  if (trigger === 'exit') {
    const transform = transformFrom(config, 'out')
    const opacity = config.effect === 'fade' || config.effect === 'slide' ? 0 : 1
    return `@keyframes ${name}{from{opacity:1;transform:none}to{opacity:${opacity};transform:${transform}}}`
  }
  const transform = transformFrom(config, 'in')
  const opacity = config.effect === 'fade' || config.effect === 'slide' ? 0 : 1
  return `@keyframes ${name}{from{opacity:${opacity};transform:${transform}}to{opacity:1;transform:none}}`
}

export function animationCss(nodes: BuilderNode[], breakpoints: { tablet: number; mobile: number }, pageSlug?: string): string {
  const rules: string[] = []
  const disabled: Record<'tablet' | 'mobile', string[]> = { tablet: [], mobile: [] }
  const scope = pageSlug ? `.wc-site[data-page-slug="${cssId(pageSlug)}"]` : '.wc-site'
  const visit = (items: BuilderNode[]) => {
    for (const node of items) {
      const parsed = AnimationSchema.safeParse(node.animation)
      if (parsed.success && parsed.data.enabled) {
        const config = parsed.data
        const name = `wc-${config.trigger}-${cssId(pageSlug || 'site')}-${cssId(node.id)}`
        const selector = `${scope} [data-node-id="${cssId(node.id)}"]`
        const animation = `${name} ${config.durationMs}ms ${config.easing} ${config.delayMs}ms both`
        const triggerRule = config.trigger === 'hover'
          ? `${selector}[data-wc-motion="hover"]:hover{animation:${animation}}`
          : config.trigger === 'scroll'
            ? `${selector}[data-wc-motion="scroll"].wc-motion-visible{animation:${animation}}`
            : config.trigger === 'exit'
              ? `${selector}[data-wc-motion="exit"].wc-motion-exiting{animation:${name} ${config.durationMs}ms ${config.easing} ${config.delayMs}ms both}`
              : `${selector}[data-wc-motion="entrance"]{animation:${animation}}`
        rules.push(keyframes(name, config, config.trigger), triggerRule)
        for (const mode of ['tablet', 'mobile'] as const) if (config.disabledOn.includes(mode)) disabled[mode].push(`${selector}[data-wc-motion]{animation:none!important;transition:none!important}`)
      }
      visit(node.children)
    }
  }
  visit(nodes)
  if (!rules.length) return ''
  const reducedSelectors = `${scope} [data-wc-motion]`
  rules.push(`.wc-site.is-edit-mode [data-wc-motion]{animation:none!important;transition:none!important}`)
  rules.push(`@media(prefers-reduced-motion:reduce){${reducedSelectors}{animation:none!important;transition:none!important;scroll-behavior:auto!important}}`)
  if (disabled.tablet.length) rules.push(`@media(max-width:${breakpoints.tablet}px){${disabled.tablet.join('')}}`)
  if (disabled.mobile.length) rules.push(`@media(max-width:${breakpoints.mobile}px){${disabled.mobile.join('')}}`)
  return rules.join('\n')
}
