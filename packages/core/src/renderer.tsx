import React from 'react'
import type { CSSProperties } from 'react'
import type { BaseNodeStyle, BuilderNode, ComponentType, ProjectSettings } from './schema'
import { responsiveStyleCss, safeUrl } from './schema'

export type NodeEditProps = {
  selectedId?: string | null
  selectedIds?: string[]
  editMode?: boolean
  onSelect?: (id: string, additive?: boolean) => void
  onTextChange?: (id: string, text: string) => void
  pageSlugs?: string[]
}

const blockTags: Partial<Record<ComponentType, keyof React.JSX.IntrinsicElements>> = {
  section: 'section', container: 'div', heading: 'h2', paragraph: 'p', text: 'span', button: 'a', link: 'a', image: 'img', video: 'video',
  icon: 'span', divider: 'hr', spacer: 'div', grid: 'div', flex: 'div', columns: 'div', card: 'article', navbar: 'nav', footer: 'footer',
  hero: 'section', features: 'section', testimonials: 'section', pricing: 'section', faq: 'section', team: 'section', statistics: 'section',
  gallery: 'section', 'contact-form': 'section', newsletter: 'section', cta: 'section',
}

const styleKeys: (keyof BaseNodeStyle)[] = [
  'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'textTransform', 'textAlign', 'lineHeight', 'letterSpacing',
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

export function RenderNode({ node, selectedId, selectedIds, editMode = false, onSelect, onTextChange, pageSlugs = [] }: NodeEditProps & { node: BuilderNode }) {
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
    className: `wc-node wc-${node.type}${isSelected ? ' is-selected' : ''}`,
    style: safeStyle(node),
    'data-node-id': node.id,
    onPointerDown: editMode ? (event: React.PointerEvent) => { event.stopPropagation(); onSelect?.(node.id, event.shiftKey || event.metaKey || event.ctrlKey) } : undefined,
  }
  const contentProps = editable ? {
    contentEditable: editMode,
    suppressContentEditableWarning: true,
    onBlur: editMode ? (event: React.FocusEvent<HTMLElement>) => onTextChange?.(node.id, event.currentTarget.textContent ?? '') : undefined,
  } : {}
  const children = node.children.map((child) => <RenderNode key={child.id} node={child} selectedId={selectedId} selectedIds={selectedIds} editMode={editMode} onSelect={onSelect} onTextChange={onTextChange} pageSlugs={pageSlugs} />)
  if (node.type === 'image') return <img {...common} src={mediaSrc || undefined} alt={node.props.alt ?? ''} loading="lazy" />
  if (node.type === 'video') return <video {...common} src={mediaSrc || undefined} controls preload="metadata" />
  if (node.type === 'divider') return <hr {...common} />
  if (node.type === 'spacer') return <div {...common} aria-hidden="true" style={{ ...safeStyle(node), minHeight: node.style.height ?? '2rem' }} />
  if (node.type === 'button' || node.type === 'link') {
    return <a {...common} href={href} onClick={editMode ? (event: React.MouseEvent) => event.preventDefault() : undefined} aria-invalid={!validPageLink || undefined} {...contentProps}>{text}{children}</a>
  }
  if (node.type === 'icon') return <span {...common} role="img" aria-label={node.props.label ?? 'decorative icon'}>{node.props.text ?? '✦'}</span>
  if (node.type === 'contact-form' || node.type === 'newsletter') {
    return <section {...common}><h2>{text}</h2><form onSubmit={(event) => event.preventDefault()}><label>{node.props.label ?? 'Email address'} <input type="email" placeholder={node.props.placeholder ?? 'you@example.com'} required /></label><button type="submit">{node.type === 'newsletter' ? 'Subscribe' : 'Send message'}</button></form>{children}</section>
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

export function SiteRenderer({ nodes, settings, ...props }: NodeEditProps & { nodes: BuilderNode[]; settings?: ProjectSettings }) {
  const breakpointDefaults = { mobile: 600, tablet: 900 }
  const breakpoints = settings?.breakpoints ?? breakpointDefaults
  const responsiveCss = responsiveStyleCss(nodes, breakpoints)
  const logoPath = settings?.logoPath && /^\/media\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif)$/i.test(settings.logoPath) ? settings.logoPath : ''
  const logoDisplayPath = useAuthenticatedMediaUrl(logoPath)
  const themeCss = settings ? `:root{--wc-primary:${settings.primaryColor};font-family:${settings.fontFamily},system-ui,sans-serif}` : ''
  return <>
    {logoPath && <header className="wc-site-brand"><img src={logoDisplayPath || undefined} alt={`${settings?.title || 'Website'} logo`} /></header>}
    {themeCss && <style data-webcraft-theme>{themeCss}</style>}
    {responsiveCss && <style data-webcraft-responsive>{responsiveCss}</style>}
    {settings?.customCss && <style data-webcraft-custom>{settings.customCss}</style>}
    {nodes.map((node) => <RenderNode key={node.id} node={node} {...props} />)}
  </>
}

function labelFor(type: ComponentType): string {
  const labels: Partial<Record<ComponentType, string>> = {
    section: 'Section', container: 'Container', heading: 'Your headline', paragraph: 'Add a paragraph describing your website.', text: 'Text', button: 'Get started', link: 'Learn more',
    image: 'Image', video: 'Video', icon: 'Icon', divider: '', spacer: '', grid: 'Grid', flex: 'Flex row', columns: 'Columns', card: 'Card title', navbar: 'Navigation', footer: 'Footer',
    hero: 'Make your next idea real.', features: 'Features', testimonials: 'What people say', pricing: 'Simple, transparent pricing', faq: 'Frequently asked questions', team: 'Meet the team', statistics: 'Our impact', gallery: 'Gallery', 'contact-form': 'Get in touch', newsletter: 'Stay in the loop', cta: 'Ready to get started?',
  }
  return labels[type] ?? 'Content'
}
