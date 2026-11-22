import type { BaseNodeStyle, BuilderNode, DesignSystem, TypographyPresetName } from '@webcraft/core/schema'

function tokenId(value: string | undefined, group: string) {
  const match = value?.match(new RegExp(`^var\\(--wc-${group}-([a-z0-9-]+)\\)$`))
  return match?.[1] ?? ''
}

type Props = {
  system: DesignSystem
  node: BuilderNode
  onStyle: (field: keyof BaseNodeStyle, value: string | undefined) => void
  onPreset: (preset: TypographyPresetName) => void
}

export function NodeTokenControls({ system, node, onStyle, onPreset }: Props) {
  const palette = system.palettes.find((item) => item.id === system.activePaletteId)!
  const currentPreset = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body'] as const).find((preset) => node.style.fontSize === `var(--wc-typography-${preset}-font-size)`) ?? ''
  return <div className="inspector-section node-token-controls">
    <span className="inspector-label">DESIGN TOKENS</span>
    <label className="field-label">Text color token<select className="input" value={tokenId(node.style.color, 'color')} onChange={(event) => onStyle('color', event.target.value ? `var(--wc-color-${event.target.value})` : undefined)}><option value="">Custom / none</option>{palette.tokens.map((token) => <option key={token.id} value={token.id}>{token.name}</option>)}</select></label>
    <label className="field-label">Background token<select className="input" value={tokenId(node.style.backgroundColor, 'color')} onChange={(event) => onStyle('backgroundColor', event.target.value ? `var(--wc-color-${event.target.value})` : undefined)}><option value="">Custom / none</option>{palette.tokens.map((token) => <option key={token.id} value={token.id}>{token.name}</option>)}</select></label>
    <label className="field-label">Typography preset<select className="input" value={currentPreset} onChange={(event) => { if (event.target.value) onPreset(event.target.value as TypographyPresetName) }}><option value="">No preset</option>{(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body'] as const).map((preset) => <option key={preset} value={preset}>{preset === 'body' ? 'Body' : `Heading ${preset.slice(1)}`}</option>)}</select></label>
    <label className="field-label">Padding token<select className="input" value={tokenId(node.style.padding, 'spacing')} onChange={(event) => onStyle('padding', event.target.value ? `var(--wc-spacing-${event.target.value})` : undefined)}><option value="">Custom / none</option>{system.spacingTokens.map((token) => <option key={token.id} value={token.id}>{token.name} · {token.value}</option>)}</select></label>
    <label className="field-label">Margin token<select className="input" value={tokenId(node.style.margin, 'spacing')} onChange={(event) => onStyle('margin', event.target.value ? `var(--wc-spacing-${event.target.value})` : undefined)}><option value="">Custom / none</option>{system.spacingTokens.map((token) => <option key={token.id} value={token.id}>{token.name} · {token.value}</option>)}</select></label>
    <label className="field-label">Width token<select className="input" value={tokenId(node.style.width, 'size')} onChange={(event) => onStyle('width', event.target.value ? `var(--wc-size-${event.target.value})` : undefined)}><option value="">Custom / none</option>{system.sizingTokens.map((token) => <option key={token.id} value={token.id}>{token.name} · {token.value}</option>)}</select></label>
    <label className="field-label">Height token<select className="input" value={tokenId(node.style.height, 'size')} onChange={(event) => onStyle('height', event.target.value ? `var(--wc-size-${event.target.value})` : undefined)}><option value="">Custom / none</option>{system.sizingTokens.map((token) => <option key={token.id} value={token.id}>{token.name} · {token.value}</option>)}</select></label>
    <label className="field-label">Radius token<select className="input" value={tokenId(node.style.borderRadius, 'size')} onChange={(event) => onStyle('borderRadius', event.target.value ? `var(--wc-size-${event.target.value})` : undefined)}><option value="">Custom / none</option>{system.sizingTokens.filter((token) => token.id.startsWith('radius-')).map((token) => <option key={token.id} value={token.id}>{token.name} · {token.value}</option>)}</select></label>
  </div>
}
