import React from 'react'
import type { CSSProperties } from 'react'
import type { BaseNodeStyle, BuilderNode, ComponentType, ProjectSettings } from './schema'
import { responsiveStyleCss, safeUrl } from './schema'
import { safeDesignSystemCss } from './design-system'
import { animationCss } from './animation'
import { createDefaultFormConfig, FormConfigSchema, type FormConfig, type FormField } from './forms'

export type NodeEditProps = {
  selectedId?: string | null
  selectedIds?: string[]
  editMode?: boolean
  onSelect?: (id: string, additive?: boolean) => void
  onClearSelection?: () => void
  onTextChange?: (id: string, text: string) => void
  pageSlugs?: string[]
  formSubmissionEnabled?: boolean
}

const blockTags: Partial<Record<ComponentType, keyof React.JSX.IntrinsicElements>> = {
  section: 'section', container: 'div', heading: 'h2', paragraph: 'p', text: 'span', button: 'a', link: 'a', image: 'img', video: 'video',
  icon: 'span', divider: 'hr', spacer: 'div', grid: 'div', flex: 'div', columns: 'div', card: 'article', navbar: 'nav', footer: 'footer',
  hero: 'section', features: 'section', testimonials: 'section', pricing: 'section', faq: 'section', team: 'section', statistics: 'section',
  gallery: 'section', 'contact-form': 'section', newsletter: 'section', form: 'section', cta: 'section',
}

const styleKeys: (keyof BaseNodeStyle)[] = [
  'color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'textTransform', 'textAlign', 'lineHeight', 'letterSpacing',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderRadius', 'border', 'borderWidth', 'borderStyle', 'borderColor', 'boxShadow', 'gap', 'rowGap', 'columnGap', 'display', 'flexDirection',
  'justifyContent', 'alignItems', 'flexWrap', 'maxWidth', 'minWidth', 'width', 'maxHeight', 'minHeight', 'height', 'overflow', 'opacity',
]

function useAuthenticatedMediaUrl(source: string): string {
  const [displayUrl, setDisplayUrl] = React.useState('')
  const [sessionVersion, setSessionVersion] = React.useState(0)
  React.useEffect(() => {
    const onSessionChange = () => { setDisplayUrl(''); setSessionVersion((version) => version + 1) }
    window.addEventListener('webcraft:session-change', onSessionChange)
    return () => window.removeEventListener('webcraft:session-change', onSessionChange)
  }, [])
  React.useEffect(() => {
    setDisplayUrl('')
    const match = /^\/media\/([A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif))$/i.exec(source)
    if (!match) {
      setDisplayUrl(source)
      return
    }
    const token = window.sessionStorage.getItem('webcraft-session')
    if (!token) return
    const controller = new AbortController()
    let objectUrl = ''
    let active = true
    void fetch(`/api/assets/file/${encodeURIComponent(match[1]!)}`, { headers: { Authorization: `JWT ${token}` }, cache: 'no-store', signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Asset unavailable'); return response.blob() })
      .then((blob) => { if (active) { objectUrl = URL.createObjectURL(blob); setDisplayUrl(objectUrl) } })
      .catch(() => { if (active) setDisplayUrl('') })
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [source, sessionVersion])
  return displayUrl
}

function safeStyle(node: BuilderNode): CSSProperties {
  const source = node.style as BaseNodeStyle
  const result: CSSProperties = {}
  for (const key of styleKeys) {
    const value = source[key]
    if (value !== undefined) (result as Record<string, unknown>)[key] = value
  }
  if (source.gridColumns) result.gridTemplateColumns = `repeat(${source.gridColumns}, minmax(0, 1fr))`
  if (node.type === 'grid' || node.type === 'columns') result.display = source.display ?? 'grid'
  if (node.type === 'flex') result.display = source.display ?? 'flex'
  return result
}

export function RenderNode({ node, selectedId, selectedIds, editMode = false, onSelect, onTextChange, pageSlugs = [], formSubmissionEnabled = false }: NodeEditProps & { node: BuilderNode }) {
  const tag = blockTags[node.type] ?? 'div'
  const Tag = tag as React.ElementType
  const mediaSrc = useAuthenticatedMediaUrl(node.props.src ? safeUrl(node.props.src, '') : '')
  const text = node.props.text ?? labelFor(node.type)
  const editable = ['heading', 'paragraph', 'text', 'button', 'link', 'cta', 'hero'].includes(node.type)
  const href = safeUrl(node.props.href, '#')
  const isLocalPage = href.startsWith('/') && href !== '/' && !href.startsWith('//')
  const validPageLink = !isLocalPage || pageSlugs.length === 0 || pageSlugs.includes(href.replace(/^\//, ''))
  const isSelected = selectedIds ? selectedIds.includes(node.id) : selectedId === node.id
  const common = {
    key: node.id,
    className: `wc-node wc-${node.type}${node.type === 'heading' ? ` wc-heading-level-${node.props.level ?? 2}` : ''}${isSelected ? ' is-selected' : ''}`,
    style: safeStyle(node),
    'data-node-id': node.id,
    'data-wc-motion': node.animation?.enabled ? node.animation.trigger : undefined,
    'data-wc-motion-once': node.animation?.enabled ? String(node.animation.once) : undefined,
    'data-wc-motion-duration': node.animation?.enabled ? node.animation.durationMs : undefined,
    'data-wc-motion-delay': node.animation?.enabled ? node.animation.delayMs : undefined,
    onPointerDown: editMode ? (event: React.PointerEvent) => { event.stopPropagation(); onSelect?.(node.id, event.shiftKey || event.metaKey || event.ctrlKey) } : undefined,
  }
  const contentProps = editable ? {
    contentEditable: editMode,
    suppressContentEditableWarning: true,
    onBlur: editMode ? (event: React.FocusEvent<HTMLElement>) => onTextChange?.(node.id, event.currentTarget.textContent ?? '') : undefined,
  } : {}
  const children = node.children.map((child) => <RenderNode key={child.id} node={child} selectedId={selectedId} selectedIds={selectedIds} editMode={editMode} onSelect={onSelect} onTextChange={onTextChange} pageSlugs={pageSlugs} formSubmissionEnabled={formSubmissionEnabled} />)
  if (node.type === 'image') return <img {...common} src={mediaSrc || undefined} alt={node.props.alt ?? ''} loading="lazy" />
  if (node.type === 'video') return <video {...common} src={mediaSrc || undefined} controls preload="metadata" />
  if (node.type === 'divider') return <hr {...common} />
  if (node.type === 'spacer') return <div {...common} aria-hidden="true" style={{ ...safeStyle(node), minHeight: node.style.height ?? '2rem' }} />
  if (node.type === 'button' || node.type === 'link') {
    return <a {...common} href={href} onClick={editMode ? (event: React.MouseEvent) => event.preventDefault() : undefined} aria-invalid={!validPageLink || undefined} {...contentProps}>{text}{children}</a>
  }
  if (node.type === 'icon') return <span {...common} role="img" aria-label={node.props.label ?? 'decorative icon'}>{node.props.text ?? '✦'}</span>
  if (node.type === 'form' || node.type === 'contact-form' || node.type === 'newsletter') {
    const legacy = node.type !== 'form'
    const config = legacy ? createDefaultFormConfig(node.type === 'newsletter' ? 'Newsletter' : 'Contact us') : (FormConfigSchema.safeParse(node.props.formConfig).success ? FormConfigSchema.parse(node.props.formConfig) : createDefaultFormConfig())
    return <FormDisplay common={common} config={config} title={text} nodeId={node.id} editMode={editMode} formSubmissionEnabled={formSubmissionEnabled}>{children}</FormDisplay>
  }
  if (node.type === 'faq' || node.type === 'features' || node.type === 'testimonials' || node.type === 'pricing' || node.type === 'team' || node.type === 'statistics' || node.type === 'gallery') {
    return <section {...common}><h2 {...contentProps}>{text}</h2><div className="wc-section-content">{children}</div></section>
  }
  if (node.type === 'heading') {
    const headingTag = `h${node.props.level ?? 2}` as keyof React.JSX.IntrinsicElements
    const Heading = headingTag as React.ElementType
    return <Heading {...common} {...contentProps}>{text}{children}</Heading>
  }
  return <Tag {...common} {...contentProps}>{editable ? text : null}{children}</Tag>
}

export function SiteRenderer({ nodes, settings, pageSlug, ...props }: NodeEditProps & { nodes: BuilderNode[]; settings?: ProjectSettings; pageSlug?: string; allowExitAnimation?: boolean }) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const breakpointDefaults = { mobile: 600, tablet: 900 }
  const breakpoints = settings?.breakpoints ?? breakpointDefaults
  const responsiveCss = responsiveStyleCss(nodes, breakpoints)
  const motionCss = animationCss(nodes, breakpoints, pageSlug)
  const logoPath = settings?.logoPath && /^\/media\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif)$/i.test(settings.logoPath) ? settings.logoPath : ''
  const logoDisplayPath = useAuthenticatedMediaUrl(logoPath)
  const themeCss = settings ? safeDesignSystemCss(settings.designSystem) : ''
  React.useEffect(() => {
    const root = rootRef.current
    if (!root || props.editMode) return
    const scrollNodes = [...root.querySelectorAll<HTMLElement>('[data-wc-motion="scroll"]')]
    if (!scrollNodes.length) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let observer: IntersectionObserver | undefined
    const revealAll = () => { scrollNodes.forEach((item) => item.classList.add('wc-motion-visible')); observer?.disconnect() }
    if (preference.matches || typeof IntersectionObserver === 'undefined') revealAll()
    else {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            if (entry.target.getAttribute('data-wc-motion-once') !== 'true') entry.target.classList.remove('wc-motion-visible')
            continue
          }
          entry.target.classList.add('wc-motion-visible')
          if (entry.target.getAttribute('data-wc-motion-once') === 'true') observer?.unobserve(entry.target)
        }
      }, { threshold: 0.15 })
      scrollNodes.forEach((item) => observer?.observe(item))
      preference.addEventListener('change', (event) => { if (event.matches) revealAll() }, { once: true })
    }
    return () => observer?.disconnect()
  }, [nodes, props.editMode, pageSlug])
  React.useEffect(() => {
    const root = rootRef.current
    if (!root || props.editMode || !props.allowExitAnimation) return
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      const anchor = target?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target || anchor.hasAttribute('download') || !anchor.href || anchor.getAttribute('href')?.startsWith('#')) return
      const motionNode = anchor.closest<HTMLElement>('[data-wc-motion="exit"]')
      if (!motionNode || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      event.preventDefault()
      motionNode.classList.add('wc-motion-exiting')
      const wait = Number(motionNode.dataset.wcMotionDuration ?? 0) + Number(motionNode.dataset.wcMotionDelay ?? 0)
      window.setTimeout(() => window.location.assign(anchor.href), wait)
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [props.allowExitAnimation, props.editMode])
  return <div ref={rootRef} className={`wc-site${props.editMode ? ' is-edit-mode' : ''}`} data-page-slug={pageSlug} onPointerDown={props.editMode ? (event) => { if (event.target === event.currentTarget) props.onClearSelection?.() } : undefined}>
    {logoPath && <header className="wc-site-brand"><img src={logoDisplayPath || undefined} alt={`${settings?.title || 'Website'} logo`} /></header>}
    {themeCss && <style data-webcraft-theme>{themeCss}</style>}
    {responsiveCss && <style data-webcraft-responsive>{responsiveCss}</style>}
    {motionCss && <style data-webcraft-motion>{motionCss}</style>}
    {settings?.customCss && <style data-webcraft-custom>{settings.customCss}</style>}
    {nodes.map((node) => <RenderNode key={node.id} node={node} formSubmissionEnabled={props.formSubmissionEnabled} {...props} />)}
  </div>
}

function FormDisplay({ common, config, title, nodeId, editMode, formSubmissionEnabled, children }: { common: any; config: FormConfig; title: string; nodeId: string; editMode: boolean; formSubmissionEnabled: boolean; children: React.ReactNode }) {
  const [status, setStatus] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const fields = config.fields
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editMode) { setStatus('Forms cannot be submitted from the editor canvas.'); return }
    if (config.submissionMode === 'frontend-only') { setStatus('Preview only — this form does not send or save submissions.'); return }
    if (!formSubmissionEnabled) { setStatus('Preview only — submissions are disabled in WebCraft preview.'); return }
    const form = event.currentTarget
    for (const field of fields) {
      if (field.type === 'checkbox' && field.required) {
        const boxes = [...form.elements].filter((element): element is HTMLInputElement => element instanceof HTMLInputElement && element.name === field.name)
        if (!boxes.some((box) => box.checked)) { boxes[0]?.setCustomValidity('Select at least one option.'); boxes[0]?.reportValidity(); setStatus(config.errorMessage); return }
        boxes.forEach((box) => box.setCustomValidity(''))
      }
      if (field.type === 'file' && field.maxFileSizeBytes) {
        const input = form.elements.namedItem(field.name)
        if (input instanceof HTMLInputElement && input.files && [...input.files].some((file) => file.size > field.maxFileSizeBytes!)) {
          input.setCustomValidity(`Choose files smaller than ${Math.ceil(field.maxFileSizeBytes / 1024 / 1024)} MB.`); input.reportValidity(); setStatus(config.errorMessage); return
        }
        if (input instanceof HTMLInputElement) input.setCustomValidity('')
      }
    }
    if (!config.endpointUrl) { setStatus(config.errorMessage); return }
    setSubmitting(true); setStatus('')
    try {
      const response = await fetch(config.endpointUrl, { method: 'POST', body: new FormData(form), credentials: 'omit', mode: 'cors', redirect: 'error' })
      if (!response.ok) throw new Error('The configured endpoint did not accept the submission.')
      setStatus(config.successMessage); form.reset()
    } catch { setStatus(config.errorMessage) }
    finally { setSubmitting(false) }
  }
  return <section {...common}><h2>{title}</h2><form onSubmit={(event) => void submit(event)} aria-label={title}>
    {fields.map((field) => <FormFieldView key={`${nodeId}-${field.id}`} field={field} id={`${nodeId}-${field.id}`} disabled={editMode || submitting} />)}
    <div className="wc-form-status" role="status" aria-live="polite">{status}</div>
  </form>{children}</section>
}

function FormFieldView({ field, id, disabled }: { field: FormField; id: string; disabled: boolean }) {
  if (field.type === 'submit') return <button type="submit" disabled={disabled}>{field.label}</button>
  const descriptionId = field.description ? `${id}-description` : undefined
  const common = { id, name: field.name, required: field.type === 'checkbox' ? undefined : field.required, disabled, placeholder: field.placeholder, minLength: field.minLength, maxLength: field.maxLength, min: typeof field.min === 'string' || typeof field.min === 'number' ? field.min : undefined, max: typeof field.max === 'string' || typeof field.max === 'number' ? field.max : undefined, step: field.step, pattern: field.pattern, accept: field.accept, multiple: field.multiple, defaultValue: field.type === 'password' || field.type === 'file' ? undefined : field.defaultValue, 'aria-describedby': descriptionId }
  if (field.type === 'radio' || field.type === 'checkbox') return <fieldset disabled={disabled} aria-required={field.required || undefined} aria-describedby={descriptionId}><legend>{field.label}{field.required ? ' *' : ''}</legend>{field.options.map((option, index) => { const optionId = `${id}-${index}`; return <label key={option.value} htmlFor={optionId}><input id={optionId} type={field.type} name={field.name} value={option.value} required={field.type === 'radio' ? field.required : undefined} defaultChecked={field.defaultValue === option.value} disabled={disabled}/>{option.label}</label> })}{field.description && <small id={descriptionId}>{field.description}</small>}</fieldset>
  if (field.type === 'textarea') return <label htmlFor={id}>{field.label}{field.required ? ' *' : ''}<textarea {...common} />{field.description && <small id={descriptionId}>{field.description}</small>}</label>
  if (field.type === 'select') return <label htmlFor={id}>{field.label}{field.required ? ' *' : ''}<select {...common} defaultValue={field.defaultValue ?? ''}><option value="">Choose an option</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{field.description && <small id={descriptionId}>{field.description}</small>}</label>
  return <label htmlFor={id}>{field.label}{field.required ? ' *' : ''}<input {...common} type={field.type} />{field.description && <small id={descriptionId}>{field.description}</small>}</label>
}

function labelFor(type: ComponentType): string {
  const labels: Partial<Record<ComponentType, string>> = {
    section: 'Section', container: 'Container', heading: 'Your headline', paragraph: 'Add a paragraph describing your website.', text: 'Text', button: 'Get started', link: 'Learn more',
    image: 'Image', video: 'Video', icon: 'Icon', divider: '', spacer: '', grid: 'Grid', flex: 'Flex row', columns: 'Columns', card: 'Card title', navbar: 'Navigation', footer: 'Footer',
    hero: 'Make your next idea real.', features: 'Features', testimonials: 'What people say', pricing: 'Simple, transparent pricing', faq: 'Frequently asked questions', team: 'Meet the team', statistics: 'Our impact', gallery: 'Gallery', 'contact-form': 'Get in touch', newsletter: 'Stay in the loop', cta: 'Ready to get started?',
  }
  return labels[type] ?? 'Content'
}
