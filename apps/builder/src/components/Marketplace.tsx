import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download, FileJson, Heart, LoaderCircle, Package, Pencil, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { COMPONENT_MARKETPLACE_CATEGORIES, type MarketplacePackage } from '@webcraft/core/marketplace'
import { TEMPLATE_CATEGORIES } from '@webcraft/core/templates'
import { SiteRenderer } from '@webcraft/core/renderer'
import { ProjectSettingsSchema, type BuilderNode, type ProjectSettings } from '@webcraft/core/schema'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, apiAllDocs, jsonBody, queryString } from '../api'
import { useAuthStore } from '../store/auth'
import { Button, IconButton, Input, Status } from './ui'

type PackageRecord = { id: string; packageId: string; name: string; description?: string; type: 'component' | 'template'; category: string; version?: string; published?: boolean; owner?: string | { id?: string }; favorite?: boolean; createdAt?: string; updatedAt?: string }
type Project = { id: string; name: string; category: string; settings: ProjectSettings }
type Page = { id: string; title: string; slug: string; isHome: boolean; nodes: BuilderNode[] }
type PackageDetail = { package: MarketplacePackage; packageData?: MarketplacePackage }

function unwrapPackage(value: unknown): MarketplacePackage | null {
  const candidate = value && typeof value === 'object' && 'package' in value ? (value as { package?: unknown }).package : value
  if (!candidate || typeof candidate !== 'object') return null
  return candidate as MarketplacePackage
}
function packageTitle(record: PackageRecord) { return record.name || record.packageId }
function slug(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'package' }

export function Marketplace() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const [records, setRecords] = useState<PackageRecord[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('search') ?? '')
  const [type, setType] = useState('')
  const [category, setCategory] = useState('')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [selected, setSelected] = useState<PackageRecord | null>(null)
  const [detail, setDetail] = useState<MarketplacePackage | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [modal, setModal] = useState<'publish' | 'create' | 'install' | null>(null)
  const [busy, setBusy] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [installProjectId, setInstallProjectId] = useState('')
  const [installTarget, setInstallTarget] = useState<PackageRecord | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [projectId, setProjectId] = useState('')
  const [publishType, setPublishType] = useState<'component' | 'template'>('template')
  const [form, setForm] = useState({ name: '', description: '', category: '', published: true })
  const [selectedNodes, setSelectedNodes] = useState<{ pageId: string; nodeId: string; name: string; description: string }[]>([])

  const categories: string[] = type === 'component' ? [...COMPONENT_MARKETPLACE_CATEGORIES] : type === 'template' ? [...TEMPLATE_CATEGORIES] : [...new Set([...COMPONENT_MARKETPLACE_CATEGORIES, ...TEMPLATE_CATEGORIES])]
  const ownerId = String(user?.id ?? '')
  const owns = (record: PackageRecord) => Boolean(record.owner) && (typeof record.owner === 'string' ? record.owner === ownerId : String(record.owner?.id) === ownerId)

  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('search')
    if (requested !== null && requested !== q) setQ(requested)
  }, [location.search, q])

  async function refresh() {
    setLoading(true); setError('')
    try {
      const result = await api<{ docs?: PackageRecord[]; packages?: PackageRecord[]; totalPages?: number }>(`/webcraft/marketplace/packages?${queryString({ q: q || undefined, type: type || undefined, category: category || undefined, page, favoriteOnly: favoriteOnly ? 'true' : undefined })}`)
      setRecords(result.docs ?? result.packages ?? [])
      setTotalPages(result.totalPages ?? 0)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load marketplace packages.') }
    finally { setLoading(false) }
  }
  useEffect(() => { setPage(1) }, [q, type, category, favoriteOnly])
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 180); return () => window.clearTimeout(timer) }, [q, type, category, favoriteOnly, page])
  async function openDetail(record: PackageRecord) {
    setSelected(record); setDetail(null); setDetailLoading(true)
    try { const result = await api<PackageDetail>(`/webcraft/marketplace/packages/${encodeURIComponent(record.id)}`); setDetail(unwrapPackage(result.packageData ?? result.package)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load package details.') }
    finally { setDetailLoading(false) }
  }
  async function toggleFavorite(record: PackageRecord) {
    try { await api(`/webcraft/marketplace/favorites/${encodeURIComponent(record.id)}`, { method: record.favorite ? 'DELETE' : 'PUT' }); setRecords((current) => current.map((item) => item.id === record.id ? { ...item, favorite: !item.favorite } : item)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update favorite.') }
  }
  async function install(record: PackageRecord) {
    setBusy(true); setError('')
    try {
      const result = await api<any>(`/webcraft/marketplace/packages/${encodeURIComponent(record.id)}/install`, { method: 'POST', body: jsonBody({}) })
      const newId = result?.project?.id ?? result?.projectId ?? result?.id
      if (!newId) throw new Error('The template was installed, but the new project id was not returned.')
      navigate(`/editor/${newId}`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not install template.') }
    finally { setBusy(false) }
  }
  async function chooseComponentInstall(record: PackageRecord) {
    setError(''); setSelected(null); setDetail(null); setInstallTarget(record); setInstallProjectId(''); setModal('install')
    try {
      const loaded = await apiAllDocs<Project>('/projects?limit=100&depth=0&sort=name')
      setProjects(loaded); setInstallProjectId(loaded[0]?.id ?? '')
      if (!loaded.length) setError('Create a project before installing a component package.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load projects.') }
  }
  async function installComponent() {
    if (!installTarget || !installProjectId) { setError('Choose a project for this component package.'); return }
    setBusy(true); setError('')
    try {
      await api(`/webcraft/projects/${encodeURIComponent(installProjectId)}/installed-components`, { method: 'POST', body: jsonBody({ packageId: installTarget.id }) })
      setModal(null); setNotice(`Installed “${installTarget.name}” into the selected project. Open its editor’s Installed tab to preview or add components.`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not install this component package.') }
    finally { setBusy(false) }
  }
  function downloadPackage() {
    if (!detail) return
    const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' })
    const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = `${slug(detail.name)}.webcraft.json`; anchor.click(); URL.revokeObjectURL(anchor.href)
  }
  async function importPackage(file: File) {
    setBusy(true); setError('')
    try {
      const parsed = JSON.parse(await file.text())
      const result = await api<any>('/webcraft/marketplace/packages', { method: 'POST', body: jsonBody({ package: parsed, published: false }) })
      setNotice(`Imported “${result?.package?.name ?? parsed.name}” into the local catalog.`); await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'The .webcraft JSON file could not be imported.') }
    finally { setBusy(false) }
  }
  async function loadCreateData() {
    try { const loaded = await apiAllDocs<Project>('/projects?limit=100&depth=0&sort=name'); setProjects(loaded); if (loaded[0]) { const id = String(loaded[0].id); setProjectId(id); await loadPages(id) } }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load projects.') }
  }
  async function loadPages(id: string) {
    setProjectId(id); setSelectedNodes([])
    try { setPages(await apiAllDocs<Page>(`/pages?where[project][equals]=${encodeURIComponent(id)}&limit=100&depth=0&sort=slug`)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load project pages.') }
  }
  async function createFromProject(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await api<any>('/webcraft/marketplace/packages/from-project', { method: 'POST', body: jsonBody({ projectId, type: publishType, name: form.name.trim(), description: form.description.trim(), category: form.category, ...(publishType === 'component' ? { selected: selectedNodes } : {}), published: form.published }) })
      setModal(null); setNotice(`${publishType === 'template' ? 'Template' : 'Component package'} saved to the local WebCraft catalog.`); await refresh(); if (result?.package?.id) await openDetail(result.package)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create package from project.') }
    finally { setBusy(false) }
  }
  async function updatePublished(record: PackageRecord, published: boolean) {
    setBusy(true)
    try { await api(`/webcraft/marketplace/packages/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: jsonBody({ published }) }); setRecords((current) => current.map((item) => item.id === record.id ? { ...item, published } : item)); setNotice(published ? 'Package is now shared to the local catalog.' : 'Package is now private.') }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update package visibility.') }
    finally { setBusy(false) }
  }
  async function remove(record: PackageRecord) {
    if (!window.confirm(`Delete “${packageTitle(record)}” from the local catalog?`)) return
    try { await api(`/webcraft/marketplace/packages/${encodeURIComponent(record.id)}`, { method: 'DELETE' }); setRecords((current) => current.filter((item) => item.id !== record.id)); if (selected?.id === record.id) setSelected(null) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete package.') }
  }
  const previewNodes = useMemo(() => detail?.type === 'template' ? detail.pages[0]?.nodes ?? [] : detail?.components[0]?.nodes ?? [], [detail])

  return <div className="app-shell marketplace-shell"><aside className="side-nav"><div className="brand-lockup"><span className="brand-mark"><Package size={20}/></span><b>webcraft</b><span className="local-badge">LOCAL</span></div><div className="workspace-switch"><span className="avatar">{(user?.name ?? user?.email ?? 'W').slice(0, 1).toUpperCase()}</span><span className="workspace-meta"><b>{user?.name || 'Your workspace'}</b><small>Personal workspace</small></span></div><div className="nav-section-label">WORKSPACE</div><button className="nav-link" onClick={() => navigate('/')}><ArrowLeft size={17}/>Overview</button><button className="nav-link active"><Package size={17}/>Marketplace</button><div className="side-nav-bottom"><div className="storage-card"><div className="storage-icon"><Sparkles size={16}/></div><b>Local catalog</b><p>Packages stay in your WebCraft workspace.</p><small>SHARED ON THIS MACHINE</small></div></div></aside>
    <main className="dashboard-main"><header className="top-header"><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Marketplace</strong></div><div className="header-actions"><Status tone="success">Local catalog</Status></div></header><div className="dashboard-content"><div className="welcome-row"><div><span className="eyebrow">BUILDING BLOCKS</span><h1>Marketplace<span className="wave-dot">.</span></h1><p>Share and reuse templates and components in your local WebCraft catalog.</p></div><div className="marketplace-actions"><Button onClick={() => { setModal('create'); setPublishType('template'); setForm({ name: '', description: '', category: String(TEMPLATE_CATEGORIES[0]), published: true }); void loadCreateData() }}><Plus size={16}/>Create from project</Button><label className="btn btn-primary btn-md import-button"><Upload size={16}/>Import JSON<input type="file" accept="application/json,.json,.webcraft" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importPackage(file); e.currentTarget.value = '' }}/></label></div></div>
      <div className="marketplace-toolbar"><label className="search-box marketplace-search"><Search size={16}/><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search packages" aria-label="Search packages"/></label><select className="input select-input" value={type} onChange={(e) => { setType(e.target.value); setCategory('') }}><option value="">All types</option><option value="template">Templates</option><option value="component">Components</option></select><select className="input select-input" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select><Button variant={favoriteOnly ? 'primary' : 'secondary'} onClick={() => setFavoriteOnly((value) => !value)}><Heart size={15} fill={favoriteOnly ? 'currentColor' : 'none'}/>Favorites</Button></div>
      {error && <div className="inline-error dismissible" role="alert">{error}<button onClick={() => setError('')}><X size={14}/></button></div>}{notice && <div className="inline-success">{notice}<button onClick={() => setNotice('')}><X size={14}/></button></div>}
      {loading ? <div className="loading-grid marketplace-grid">{[1, 2, 3].map((item) => <div className="skeleton-card" key={item}/>)}</div> : records.length ? <div className="marketplace-grid">{records.map((record) => <article className="market-card" key={record.id}><div className="market-card-art"><Package size={28}/><button className={`favorite-button ${record.favorite ? 'liked' : ''}`} aria-label={`${record.favorite ? 'Remove from' : 'Add to'} favorites`} onClick={() => void toggleFavorite(record)}><Heart size={17} fill={record.favorite ? 'currentColor' : 'none'}/></button></div><div className="market-card-body"><div className="market-card-title"><div><Status tone="neutral">{record.type}</Status><h3>{packageTitle(record)}</h3></div><span>{record.version ? `v${record.version}` : ''}</span></div><p>{record.description || 'No description provided.'}</p><div className="market-card-meta"><span>{record.category}</span><span>{record.published ? 'Shared locally' : 'Private'}</span></div><div className="market-card-actions"><Button size="sm" onClick={() => void openDetail(record)}>Preview</Button>{record.type === 'template' && <Button size="sm" variant="primary" busy={busy} onClick={() => void install(record)}>Install</Button>}{record.type === 'component' && <Button size="sm" variant="primary" onClick={() => void chooseComponentInstall(record)}>Install</Button>}{owns(record) && <><Button size="sm" onClick={() => void updatePublished(record, !record.published)}>{record.published ? 'Make private' : 'Share locally'}</Button><IconButton label="Delete package" onClick={() => void remove(record)}><Trash2 size={15}/></IconButton></>}</div></div></article>)}</div> : <div className="empty-state"><div className="empty-illustration"><Package size={25}/></div><h3>No packages found</h3><p>Try another filter or create a package from one of your projects.</p></div>}
      {!loading && totalPages > 1 && <div className="marketplace-pagination" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '20px 0' }}><Button size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><span>Page {page} of {totalPages}</span><Button size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button></div>}
    </div></main>{selected && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null) }}><section className="modal-card marketplace-detail"><div className="modal-head"><span className="modal-icon"><Package size={18}/></span><button className="close-modal" onClick={() => setSelected(null)}><X size={16}/></button></div>{detailLoading ? <div className="detail-loading"><LoaderCircle className="spin"/>Loading package preview…</div> : detail ? <><div className="detail-heading"><div><span className="eyebrow">{detail.type} · {detail.category}</span><h2>{detail.name}</h2><p>{detail.description || 'No description provided.'}</p></div><Button size="sm" onClick={downloadPackage}><Download size={14}/>Export .webcraft</Button></div><div className="market-preview"><SiteRenderer nodes={previewNodes} settings={detail.type === 'template' ? detail.settings : undefined} pageSlugs={detail.type === 'template' ? detail.pages.map((page) => page.slug) : undefined}/></div>{detail.type === 'template' && <Button variant="primary" busy={busy} onClick={() => void install(selected)}><Sparkles size={15}/>Install template</Button>}{detail.type === 'component' && <Button variant="primary" onClick={() => void chooseComponentInstall(selected)}><Sparkles size={15}/>Install component package</Button>}</> : <div className="inline-error">Could not preview this package.</div>}</section></div>}
    {modal === 'install' && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null) }}><form className="modal-card" onSubmit={(e) => { e.preventDefault(); void installComponent() }}><div className="modal-head"><span className="modal-icon"><Package size={18}/></span><button type="button" className="close-modal" onClick={() => setModal(null)}><X size={16}/></button></div><span className="eyebrow">INSTALL COMPONENTS</span><h2>{installTarget?.name}</h2><p>This saves a validated copy in the selected project. Open its editor’s Installed tab to preview or insert components.</p><label className="field-label">Destination project<select required className="input select-input" value={installProjectId} onChange={(e) => setInstallProjectId(e.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>{error && <div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><Button type="button" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!installProjectId}><Package size={15}/>Install package</Button></div></form></div>}
    {modal === 'create' && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null) }}><form className="modal-card" onSubmit={createFromProject}><div className="modal-head"><span className="modal-icon"><Pencil size={18}/></span><button type="button" className="close-modal" onClick={() => setModal(null)}><X size={16}/></button></div><span className="eyebrow">CREATE PACKAGE</span><h2>Share project work locally</h2><p>Publishing shares this package to the local WebCraft catalog; it is not an internet-wide community.</p><label className="field-label">Package type<select className="input select-input" value={publishType} onChange={(e) => { const next = e.target.value as 'component'|'template'; setPublishType(next); setForm((current) => ({ ...current, category: next === 'template' ? String(TEMPLATE_CATEGORIES[0]) : String(COMPONENT_MARKETPLACE_CATEGORIES[0]) })) }}><option value="template">Full template</option><option value="component">Components from selected page trees</option></select></label><label className="field-label">Source project<select className="input select-input" value={projectId} onChange={(e) => void loadPages(e.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>{publishType === 'component' && <div className="component-picker"><b>Choose actual component trees</b>{pages.flatMap((page) => page.nodes.map((node) => ({ node, pageId: String(page.id), pageTitle: page.title }))).map(({ node, pageId, pageTitle }) => <label key={`${pageId}:${node.id}`}><input type="checkbox" checked={selectedNodes.some((item) => item.pageId === pageId && item.nodeId === node.id)} onChange={(e) => setSelectedNodes((current) => e.target.checked ? [...current, { pageId, nodeId: node.id, name: String(node.props?.text || node.type), description: '' }] : current.filter((item) => !(item.pageId === pageId && item.nodeId === node.id)))}/><span>{String(node.props?.text || node.type)} <small>from {pageTitle}</small></span></label>)}</div>}<label className="field-label">Name<Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120}/></label><label className="field-label">Description<textarea className="input textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={1000}/></label><label className="field-label">Category<select required className="input select-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{(publishType === 'template' ? TEMPLATE_CATEGORIES : COMPONENT_MARKETPLACE_CATEGORIES).map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="check-row"><input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })}/>Share to the local catalog now</label><div className="modal-actions"><Button type="button" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" variant="primary" busy={busy}><Upload size={15}/>Save package</Button></div></form></div>}
  </div>
}
