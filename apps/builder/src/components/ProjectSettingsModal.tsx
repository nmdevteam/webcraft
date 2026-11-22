import type { FormEvent } from 'react'
import { History, Plus, Save, Trash2 } from 'lucide-react'
import type { BuilderNode, DesignSystem, ProjectSettings } from '@webcraft/core/schema'
import { Button, Input } from './ui'
import { DesignSystemManager } from './DesignSystemManager'

type Asset = { id: string; filename: string; name?: string; alt?: string }
type Props = {
  projectName: string
  settings: ProjectSettings
  assets: Asset[]
  pages: BuilderNode[][]
  saving: boolean
  onChange: (settings: ProjectSettings) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
  onOpenHistory: () => void
}

export function ProjectSettingsModal({ projectName, settings, assets, pages, saving, onChange, onSubmit, onClose, onOpenHistory }: Props) {
  const patch = (values: Partial<ProjectSettings>) => onChange({ ...settings, ...values })
  const changePrimaryColor = (value: string) => {
    const designSystem = settings.designSystem!
    patch({ primaryColor: value, designSystem: { ...designSystem, palettes: designSystem.palettes.map((palette) => palette.id !== designSystem.activePaletteId ? palette : { ...palette, tokens: palette.tokens.map((token) => token.id === 'primary' ? { ...token, value } : token) }) } })
  }
  const changeFontFamily = (value: ProjectSettings['fontFamily']) => {
    const designSystem = settings.designSystem!
    patch({ fontFamily: value, designSystem: { ...designSystem, typography: { ...designSystem.typography, bodyFontFamily: value, headingFontFamily: value } } })
  }
  const changeDesignSystem = (designSystem: DesignSystem) => {
    const activePalette = designSystem.palettes.find((palette) => palette.id === designSystem.activePaletteId)!
    patch({ designSystem, primaryColor: activePalette.tokens.find((token) => token.id === 'primary')!.value, fontFamily: designSystem.typography.bodyFontFamily })
  }
  const mediaPath = (asset: Asset) => `/media/${asset.filename}`
  const updateMeta = (index: number, values: Partial<ProjectSettings['customMetaTags'][number]>) => {
    const customMetaTags = [...settings.customMetaTags]
    customMetaTags[index] = { ...customMetaTags[index]!, ...values }
    patch({ customMetaTags })
  }
  return <div className="modal-backdrop"><form className="modal-card project-settings-modal" onSubmit={onSubmit}>
    <div className="modal-head"><span className="modal-icon"><Save size={18}/></span><button type="button" className="close-modal" onClick={onClose} aria-label="Close settings">×</button></div>
    <span className="eyebrow">WEBSITE SETTINGS</span><h2>Make it yours</h2><p>These settings are saved with this project and applied to its preview and export.</p>
    <label className="field-label">Website title<Input value={settings.title || projectName} maxLength={120} onChange={(e)=>patch({ title: e.target.value })}/></label>
    <label className="field-label">Meta description<textarea className="input textarea" value={settings.description} maxLength={300} onChange={(e)=>patch({ description: e.target.value })}/></label>
    <label className="field-label">Public site origin<Input type="url" value={settings.siteUrl} maxLength={300} placeholder="https://example.com" onChange={(e)=>patch({ siteUrl: e.target.value.trim() })}/><small className="settings-help">Used for canonical URLs and absolute sitemap entries. Leave blank until you know the public domain.</small></label>
    <div className="settings-form-grid">
      <label className="field-label">Language tag<Input value={settings.language} maxLength={12} placeholder="en or en-US" onChange={(e)=>patch({ language: e.target.value })}/></label>
      <label className="field-label">Brand color<div className="brand-color-control"><Input value={settings.primaryColor} maxLength={80} placeholder="#5b5ce2 or rgb()/hsl()" onChange={(e)=>changePrimaryColor(e.target.value)}/><input className="input color-input" type="color" aria-label="Pick brand color in HEX" value={/^#[0-9a-f]{6}$/i.test(settings.primaryColor) ? settings.primaryColor : '#5b5ce2'} onChange={(e)=>changePrimaryColor(e.target.value)}/></div></label>
      <label className="field-label">Default font<select className="input" value={settings.fontFamily} onChange={(e)=>changeFontFamily(e.target.value as ProjectSettings['fontFamily'])}><option>Inter</option><option>system-ui</option><option>Georgia</option><option>Arial</option></select></label>
    </div>
    <div className="settings-form-grid">
      <label className="field-label">Website logo<select className="input" value={settings.logoPath} onChange={(e)=>patch({ logoPath: e.target.value })}><option value="">No logo</option>{assets.map((asset)=><option key={asset.id} value={mediaPath(asset)}>{asset.name || asset.alt || asset.filename}</option>)}</select></label>
      <label className="field-label">Favicon<select className="input" value={settings.faviconPath} onChange={(e)=>patch({ faviconPath: e.target.value })}><option value="">Browser default</option>{assets.map((asset)=><option key={asset.id} value={mediaPath(asset)}>{asset.name || asset.alt || asset.filename}</option>)}</select></label>
      <label className="field-label">Social sharing image<select className="input" value={settings.socialImagePath} onChange={(e)=>patch({ socialImagePath: e.target.value })}><option value="">No social image</option>{assets.map((asset)=><option key={asset.id} value={mediaPath(asset)}>{asset.name || asset.alt || asset.filename}</option>)}</select><small className="settings-help">Used for Open Graph and Twitter previews when a public site origin is configured.</small></label>
    </div>
    {assets.length === 0 && <small className="settings-help">Upload an image in the Assets panel first to choose a logo or favicon.</small>}
    <section className="project-settings-section"><div className="settings-subhead"><div><b>Responsive breakpoints</b><small>Widths used by responsive styles and preview device modes.</small></div></div>
      <div className="settings-form-grid"><label className="field-label">Mobile max width (px)<Input type="number" min={360} max={767} value={settings.breakpoints.mobile} onChange={(e)=>patch({ breakpoints: { ...settings.breakpoints, mobile: Number(e.target.value) } })}/></label><label className="field-label">Tablet max width (px)<Input type="number" min={768} max={1280} value={settings.breakpoints.tablet} onChange={(e)=>patch({ breakpoints: { ...settings.breakpoints, tablet: Number(e.target.value) } })}/></label></div>
    </section>
    <section className="project-settings-section"><div className="settings-subhead"><div><b>Automatic version snapshots</b><small>After meaningful edits are saved, keep a project-wide recovery point at this interval.</small></div></div>
      <label className="field-label">Snapshot interval<select className="input" value={settings.historyIntervalMinutes} onChange={(e)=>patch({ historyIntervalMinutes: Number(e.target.value) })}><option value={0}>Off</option><option value={5}>Every 5 minutes</option><option value={15}>Every 15 minutes</option><option value={30}>Every 30 minutes</option><option value={60}>Every hour</option><option value={1440}>Every day</option></select></label>
    </section>
    <DesignSystemManager system={settings.designSystem!} nodes={pages.flat()} customCss={settings.customCss} onChange={changeDesignSystem}/>
    <section className="project-settings-section"><div className="settings-subhead"><div><b>Custom CSS</b><small>Added to the standalone site. @import and executable URL schemes are blocked.</small></div></div>
      <label className="field-label">Styles<textarea className="input textarea code-textarea" value={settings.customCss} maxLength={20000} spellCheck={false} placeholder=".wc-site-brand { padding: 1rem; }" onChange={(e)=>patch({ customCss: e.target.value })}/></label><small className="settings-help">{settings.customCss.length.toLocaleString()} / 20,000 characters</small>
    </section>
    <section className="project-settings-section"><div className="settings-subhead"><div><b>Custom HTML metadata</b><small>Only safe name/property meta tags are generated; scripts and arbitrary HTML are not accepted.</small></div><Button type="button" size="sm" disabled={settings.customMetaTags.length >= 16} onClick={()=>patch({ customMetaTags: [...settings.customMetaTags, { attribute: 'name', key: '', content: '' }] })}><Plus size={14}/>Add meta tag</Button></div>
      {settings.customMetaTags.length === 0 && <small className="settings-help">No custom meta tags yet. Add a tag to configure Open Graph, theme color, or other metadata.</small>}
      {settings.customMetaTags.map((tag,index)=><div className="meta-tag-row" key={`meta-${index}`}>
        <label className="field-label">Attribute<select className="input" value={tag.attribute} onChange={(e)=>updateMeta(index,{ attribute: e.target.value as 'name'|'property' })}><option value="name">name</option><option value="property">property</option></select></label>
        <label className="field-label">Key<Input value={tag.key} maxLength={80} placeholder="og:title" onChange={(e)=>updateMeta(index,{ key: e.target.value })}/></label>
        <label className="field-label meta-content">Content<Input value={tag.content} maxLength={300} placeholder="Metadata value" onChange={(e)=>updateMeta(index,{ content: e.target.value })}/></label>
        <button type="button" className="icon-button meta-remove" aria-label={`Remove meta tag ${index+1}`} onClick={()=>patch({ customMetaTags: settings.customMetaTags.filter((_,i)=>i!==index) })}><Trash2 size={15}/></button>
      </div>)}
    </section>
    <section className="project-settings-section"><div className="settings-subhead"><div><b>Structured data (JSON-LD)</b><small>Optional single schema.org object. It is JSON-validated and safely escaped in the generated HTML.</small></div></div>
      <label className="field-label">Schema JSON<textarea className="input textarea code-textarea" value={settings.structuredData} maxLength={10000} spellCheck={false} placeholder={'{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Example"\n}'} onChange={(e)=>patch({ structuredData: e.target.value })}/></label><small className="settings-help">{settings.structuredData.length.toLocaleString()} / 10,000 characters</small>
    </section>
    <div className="modal-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="button" onClick={onOpenHistory}><History size={15}/>Version history</Button><Button variant="primary" type="submit" busy={saving}><Save size={15}/>Save settings</Button></div>
  </form></div>
}
