import { useState } from 'react'
import { Settings2, X } from 'lucide-react'
import type { BaseNodeStyle, BuilderNode } from '@webcraft/core/schema'
import { Button, Input } from './ui'

type Mode = 'desktop' | 'tablet' | 'mobile'
type Props = { node: BuilderNode; onUpdate: (mode: Mode, field: keyof BaseNodeStyle, value: string | number | undefined) => void }

export function AdvancedStylePanel({ node, onUpdate }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('desktop')
  const style = mode === 'desktop' ? node.style : node.style.responsive?.[mode] ?? {}
  const textField = (label: string, field: keyof BaseNodeStyle, placeholder = '') => <label className="field-label" key={field}>{label}<Input value={typeof style[field] === 'string' ? style[field] as string : ''} maxLength={120} placeholder={placeholder} onChange={(e)=>onUpdate(mode,field,e.target.value || undefined)}/></label>
  const selectField = (label: string, field: keyof BaseNodeStyle, values: string[]) => <label className="field-label" key={field}>{label}<select className="input" value={String(style[field] ?? '')} onChange={(e)=>onUpdate(mode,field,e.target.value || undefined)}><option value="">Default</option>{values.map((value)=><option key={value} value={value}>{value}</option>)}</select></label>
  const numberField = (label: string, field: keyof BaseNodeStyle, min: number, max: number, step = 1) => <label className="field-label" key={field}>{label}<Input type="number" min={min} max={max} step={step} value={typeof style[field] === 'number' ? style[field] as number : ''} onChange={(e)=>onUpdate(mode,field,e.target.value === '' ? undefined : Number(e.target.value))}/></label>
  return <>
    <Button className="advanced-style-trigger" size="sm" variant="ghost" onClick={()=>setOpen(true)}><Settings2 size={14}/>Advanced style</Button>
    {open && <div className="modal-backdrop advanced-style-backdrop"><section className="modal-card advanced-style-modal" role="dialog" aria-modal="true" aria-labelledby="advanced-style-title">
      <div className="modal-head"><span className="modal-icon"><Settings2 size={18}/></span><button type="button" className="close-modal" aria-label="Close advanced styles" onClick={()=>setOpen(false)}><X size={16}/></button></div>
      <span className="eyebrow">COMPONENT STYLES</span><h2 id="advanced-style-title">Advanced styling</h2><p>Overrides are saved with this component and applied at the selected viewport width.</p>
      <label className="field-label">Edit styles for<select className="input" value={mode} onChange={(e)=>setMode(e.target.value as Mode)}><option value="desktop">Desktop · base styles</option><option value="tablet">Tablet · responsive override</option><option value="mobile">Mobile · responsive override</option></select></label>
      <div className="advanced-style-grid">
        <div className="advanced-style-group"><b>Layout</b>{selectField('Display','display',['block','flex','inline-flex','grid'])}{numberField('Grid columns','gridColumns',1,12)}{selectField('Flex direction','flexDirection',['row','row-reverse','column','column-reverse'])}{selectField('Justify content','justifyContent',['flex-start','center','flex-end','space-between','space-around','space-evenly'])}{selectField('Align items','alignItems',['stretch','flex-start','center','flex-end','baseline'])}{selectField('Flex wrap','flexWrap',['nowrap','wrap','wrap-reverse'])}</div>
        <div className="advanced-style-group"><b>Size & spacing</b>{textField('Width','width','100%')}{textField('Min width','minWidth','0')}{textField('Max width','maxWidth','1200px')}{textField('Height','height','auto')}{textField('Min height','minHeight','0')}{textField('Max height','maxHeight','none')}{textField('Padding','padding','1rem')}{textField('Margin','margin','0 auto')}{textField('Gap','gap','1rem')}{selectField('Overflow','overflow',['visible','hidden','auto'])}</div>
        <div className="advanced-style-group"><b>Border & shadow</b>{textField('Border','border','1px solid #ddd')}{textField('Border width','borderWidth','1px')}{selectField('Border style','borderStyle',['none','solid','dashed','dotted','double'])}{textField('Border color','borderColor','#ddd')}{textField('Corner radius','borderRadius','0.5rem')}{textField('Box shadow','boxShadow','0 4px 12px rgba(0,0,0,.1)')}{numberField('Opacity','opacity',0,1,0.05)}</div>
        <div className="advanced-style-group"><b>Typography</b>{textField('Font weight','fontWeight','400')}{selectField('Font style','fontStyle',['normal','italic','oblique'])}{selectField('Text decoration','textDecoration',['none','underline','line-through'])}{selectField('Text transform','textTransform',['none','uppercase','lowercase','capitalize'])}{textField('Line height','lineHeight','1.5')}{textField('Letter spacing','letterSpacing','0.02em')}</div>
      </div>
      <div className="modal-actions"><Button type="button" onClick={()=>setOpen(false)}>Done</Button></div>
    </section></div>}
  </>
}
