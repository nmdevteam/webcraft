import { useMemo, useState } from 'react'
import { FormConfigSchema, FormFieldSchema, FORM_FIELD_TYPES, type FormConfig, type FormField, type FormFieldType } from '@webcraft/core/forms'
import { Button, Input } from './ui'

type Props = { value?: FormConfig; onChange: (value: FormConfig) => void; onError?: (message: string) => void }
const choiceTypes = new Set<FormFieldType>(['select', 'radio', 'checkbox'])

function freshField(type: FormFieldType, index: number): FormField {
  const base = { id: `field-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`, type, name: `field${index}`, label: `Field ${index}`, required: false, options: [] as { value: string; label: string }[], multiple: false }
  return FormFieldSchema.parse(type === 'select' || type === 'radio' || type === 'checkbox' ? { ...base, options: [{ value: 'option-1', label: 'Option 1' }, { value: 'option-2', label: 'Option 2' }] } : base)
}

export function FormBuilder({ value, onChange, onError }: Props) {
  const parsed = useMemo(() => FormConfigSchema.safeParse(value), [value])
  const config = parsed.success ? parsed.data : FormConfigSchema.parse({ fields: [{ id: 'name', type: 'text', name: 'name', label: 'Your name', required: true }, { id: 'email', type: 'email', name: 'email', label: 'Email address', required: true }, { id: 'message', type: 'textarea', name: 'message', label: 'Message', required: true }, { id: 'submit', type: 'submit', name: 'submit', label: 'Send message' }] })
  const [endpointDraft, setEndpointDraft] = useState(config.endpointUrl ?? '')
  const [localError, setLocalError] = useState('')
  const error = (message: string) => { setLocalError(message); onError?.(message) }
  const commit = (candidate: unknown) => {
    const result = FormConfigSchema.safeParse(candidate)
    if (!result.success) { error(result.error.issues[0]?.message ?? 'Form settings are invalid.'); return false }
    setLocalError(''); onChange(result.data); return true
  }
  const updateField = (index: number, patch: Partial<FormField>) => commit({ ...config, fields: config.fields.map((field, i) => i === index ? { ...field, ...patch } : field) })
  const changeType = (index: number, type: FormFieldType) => {
    const current = config.fields[index]
    if (!current || type === 'submit') return
    const next = freshField(type, index + 1)
    const compatible = { ...next, id: current.id, name: current.name, label: current.label, description: current.description, placeholder: ['text', 'email', 'password', 'number', 'textarea'].includes(type) ? current.placeholder : undefined, required: current.required }
    updateField(index, compatible)
  }
  const saveEndpoint = () => {
    const endpointUrl = endpointDraft.trim()
    commit({ ...config, ...(endpointUrl ? { endpointUrl } : { endpointUrl: undefined }) })
  }
  const setMode = (mode: FormConfig['submissionMode']) => {
    if (mode === 'external' && !config.endpointUrl) { error('Enter a valid endpoint before enabling external submissions.'); return }
    commit({ ...config, submissionMode: mode })
  }
  const addField = () => {
    const submitIndex = config.fields.findIndex((field) => field.type === 'submit')
    const fields = [...config.fields]
    fields.splice(submitIndex < 0 ? fields.length : submitIndex, 0, freshField('text', fields.length + 1))
    commit({ ...config, fields })
  }
  const removeField = (index: number) => commit({ ...config, fields: config.fields.filter((_, i) => i !== index) })
  return <section className="inspector-section form-builder">
    <span className="inspector-label">FORM BUILDER</span>
    <label className="field-label">Submission behavior<select className="input" value={config.submissionMode} onChange={(event) => setMode(event.target.value as FormConfig['submissionMode'])}><option value="frontend-only">Frontend only — no sending or storage</option><option value="external">External endpoint — exported site only</option></select></label>
    <label className="field-label">HTTPS endpoint or same-origin path<Input value={endpointDraft} maxLength={500} placeholder="https://forms.example/submit or /api/contact" onChange={(event) => setEndpointDraft(event.target.value)} onBlur={saveEndpoint}/></label>
    {config.submissionMode === 'frontend-only' ? <p className="form-builder-note">No data is sent or saved. Only the exported site can POST to a configured endpoint; editor and preview submissions stay disabled.</p> : <p className="form-builder-note">The exported site sends multipart form data to this endpoint without cookies or credentials. A cross-origin endpoint must allow this site through CORS. WebCraft does not receive or store submissions.</p>}
    <label className="field-label">Success message<Input key={`success-${config.successMessage}`} defaultValue={config.successMessage} maxLength={300} onBlur={(event) => commit({ ...config, successMessage: event.currentTarget.value })}/></label>
    <label className="field-label">Error message<Input key={`error-${config.errorMessage}`} defaultValue={config.errorMessage} maxLength={300} onBlur={(event) => commit({ ...config, errorMessage: event.currentTarget.value })}/></label>
    <div className="form-builder-fields"><div className="form-builder-heading"><b>Fields</b><Button size="sm" type="button" onClick={addField}><span aria-hidden="true">+</span>Add field</Button></div>
      {config.fields.map((field, index) => <fieldset className="form-builder-field" key={field.id}>
        <legend>{field.type === 'submit' ? 'Submit button' : `Field ${index + 1}`}</legend>
        {field.type === 'submit' ? <label className="field-label">Button label<Input key={`submit-${field.label}`} defaultValue={field.label} maxLength={120} onBlur={(event) => updateField(index, { label: event.currentTarget.value })}/></label> : <>
          <label className="field-label">Type<select className="input" value={field.type} onChange={(event) => changeType(index, event.target.value as FormFieldType)}>{FORM_FIELD_TYPES.filter((type) => type !== 'submit').map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label className="field-label">Label<Input key={`label-${field.id}-${field.label}`} defaultValue={field.label} maxLength={120} onBlur={(event) => updateField(index, { label: event.currentTarget.value })}/></label>
          <label className="field-label">Field name<Input key={`name-${field.id}-${field.name}`} defaultValue={field.name} maxLength={40} onBlur={(event) => updateField(index, { name: event.currentTarget.value })}/></label>
          {['text', 'email', 'password', 'number', 'textarea'].includes(field.type) && <label className="field-label">Placeholder<Input key={`placeholder-${field.id}-${field.placeholder ?? ''}`} defaultValue={field.placeholder ?? ''} maxLength={200} onBlur={(event) => updateField(index, { placeholder: event.currentTarget.value || undefined })}/></label>}
          {choiceTypes.has(field.type) && <label className="field-label">Options <small>One per line: value | label</small><textarea className="input textarea" key={`options-${field.id}-${JSON.stringify(field.options)}`} defaultValue={field.options.map((option) => `${option.value} | ${option.label}`).join('\n')} maxLength={4000} onBlur={(event) => {
            const options = event.currentTarget.value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => { const [rawValue, ...rest] = line.split('|'); const label = rest.join('|').trim(); const optionValue = (rawValue ?? '').trim(); return { value: optionValue, label: label || optionValue } })
            updateField(index, { options })
          }}/></label>}
          {field.type !== 'checkbox' && <label className="form-builder-required"><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })}/>Required</label>}
          {field.type === 'checkbox' && <label className="form-builder-required"><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })}/>Require at least one option</label>}
          <Button size="sm" type="button" variant="danger" onClick={() => removeField(index)}>Remove field</Button>
        </>}
      </fieldset>)}
    </div>
    <div className="form-builder-status" role="status" aria-live="polite">{localError}</div>
  </section>
}
