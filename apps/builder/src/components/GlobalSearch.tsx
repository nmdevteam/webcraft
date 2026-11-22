import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Boxes, FileText, Image, Layers3, LoaderCircle, Search, Settings2, X } from 'lucide-react'
import { api } from '../api'

type SearchItem = { type: string; label: string; description: string; target: string }
type SearchResponse = { results: SearchItem[]; bounded: boolean }
const icons: Record<string, typeof Search> = { project: Boxes, page: FileText, component: Layers3, section: Layers3, asset: Image, template: FileText, integration: Settings2, setting: Settings2 }

export function GlobalSearch() {
  const navigate = useNavigate()
  const location = useLocation()
  const currentProjectId = (() => {
    const match = /^\/editor\/([^/]+)\/?$/.exec(location.pathname)
    if (!match?.[1]) return ''
    try { return decodeURIComponent(match[1]) } catch { return '' }
  })()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchItem[]>([])
  const [bounded, setBounded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const priorFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen((value) => !value) }
      else if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  useEffect(() => {
    if (!open) return
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const prior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => { document.body.style.overflow = prior; priorFocusRef.current?.focus() }
  }, [open])
  useEffect(() => {
    if (!open || query.trim().length < 2) { setResults([]); setBounded(false); setError(''); setLoading(false); setActive(0); return }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true); setError('')
      const params = new URLSearchParams({ q: query.trim() })
      if (currentProjectId) params.set('projectId', currentProjectId)
      void api<SearchResponse>(`/webcraft/search?${params.toString()}`, { signal: controller.signal }).then((response) => {
        setResults(Array.isArray(response.results) ? response.results : []); setBounded(Boolean(response.bounded)); setActive(0)
      }).catch((reason) => { if (reason?.name !== 'AbortError') { setResults([]); setError(reason instanceof Error ? reason.message : 'Search failed.') } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 180)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [open, query, currentProjectId])
  function select(item: SearchItem) {
    if (!item.target.startsWith('/') || item.target.startsWith('//')) return
    setOpen(false); setQuery(''); navigate(item.target)
  }
  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); setActive((value) => (value + 1) % results.length) }
    else if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); setActive((value) => (value - 1 + results.length) % results.length) }
    else if (event.key === 'Enter' && results[active]) { event.preventDefault(); select(results[active]!) }
  }
  if (!open) return null
  return <div className="global-search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
    <section className="global-search-dialog" role="dialog" aria-modal="true" aria-labelledby="global-search-title" onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not([disabled]),button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
      <h2 id="global-search-title" className="sr-only">Search your WebCraft workspace</h2>
      <div className="global-search-input"><Search size={19}/><input ref={inputRef} role="combobox" aria-label="Search projects, pages, components, assets and settings" aria-autocomplete="list" aria-expanded={open} aria-controls="global-search-results" aria-activedescendant={results[active] ? `global-search-option-${active}` : undefined} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onInputKeyDown} placeholder="Search projects, pages, assets, templates…"/><kbd>Esc</kbd><button type="button" aria-label="Close search" onClick={() => setOpen(false)}><X size={17}/></button></div>
      <div id="global-search-results" className="global-search-results" role="listbox" aria-label="Search results">
        {loading && <div className="global-search-message"><LoaderCircle size={16} className="spin"/>Searching your workspace…</div>}
        {!loading && error && <div className="global-search-message global-search-error" role="alert">{error}</div>}
        {!loading && !error && query.trim().length < 2 && <div className="global-search-message">Type at least two characters to search your workspace.</div>}
        {!loading && !error && query.trim().length >= 2 && results.length === 0 && <div className="global-search-message">No matching projects, pages, assets, templates, or settings.</div>}
        {results.map((item, index) => { const Icon = icons[item.type] ?? FileText; return <button id={`global-search-option-${index}`} role="option" aria-selected={index === active} className={`global-search-option${index === active ? ' active' : ''}`} key={`${item.type}:${item.target}:${item.label}`} onMouseEnter={() => setActive(index)} onClick={() => select(item)}><span className="global-search-icon"><Icon size={16}/></span><span className="global-search-copy"><b>{item.label}</b><small>{item.description}</small></span><span className="global-search-type">{item.type}</span></button> })}
      </div>
      <footer className="global-search-footer"><span>{bounded ? 'Showing a bounded recent workspace sample.' : 'Search is scoped to your workspace.'}</span><span><kbd>↑</kbd><kbd>↓</kbd> to navigate <kbd>↵</kbd> to open</span></footer>
    </section>
  </div>
}
