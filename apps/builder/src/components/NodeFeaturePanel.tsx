import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { AnimationConfig } from '@webcraft/core/animation'
import { createDefaultFormConfig, type FormConfig } from '@webcraft/core/forms'
import type { BuilderNode } from '@webcraft/core/schema'
import { Button } from './ui'
import { Input } from './ui'
import { AnimationBuilder } from './AnimationBuilder'
import { FormBuilder } from './FormBuilder'

type Props = { node: BuilderNode; onFormChange: (value: FormConfig) => void; onAnimationChange: (value: AnimationConfig | undefined) => void; onError: (message: string) => void; onTitleChange: (value: string) => void }
export function NodeFeaturePanel({ node, onFormChange, onAnimationChange, onError, onTitleChange }: Props) {
  const [open, setOpen] = useState(false)
  const hasForm = ['form', 'contact-form', 'newsletter'].includes(node.type)
  const formDefault = createDefaultFormConfig(node.type === 'newsletter' ? 'Newsletter' : 'Contact us')
  return <>
    <Button className="node-feature-trigger" size="sm" variant="secondary" onClick={() => setOpen(true)}><Sparkles size={14}/>{hasForm ? 'Form & motion' : 'Motion'}</Button>
    {open && <div className="modal-backdrop node-feature-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section className="modal-card node-feature-modal" role="dialog" aria-modal="true" aria-labelledby="node-feature-title">
        <div className="modal-head"><span className="modal-icon"><Sparkles size={18}/></span><button type="button" className="close-modal" aria-label="Close component behavior" onClick={() => setOpen(false)}><X size={16}/></button></div>
        <span className="eyebrow">COMPONENT BEHAVIOR</span><h2 id="node-feature-title">{hasForm ? 'Form & motion' : 'Motion'} settings</h2><p>Settings are saved on this page component. Editor and preview never send form submissions.</p>
        {hasForm && <><label className="field-label">Form heading<Input key={`title-${node.id}-${node.props.text ?? ''}`} defaultValue={node.props.text ?? 'Contact us'} maxLength={2000} onBlur={(event) => onTitleChange(event.currentTarget.value)}/></label><FormBuilder key={node.id} value={node.props.formConfig ?? formDefault} onChange={onFormChange} onError={onError}/></>}
        <AnimationBuilder key={`animation-${node.id}`} node={node} onChange={onAnimationChange} onError={onError}/>
        <div className="modal-actions"><Button type="button" onClick={() => setOpen(false)}>Done</Button></div>
      </section>
    </div>}
  </>
}
