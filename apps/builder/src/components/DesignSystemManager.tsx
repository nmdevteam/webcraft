import type { DesignSystem, BuilderNode, TypographyPresetName } from '@webcraft/core/schema'
import { Button, Input } from './ui'

type Props = {
  system: DesignSystem
  nodes: BuilderNode[]
  customCss: string
  onChange: (system: DesignSystem) => void
}

const presetNames: TypographyPresetName[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body']
const requiredColorIds = ['primary', 'secondary', 'accent', 'neutral', 'background', 'foreground', 'surface', 'on-primary']
const presetLabels: Record<TypographyPresetName, string> = { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', body: 'Body' }
const globalLabels: Record<string, string> = {
  backgroundColor: 'Background color', color: 'Text color', borderColor: 'Border color', borderWidth: 'Border width', borderStyle: 'Border style',
  borderRadius: 'Corner radius', padding: 'Padding', paddingBlock: 'Vertical padding', paddingInline: 'Horizontal padding', boxShadow: 'Shadow', textDecoration: 'Text decoration',
}

function uniqueId(name: string, existing: string[]) {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 25) || 'token'
  let id = stem
  let suffix = 2
  while (existing.includes(id)) id = `${stem.slice(0, 31 - String(suffix).length)}-${suffix++}`
  return id
}

export function DesignSystemManager({ system, nodes, customCss, onChange }: Props) {
  const active = system.palettes.find((palette) => palette.id === system.activePaletteId) ?? system.palettes[0]!
  const references = [nodes, system.globalStyles, customCss]
  const isReferenced = (kind: 'color' | 'spacing' | 'size', id: string) => {
    const variable = `--wc-${kind === 'color' ? 'color' : kind === 'spacing' ? 'spacing' : 'size'}-${id}`
    return new RegExp(`${variable}(?![a-z0-9-])`).test(JSON.stringify(references))
  }
  const patchPalette = (paletteId: string, update: (palette: DesignSystem['palettes'][number]) => DesignSystem['palettes'][number]) => {
    onChange({ ...system, palettes: system.palettes.map((palette) => palette.id === paletteId ? update(palette) : palette) })
  }
  const patchTokenGroup = (group: 'spacingTokens' | 'sizingTokens', update: (tokens: DesignSystem[typeof group]) => DesignSystem[typeof group]) => {
    onChange({ ...system, [group]: update(system[group]) })
  }
  const addPalette = () => {
    if (system.palettes.length >= 12) return
    const name = `Palette ${system.palettes.length + 1}`
    const id = uniqueId(name, system.palettes.map((palette) => palette.id))
    onChange({ ...system, activePaletteId: id, palettes: [...system.palettes, { id, name, tokens: active.tokens.map((token) => ({ ...token })) }] })
  }
  const removePalette = () => {
    if (system.palettes.length <= 1) return
    const palettes = system.palettes.filter((palette) => palette.id !== active.id)
    onChange({ ...system, palettes, activePaletteId: palettes[0]!.id })
  }
  const addColorToken = () => {
    if (active.tokens.length >= 32) return
    const id = uniqueId('new-color', active.tokens.map((token) => token.id))
    const token = { id, name: 'New color', value: '#64748b' }
    onChange({ ...system, palettes: system.palettes.map((palette) => ({ ...palette, tokens: [...palette.tokens, { ...token }] })) })
  }
  const removeColorToken = (id: string) => {
    if (active.tokens.length <= 8 || requiredColorIds.includes(id) || isReferenced('color', id)) return
    onChange({ ...system, palettes: system.palettes.map((palette) => ({ ...palette, tokens: palette.tokens.filter((token) => token.id !== id) })) })
  }
  const addDimensionToken = (group: 'spacingTokens' | 'sizingTokens', name: string, value: string) => {
    const tokens = system[group]
    if (tokens.length >= 32) return
    const id = uniqueId(name, tokens.map((token) => token.id))
    patchTokenGroup(group, (current) => [...current, { id, name, value }])
  }
  const removeDimensionToken = (group: 'spacingTokens' | 'sizingTokens', kind: 'spacing' | 'size', id: string) => {
    if (system[group].length <= 1 || isReferenced(kind, id)) return
    patchTokenGroup(group, (tokens) => tokens.filter((token) => token.id !== id))
  }
  const updateTypography = <K extends keyof DesignSystem['typography']>(key: K, value: DesignSystem['typography'][K]) => {
    onChange({ ...system, typography: { ...system.typography, [key]: value } })
  }
  const updateGlobal = (group: keyof DesignSystem['globalStyles'], key: string, value: string) => {
    const globalStyles = structuredClone(system.globalStyles)
    ;(globalStyles[group] as Record<string, string>)[key] = value
    onChange({ ...system, globalStyles })
  }

  return <section className="project-settings-section design-system-manager">
    <div className="settings-subhead"><div><b>Design system</b><small>Project tokens update every linked element and the standalone CSS export.</small></div></div>
    <section className="design-system-group">
      <div className="design-system-title"><b>Color palettes</b><Button type="button" size="sm" disabled={system.palettes.length >= 12} onClick={addPalette}>Add palette</Button></div>
      <div className="settings-form-grid"><label className="field-label">Active palette<select className="input" value={active.id} onChange={(event) => onChange({ ...system, activePaletteId: event.target.value })}>{system.palettes.map((palette) => <option key={palette.id} value={palette.id}>{palette.name}</option>)}</select></label><label className="field-label">Palette name<Input value={active.name} maxLength={48} onChange={(event) => patchPalette(active.id, (palette) => ({ ...palette, name: event.target.value }))}/></label></div>
      <div className="design-system-color-list">{active.tokens.map((token) => <div className="design-system-token-row" key={token.id}><Input aria-label={`${token.name} token name`} value={token.name} maxLength={48} onChange={(event) => patchPalette(active.id, (palette) => ({ ...palette, tokens: palette.tokens.map((item) => item.id === token.id ? { ...item, name: event.target.value } : item) }))}/><input className="input color-input" type="color" aria-label={`Pick ${token.name} color`} value={/^#[0-9a-f]{6}$/i.test(token.value) ? token.value : "#000000"} onChange={(event) => patchPalette(active.id, (palette) => ({ ...palette, tokens: palette.tokens.map((item) => item.id === token.id ? { ...item, value: event.target.value } : item) }))}/><Input aria-label={`${token.name} color value`} value={token.value} maxLength={80} placeholder="#hex or rgb()" onChange={(event) => patchPalette(active.id, (palette) => ({ ...palette, tokens: palette.tokens.map((item) => item.id === token.id ? { ...item, value: event.target.value } : item) }))}/><code>--wc-color-{token.id}</code><button type="button" className="token-remove" aria-label={`Remove ${token.name} color token`} title={requiredColorIds.includes(token.id) ? 'Required foundation token' : isReferenced('color', token.id) ? 'Token is used by project content or global styles' : 'Remove color token'} disabled={active.tokens.length <= 8 || requiredColorIds.includes(token.id) || isReferenced('color', token.id)} onClick={() => removeColorToken(token.id)}>×</button></div>)}</div>
      <div className="design-system-actions"><Button type="button" size="sm" disabled={active.tokens.length >= 32} onClick={addColorToken}>Add color token</Button><Button type="button" size="sm" disabled={system.palettes.length <= 1} onClick={removePalette}>Remove active palette</Button></div>
      <small className="settings-help">Color token IDs stay consistent across palettes so switching palettes does not break element links. Tokens used by pages or global styles cannot be removed.</small>
    </section>

    <section className="design-system-group">
      <div className="design-system-title"><b>Typography presets</b></div>
      <div className="settings-form-grid"><label className="field-label">Body font<select className="input" value={system.typography.bodyFontFamily} onChange={(event) => updateTypography('bodyFontFamily', event.target.value as DesignSystem['typography']['bodyFontFamily'])}>{['Inter', 'system-ui', 'Georgia', 'Arial'].map((family) => <option key={family}>{family}</option>)}</select></label><label className="field-label">Heading font<select className="input" value={system.typography.headingFontFamily} onChange={(event) => updateTypography('headingFontFamily', event.target.value as DesignSystem['typography']['headingFontFamily'])}>{['Inter', 'system-ui', 'Georgia', 'Arial'].map((family) => <option key={family}>{family}</option>)}</select></label></div>
      <div className="design-system-typography-list">{presetNames.map((name) => <div className="design-system-type-row" key={name}><b>{presetLabels[name]}</b><label className="field-label">Size<Input value={system.typography.presets[name].fontSize} maxLength={120} onChange={(event) => updateTypography('presets', { ...system.typography.presets, [name]: { ...system.typography.presets[name], fontSize: event.target.value } })}/></label><label className="field-label">Weight<Input type="number" min={100} max={900} step={50} value={system.typography.presets[name].fontWeight} onChange={(event) => updateTypography('presets', { ...system.typography.presets, [name]: { ...system.typography.presets[name], fontWeight: Number(event.target.value) } })}/></label><label className="field-label">Line height<Input value={system.typography.presets[name].lineHeight} maxLength={120} onChange={(event) => updateTypography('presets', { ...system.typography.presets, [name]: { ...system.typography.presets[name], lineHeight: event.target.value } })}/></label><label className="field-label">Letter spacing<Input value={system.typography.presets[name].letterSpacing} maxLength={120} onChange={(event) => updateTypography('presets', { ...system.typography.presets, [name]: { ...system.typography.presets[name], letterSpacing: event.target.value } })}/></label></div>)}</div>
    </section>

    {(['spacingTokens', 'sizingTokens'] as const).map((group) => {
      const kind = group === 'spacingTokens' ? 'spacing' : 'size'
      const title = group === 'spacingTokens' ? 'Spacing tokens' : 'Sizing tokens'
      const addLabel = group === 'spacingTokens' ? 'New spacing' : 'New size'
      return <section className="design-system-group" key={group}><div className="design-system-title"><b>{title}</b><Button type="button" size="sm" disabled={system[group].length >= 32} onClick={() => addDimensionToken(group, addLabel, '1rem')}>Add token</Button></div><div className="design-system-dimension-list">{system[group].map((token) => <div className="design-system-token-row" key={token.id}><Input aria-label={`${token.name} token name`} value={token.name} maxLength={48} onChange={(event) => patchTokenGroup(group, (tokens) => tokens.map((item) => item.id === token.id ? { ...item, name: event.target.value } : item))}/><Input aria-label={`${token.name} token value`} value={token.value} maxLength={32} placeholder="1rem" onChange={(event) => patchTokenGroup(group, (tokens) => tokens.map((item) => item.id === token.id ? { ...item, value: event.target.value } : item))}/><code>--wc-{kind === 'spacing' ? 'spacing' : 'size'}-{token.id}</code><button type="button" className="token-remove" aria-label={`Remove ${token.name} token`} title={isReferenced(kind, token.id) ? 'Token is used by project content or global styles' : 'Remove token'} disabled={system[group].length <= 1 || isReferenced(kind, token.id)} onClick={() => removeDimensionToken(group, kind, token.id)}>×</button></div>)}</div><small className="settings-help">Use non-negative CSS lengths such as px, rem, em, %, vw, vh, dvw, dvh, or ch.</small></section>
    })}

    <section className="design-system-group"><div className="design-system-title"><b>Global styles</b></div><div className="design-system-global-grid">{(Object.keys(system.globalStyles) as (keyof DesignSystem['globalStyles'])[]).map((group) => <div className="design-system-global-group" key={group}><b>{group === 'navigation' ? 'Navigation' : group[0]!.toUpperCase() + group.slice(1)}</b>{Object.entries(system.globalStyles[group]).map(([key, value]) => <label className="field-label" key={key}>{globalLabels[key] ?? key}<Input value={value} maxLength={120} onChange={(event) => updateGlobal(group, key, event.target.value)}/></label>)}</div>)}</div></section>
  </section>
}
