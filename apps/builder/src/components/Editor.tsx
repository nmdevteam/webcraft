import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronDown, Code2, Copy, Monitor, FilePlus2, FolderOpen, GitBranch, ImagePlus, Layers3, LoaderCircle, MoreHorizontal, Move, Plus, Redo2, Save, Settings2, Smartphone, Tablet, Trash2, Undo2, X } from 'lucide-react'
import { COMPONENT_TYPES, type BuilderNode, type ComponentType, type NodeStyle } from '@webcraft/core/schema'
import { SiteRenderer } from '@webcraft/core/renderer'
import { api, apiDoc, jsonBody } from '../api'
import { useBuilderStore } from '../store/builder'
import { deleteDraft, getDraft, saveDraft } from '../lib/recovery'
import { downloadProjectZip } from '../lib/export'
import { Button, IconButton, Input, Status } from './ui'

type Project = { id: string; name: string; category: string; templateId: string; settings: any; updatedAt: string }
type Page = { id: string; title: string; slug: string; isHome: boolean; seoTitle?: string; seoDescription?: string; nodes: BuilderNode[]; revision: number; updatedAt: string }
type Asset = { id: string; filename: string; url?: string; alt?: string; filesize?: number; mimeType?: string }
type Tab = 'elements' | 'pages' | 'layers' | 'assets'
type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'failed'
const labels: Record<ComponentType, string> = { section:'Section',container:'Container',heading:'Heading',paragraph:'Paragraph',text:'Text',button:'Button',link:'Link',image:'Image',video:'Video',icon:'Icon',divider:'Divider',spacer:'Spacer',grid:'Grid',flex:'Flex row',columns:'Columns',card:'Card',navbar:'Navbar',footer:'Footer',hero:'Hero',features:'Features',testimonials:'Testimonials',pricing:'Pricing',faq:'FAQ',team:'Team',statistics:'Statistics',gallery:'Gallery','contact-form':'Contact form',newsletter:'Newsletter',cta:'Call to action' }
const defaultText: Partial<Record<ComponentType,string>> = { section:'Section',container:'Container',heading:'A clear, memorable headline',paragraph:'Add a sentence that brings your idea to life.',text:'Edit this text',button:'Get started',link:'Learn more',icon:'✦',grid:'Grid',flex:'Flex row',columns:'Columns',card:'Card title',navbar:'Navigation',footer:'Footer',hero:'Make your next idea real.',features:'Features',testimonials:'What people say',pricing:'Simple, transparent pricing',faq:'Frequently asked questions',team:'Meet the team',statistics:'Our impact',gallery:'Gallery','contact-form':'Get in touch',newsletter:'Stay in the loop',cta:'Ready to get started?' }
const tabItems: { id: Tab; label: string; icon: typeof Layers3 }[] = [{id:'elements',label:'Elements',icon:Plus},{id:'pages',label:'Pages',icon:FilePlus2},{id:'layers',label:'Layers',icon:Layers3},{id:'assets',label:'Assets',icon:ImagePlus}]
const viewportWidths = { desktop: 1200, tablet: 800, mobile: 390 } as const
function makeNode(type: ComponentType): BuilderNode { return { id: crypto.randomUUID().replace(/-/g,''), type, props: { text: defaultText[type] ?? labels[type] }, style: type==='button' ? { backgroundColor:'#5658db', color:'#ffffff', padding:'0.75rem 1rem', borderRadius:'0.65rem' } : {}, children: [] } }
function cloneWithNewIds(node: BuilderNode): BuilderNode { return { ...structuredClone(node), id: crypto.randomUUID().replace(/-/g,''), children: node.children.map(cloneWithNewIds) } }
function findNode(nodes: BuilderNode[], id: string | null): BuilderNode | null { if (!id) return null; for (const node of nodes) { if (node.id === id) return node; const child = findNode(node.children,id); if (child) return child } return null }
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'page' }

export function Editor() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const [query, setQuery] = useSearchParams()
  const [project, setProject] = useState<Project | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [activePage, setActivePage] = useState<Page | null>(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('elements')
  const [viewport, setViewport] = useState<keyof typeof viewportWidths>('desktop')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [savedAt, setSavedAt] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [assetSearch, setAssetSearch] = useState('')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<any>({})
  const [pushOpen, setPushOpen] = useState(false)
  const [repositories, setRepositories] = useState<{fullName:string;url:string;private:boolean}[]>([])
  const [selectedRepo, setSelectedRepo] = useState('')
  const [pushBusy, setPushBusy] = useState(false)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const clipboardRef = useRef<BuilderNode | null>(null)
  const initializedPageRef = useRef<string | null>(null)
  const nodes = useBuilderStore((s) => s.nodes)
  const selectedId = useBuilderStore((s) => s.selectedId)
  const pastLength = useBuilderStore((s) => s.past.length)
  const futureLength = useBuilderStore((s) => s.future.length)
  const store = useBuilderStore
  const selectedNode = useMemo(() => findNode(nodes, selectedId), [nodes, selectedId])

  async function loadProject() {
    setReady(false); setError('')
    try {
      const [p, pageResult] = await Promise.all([
        api<Project>(`/projects/${encodeURIComponent(projectId)}?depth=0`),
        api<{docs:Page[]}>(`/pages?where[project][equals]=${encodeURIComponent(projectId)}&limit=100&depth=0&sort=slug`),
      ])
      setProject(p); setSettings(p.settings ?? {}); setPages(pageResult.docs)
      if (!pageResult.docs.length) throw new Error('This project has no pages. Create one from the Pages panel.')
      const requested = query.get('page')
      const page = pageResult.docs.find((candidate) => candidate.id === requested) ?? pageResult.docs.find((candidate) => candidate.isHome) ?? pageResult.docs[0]!
      setActivePage(page); setQuery({ page: page.id }, { replace: true })
      let initial = page.nodes
      try {
        const draft = await getDraft(page.id)
        if (draft && draft.savedAt > new Date(page.updatedAt).getTime() && window.confirm(`A local recovery draft for “${page.title}” is newer than the saved page. Restore it?`)) {
          initial = draft.nodes; setSaveStatus('unsaved'); setNotice('Recovered local draft. It will autosave shortly.')
        }
      } catch { /* IndexedDB may be unavailable; server persistence still works. */ }
      store.getState().setNodes(initial)
      initializedPageRef.current = page.id
      setReady(true)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not open this project.') }
  }
  useEffect(() => { void loadProject() }, [projectId])

  const savePage = useCallback(async (manual: boolean) => {
    if (!activePage || !ready) return
    if (savingRef.current) { pendingRef.current = true; return }
    savingRef.current = true; pendingRef.current = false
    const snapshot = structuredClone(store.getState().nodes)
    setSaveStatus('saving'); setError('')
    try { await saveDraft({ pageId: activePage.id, nodes: snapshot, revision: activePage.revision, savedAt: Date.now() }) } catch { /* recovery is best-effort */ }
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await api<any>(`/pages/${encodeURIComponent(activePage.id)}`, { method: 'PATCH', body: jsonBody({ nodes: snapshot, revision: activePage.revision }) })
        const saved = response?.doc ?? response
        const updated: Page = { ...activePage, nodes: snapshot, revision: Number(saved.revision ?? activePage.revision + 1), updatedAt: saved.updatedAt ?? new Date().toISOString() }
        setActivePage(updated); setPages((current) => current.map((page) => page.id === updated.id ? updated : page)); setSaveStatus('saved'); setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); setError('')
        try { await deleteDraft(activePage.id) } catch { /* harmless if a recovery record remains */ }
        lastError = null; break
      } catch (err) {
        lastError = err
        if ((err as any)?.status === 400 && /revision conflict/i.test(String((err as Error).message))) break
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (2 ** attempt)))
      }
    }
    if (lastError) { setSaveStatus('failed'); setError(lastError instanceof Error ? lastError.message : 'Save failed. Your draft remains on this device.') }
    savingRef.current = false
    if (pendingRef.current) { pendingRef.current = false; void savePage(false) }
    if (manual && !lastError) setNotice('All changes saved.')
  }, [activePage, ready, store])

  useEffect(() => {
    if (!ready || !activePage || activePage.id !== initializedPageRef.current) return
    setSaveStatus((old) => old === 'failed' ? old : 'unsaved')
    const timer = window.setTimeout(() => void savePage(false), 1200)
    return () => window.clearTimeout(timer)
  }, [nodes, ready, activePage?.id, savePage])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const editingText = target.isContentEditable || Boolean(target.closest('input,textarea,select'))
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void savePage(true) }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && !editingText && selectedNode) { event.preventDefault(); clipboardRef.current = structuredClone(selectedNode); setNotice('Component copied. Press Ctrl/Cmd+V to paste it.') }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && !editingText && clipboardRef.current) { event.preventDefault(); store.getState().add(cloneWithNewIds(clipboardRef.current)); setNotice('Component pasted.') }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? store.getState().redo() : store.getState().undo() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); store.getState().redo() }
    }
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener)
  }, [savePage, selectedNode, store])

  async function switchPage(page: Page) {
    if (page.id === activePage?.id) return
    if (saveStatus === 'unsaved' || saveStatus === 'failed') await savePage(true)
    setReady(false); setActivePage(page); setQuery({ page: page.id }, { replace: true }); store.getState().setNodes(page.nodes); initializedPageRef.current = page.id; setReady(true); setSaveStatus('saved')
  }
  async function newPage() {
    const title = window.prompt('New page name', 'New page')?.trim(); if (!title) return
    const base = slugify(title); let slug = base; let suffix = 2
    while (pages.some((page) => page.slug === slug)) slug = `${base}-${suffix++}`
    try {
      const page = await apiDoc<Page>('/pages', { method: 'POST', body: jsonBody({ title, slug, isHome: false, nodes: [], revision: 0, project: projectId }) })
      setPages((current) => [...current, page]); await switchPage(page)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create page.') }
  }
  async function renamePage(page: Page) {
    const title = window.prompt('Page name', page.title)?.trim(); if (!title || title === page.title) return
    const base = slugify(title); let slug = base; let suffix = 2
    while (pages.some((other) => other.id !== page.id && other.slug === slug)) slug = `${base}-${suffix++}`
    try { const saved = await api<any>(`/pages/${page.id}`, { method: 'PATCH', body: jsonBody({ title, slug }) }); const updated = { ...page, ...(saved.doc ?? saved), title, slug }; setPages((current) => current.map((p) => p.id === page.id ? updated : p)); if (activePage?.id === page.id) setActivePage(updated) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not rename page.') }
  }
  async function duplicatePage(page: Page) {
    const slug = `${page.slug}-copy`.slice(0,80)
    try { const copy = await apiDoc<Page>('/pages', { method: 'POST', body: jsonBody({ title: `${page.title} copy`, slug, isHome: false, nodes: page.nodes, revision: 0, project: projectId }) }); setPages((current) => [...current, copy]); await switchPage(copy) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not duplicate page.') }
  }
  async function deletePage(page: Page) {
    if (pages.length <= 1) { setError('A website must keep at least one page.'); return }
    if (!window.confirm(`Delete the “${page.title}” page?`)) return
    try { await api(`/pages/${page.id}`, { method: 'DELETE' }); const nextPages = pages.filter((p) => p.id !== page.id); setPages(nextPages); if (activePage?.id === page.id) await switchPage(nextPages[0]!) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete page.') }
  }
  async function setHome(page: Page) {
    try { for (const item of pages) if (item.isHome && item.id !== page.id) await api(`/pages/${item.id}`, { method: 'PATCH', body: jsonBody({ isHome: false }) }); const saved = await api<any>(`/pages/${page.id}`, { method: 'PATCH', body: jsonBody({ isHome: true }) }); setPages((current) => current.map((p) => ({ ...p, isHome: p.id === page.id }))); if (activePage?.id === page.id) setActivePage({ ...page, ...(saved.doc ?? saved), isHome: true }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not set homepage.') }
  }
  async function updatePageSeo(field: 'seoTitle'|'seoDescription', value: string) {
    if (!activePage) return
    try { await api(`/pages/${activePage.id}`, { method: 'PATCH', body: jsonBody({ [field]: value }) }); const next = { ...activePage, [field]: value }; setActivePage(next); setPages((current) => current.map((p) => p.id === next.id ? next : p)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update page SEO.') }
  }

  function addNode(type: ComponentType) { store.getState().add(makeNode(type)); setTab('layers') }
  function onDrop(event: React.DragEvent) {
    event.preventDefault(); const value = event.dataTransfer.getData('text/webcraft')
    if (value.startsWith('component:')) addNode(value.slice(10) as ComponentType)
    else if (value.startsWith('node:')) { const id = value.slice(5); const from = nodes.findIndex((n) => n.id === id); const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); const relative = event.clientY - rect.top; const to = Math.max(0, Math.min(nodes.length - 1, Math.floor(relative / Math.max(60, rect.height / Math.max(nodes.length,1))))); store.getState().reorder(from,to) }
  }
  function dragNode(event: React.DragEvent, id: string) { event.dataTransfer.setData('text/webcraft', `node:${id}`); event.dataTransfer.effectAllowed = 'move' }
  function dragComponent(event: React.DragEvent, type: ComponentType) { event.dataTransfer.setData('text/webcraft', `component:${type}`); event.dataTransfer.effectAllowed = 'copy' }

  async function loadAssets() {
    try { const result = await api<{docs:Asset[]}>(`/assets?where[project][equals]=${encodeURIComponent(projectId)}&limit=100&depth=0&sort=-createdAt`); setAssets(result.docs) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load assets.') }
  }
  useEffect(() => { if (tab === 'assets') void loadAssets() }, [tab, projectId])
  async function uploadAsset(file?: File) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError('Images must be 5 MB or smaller.'); return }
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) { setError('Upload a PNG, JPEG, WebP, or GIF image. SVG is disabled for safety.'); return }
    setUploadBusy(true); setError('')
    try { const form = new FormData(); form.append('file', file); form.append('data', JSON.stringify({ project: projectId, alt: file.name.slice(0,300) })); const created = await apiDoc<Asset>('/assets', { method: 'POST', body: form }); setAssets((current) => [created, ...current]); setNotice(`Uploaded ${file.name}.`) }
    catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.') }
    finally { setUploadBusy(false) }
  }
  async function deleteAsset(asset: Asset) {
    if (!window.confirm(`Delete “${asset.alt || asset.filename}”?`)) return
    try { await api(`/assets/${asset.id}`, { method: 'DELETE' }); setAssets((current) => current.filter((item) => item.id !== asset.id)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete asset.') }
  }
  function insertAsset(asset: Asset) { const src = `/media/${encodeURIComponent(asset.filename)}`; store.getState().add({ ...makeNode('image'), props: { src, alt: asset.alt ?? '' } }); setTab('layers') }
  async function saveProjectSettings(event: React.FormEvent) {
    event.preventDefault(); setError('')
    try { const response = await api<any>(`/projects/${projectId}`, { method: 'PATCH', body: jsonBody({ name: settings.title || project?.name, settings }) }); setProject((p) => p ? { ...p, ...(response.doc ?? response), name: settings.title || p.name, settings } : p); setProjectSettingsOpen(false); setNotice('Website settings saved.') }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save settings.') }
  }
  async function openPush() {
    setError(''); setNotice('')
    try { const account = await api<{connected:boolean}>('/webcraft/github/account'); if (!account.connected) { navigate('/settings'); setError('Connect GitHub before pushing a website.'); return }; const result = await api<{repositories:{fullName:string;url:string;private:boolean}[]}>('/webcraft/github/repositories'); setRepositories(result.repositories); setSelectedRepo(result.repositories[0]?.fullName ?? ''); setPushOpen(true) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load GitHub repositories.') }
  }
  async function pushToGitHub() {
    if (!selectedRepo) return
    setPushBusy(true); setError('')
    try { const result = await api<{success:boolean;commit:string;url:string;branch:string}>('/webcraft/github/push', { method: 'POST', body: jsonBody({ projectId, repository: selectedRepo }) }); setPushOpen(false); setNotice(`Pushed to ${selectedRepo} · commit ${result.commit.slice(0,7)}.`) }
    catch (err) { setError(err instanceof Error ? err.message : 'GitHub push failed.') }
    finally { setPushBusy(false) }
  }
  async function exportSource() {
    if (!project) return
    setError(''); setNotice(''); setPushBusy(true)
    try { await downloadProjectZip(project); setNotice('Export built successfully and source ZIP downloaded.') }
    catch (err) { setError(err instanceof Error ? err.message : 'Export failed.') }
    finally { setPushBusy(false) }
  }
  async function updateStyle(field: keyof NodeStyle, value: string) {
    if (!selectedNode) return
    store.getState().updateStyle(selectedNode.id, { [field]: value } as Partial<NodeStyle>)
  }

  if (!project || !activePage) return <div className="editor-load"><LoaderCircle size={22} className="spin"/><span>{error || 'Opening editor…'}</span>{error && <Button onClick={() => navigate('/')}>Back to dashboard</Button>}</div>
  const saveLabel = saveStatus === 'saved' ? `Saved${savedAt ? ` · ${savedAt}` : ''}` : saveStatus === 'saving' ? 'Saving…' : saveStatus === 'failed' ? 'Save failed' : 'Unsaved changes'
  const assetList = assets.filter((asset) => `${asset.filename} ${asset.alt ?? ''}`.toLowerCase().includes(assetSearch.toLowerCase()))

  return <div className="editor-shell">
    <header className="editor-toolbar"><div className="editor-brand"><IconButton label="Back to dashboard" onClick={() => navigate('/')}><ArrowLeft size={18}/></IconButton><span className="toolbar-divider"/><button className="editor-project-title" onClick={() => setProjectSettingsOpen(true)}>{project.name}<ChevronDown size={14}/></button><span className="editor-page-title">/ {activePage.title}</span></div><div className="editor-actions"><span className={`save-indicator save-${saveStatus}`}><i/>{saveLabel}</span><span className="toolbar-divider"/><IconButton label="Undo" disabled={!pastLength} onClick={() => store.getState().undo()}><Undo2 size={17}/></IconButton><IconButton label="Redo" disabled={!futureLength} onClick={() => store.getState().redo()}><Redo2 size={17}/></IconButton><span className="toolbar-divider"/><div className="viewport-picker">{(['desktop','tablet','mobile'] as const).map((item) => <button key={item} className={viewport===item?'selected':''} onClick={() => setViewport(item)} aria-label={`${item} preview`} title={`${item} preview`}>{item==='desktop'?<Monitor size={16}/>:item==='tablet'?<Tablet size={16}/>:<Smartphone size={16}/>}</button>)}</div><Button size="sm" variant="ghost" onClick={() => navigate(`/preview/${projectId}?page=${activePage.id}`)}><Code2 size={15}/>Preview</Button><Button size="sm" variant="secondary" busy={pushBusy} onClick={() => void exportSource()}><ArrowDownToLine size={15}/>Export</Button><Button size="sm" variant="primary" busy={saveStatus==='saving'} onClick={() => void savePage(true)}><Save size={15}/>Save</Button><Button size="sm" variant="secondary" onClick={() => void openPush()}><GitBranch size={15}/>Push</Button></div></header>
    <div className="editor-workspace"><aside className="editor-left"><div className="editor-tabs">{tabItems.map(({id,label,icon:Icon})=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)} title={label}><Icon size={17}/><span>{label}</span></button>)}</div>
      <div className="editor-left-content">{tab==='elements' && <><div className="panel-intro"><b>Elements</b><small>Drag a component or click to add it.</small></div><div className="element-grid">{COMPONENT_TYPES.map((type) => <button key={type} className="element-tile" draggable onDragStart={(e)=>dragComponent(e,type)} onClick={()=>addNode(type)}><span className="element-symbol">{type==='heading'?'T':type==='paragraph'?'¶':type==='button'?'▰':type==='image'?'▧':type==='section'?'▤':type==='grid'?'▦':type==='link'?'↗':type==='video'?'▶':type==='divider'?'—':type==='spacer'?'↕':type==='icon'?'✦':type==='navbar'?'☰':type==='footer'?'▱':'◇'}</span><span>{labels[type]}</span><Plus size={13}/></button>)}</div><div className="panel-tip"><Move size={14}/>Drop onto the canvas to add. Reorder with drag and drop.</div></>}
      {tab==='pages' && <><div className="panel-intro split"><div><b>Pages</b><small>{pages.length} {pages.length===1?'page':'pages'}</small></div><IconButton label="Add page" onClick={()=>void newPage()}><Plus size={17}/></IconButton></div><div className="page-list">{pages.map((page)=><div className={`page-list-item ${page.id===activePage.id?'active':''}`} key={page.id}><button className="page-select" onClick={()=>void switchPage(page)}><span className="page-icon">{page.isHome?'⌂':'▤'}</span><span><b>{page.title}</b><small>/{page.slug}</small></span></button><button className="page-menu-trigger" aria-label={`Page actions for ${page.title}`} onClick={(e)=>{const menu=e.currentTarget.nextElementSibling as HTMLElement;menu.hidden=!menu.hidden}}><MoreHorizontal size={15}/></button><div className="page-menu" hidden><button onClick={()=>void renamePage(page)}>Rename</button><button onClick={()=>void duplicatePage(page)}>Duplicate</button><button onClick={()=>void setHome(page)}>{page.isHome?'Homepage':'Set as homepage'}</button><button className="menu-danger" onClick={()=>void deletePage(page)}>Delete</button></div></div>)}</div><Button className="wide" size="sm" onClick={()=>void newPage()}><Plus size={15}/>Add page</Button></>}
      {tab==='layers' && <><div className="panel-intro split"><div><b>Layers</b><small>{nodes.length} top-level components</small></div><IconButton label="Add component" onClick={()=>setTab('elements')}><Plus size={17}/></IconButton></div>{nodes.length ? <div className="layer-list">{nodes.map((node,index)=><div key={node.id} className={`layer-row ${selectedId===node.id?'active':''}`} draggable onDragStart={(e)=>dragNode(e,node.id)} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();const from=nodes.findIndex(n=>n.id===e.dataTransfer.getData('text/webcraft').slice(5));store.getState().reorder(from,index)}}><Move size={13}/><button onClick={()=>store.getState().select(node.id)}><b>{labels[node.type]}</b><small>{node.props.text || node.id.slice(0,8)}</small></button><IconButton label={`Duplicate ${labels[node.type]}`} onClick={()=>store.getState().duplicate(node.id)}><Copy size={13}/></IconButton><IconButton label={`Delete ${labels[node.type]}`} onClick={()=>store.getState().remove(node.id)}><Trash2 size={13}/></IconButton></div>)}</div> : <div className="sidebar-empty">Your page is empty.<br/>Add elements to start creating.</div>}</>}
      {tab==='assets' && <><div className="panel-intro"><b>Assets</b><small>Project images are kept locally. PNG, JPEG, WebP, GIF · max 5 MB.</small></div><label className="upload-zone"><ImagePlus size={21}/><b>{uploadBusy?'Uploading…':'Upload image'}</b><small>Choose a file from this device</small><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploadBusy} onChange={(e)=>{void uploadAsset(e.target.files?.[0]);e.currentTarget.value=''}}/></label><label className="asset-search"><Input value={assetSearch} onChange={(e)=>setAssetSearch(e.target.value)} placeholder="Search assets"/></label>{assetList.length ? <div className="asset-list">{assetList.map((asset)=><div className="asset-card" key={asset.id}><button className="asset-preview" onClick={()=>insertAsset(asset)} title="Add image to page"><img src={`/media/${encodeURIComponent(asset.filename)}`} alt={asset.alt??''}/><span><Plus size={15}/></span></button><div className="asset-label"><b>{asset.alt || asset.filename}</b><small>{asset.filename}</small></div><IconButton label="Delete asset" onClick={()=>void deleteAsset(asset)}><Trash2 size={14}/></IconButton></div>)}</div> : <div className="sidebar-empty">{assetSearch?'No matching assets.':'Your uploaded images will appear here.'}</div>}<div className="panel-tip">SVG uploads are disabled to avoid unsafe active content. Raster images are size-limited.</div></>}
      </div></aside>
      <main className="editor-canvas-area"><div className="canvas-topline"><div className="canvas-breadcrumb"><FolderOpen size={14}/><span>{project.name}</span><b>/</b><strong>{activePage.title}</strong></div><span className="canvas-width-label">{viewportWidths[viewport]} px</span></div><div className={`canvas-workbench device-${viewport}`} onDragOver={(e)=>e.preventDefault()} onDrop={onDrop} onPointerDown={(e)=>{if(e.target===e.currentTarget)store.getState().select(null)}}><div className="canvas-page" style={{width:`${viewportWidths[viewport]}px`,maxWidth:'100%'}} onPointerDown={(e)=>{if(e.target===e.currentTarget)store.getState().select(null)}}><SiteRenderer nodes={nodes} selectedId={selectedId} editMode onSelect={(id)=>store.getState().select(id)} onTextChange={(id,text)=>store.getState().updateText(id,text)} pageSlugs={pages.map((p)=>p.slug)}/>{nodes.length===0 && <div className="canvas-empty"><div><SparkleGlyph/><h2>Start with a blank canvas</h2><p>Choose a component from the left, or drag one here.</p><Button variant="primary" size="sm" onClick={()=>{setTab('elements');addNode('hero')}}><Plus size={14}/>Add a hero section</Button></div></div>}</div></div><div className="canvas-footline"><span>Canvas · {viewport}</span><span>Click text to edit · drag components to reorder</span></div></main>
      <aside className="editor-right"><div className="inspector-head"><div><b>Properties</b><small>{selectedNode?labels[selectedNode.type]:activePage.title}</small></div><IconButton label="Website settings" onClick={()=>setProjectSettingsOpen(true)}><Settings2 size={17}/></IconButton></div><div className="inspector-content">{selectedNode ? <><div className="inspector-section"><span className="inspector-label">CONTENT</span>{['heading','paragraph','text','button','link','hero','features','testimonials','pricing','faq','team','statistics','gallery','cta','card','navbar','footer','section','container'].includes(selectedNode.type) && <label className="field-label">Text<Input key={`text-${selectedNode.id}-${selectedNode.props.text}`} defaultValue={selectedNode.props.text??''} maxLength={2000} onBlur={(e)=>store.getState().updateText(selectedNode.id,e.currentTarget.value)}/></label>}{(selectedNode.type==='button'||selectedNode.type==='link') && <label className="field-label">Link URL<Input key={`href-${selectedNode.id}`} defaultValue={selectedNode.props.href??''} placeholder="https:// or /page" maxLength={500} onBlur={(e)=>{const value=e.currentTarget.value;if(/^(javascript|data|file|vbscript):/i.test(value)) {setError('Unsafe links are not allowed.');e.currentTarget.value='';return}; const n=findNode(store.getState().nodes,selectedNode.id);if(n)store.getState().setNodes(transformProps(store.getState().nodes,selectedNode.id,{href:value}),true)}}/></label>}{selectedNode.type==='heading' && <label className="field-label">Heading level<select className="input" value={selectedNode.props.level??2} onChange={(e)=>store.getState().setNodes(transformProps(store.getState().nodes,selectedNode.id,{level:Number(e.target.value)}),true)}>{[1,2,3,4,5,6].map((n)=><option key={n} value={n}>H{n}</option>)}</select></label>}{selectedNode.type==='image' && <><label className="field-label">Image source<Input key={`src-${selectedNode.id}`} defaultValue={selectedNode.props.src??''} placeholder="https://… or choose an asset" maxLength={1000} onBlur={(e)=>store.getState().setNodes(transformProps(store.getState().nodes,selectedNode.id,{src:e.currentTarget.value}),true)}/></label><label className="field-label">Alt text<Input key={`alt-${selectedNode.id}`} defaultValue={selectedNode.props.alt??''} maxLength={500} onBlur={(e)=>store.getState().setNodes(transformProps(store.getState().nodes,selectedNode.id,{alt:e.currentTarget.value}),true)}/></label><Button size="sm" onClick={()=>setTab('assets')}><ImagePlus size={14}/>Choose from assets</Button></>}</div><div className="inspector-section"><span className="inspector-label">COLORS</span><label className="field-label">Text color<StyleInput value={selectedNode.style.color} onSave={(value)=>void updateStyle('color',value)} placeholder="#202338"/></label><label className="field-label">Background<StyleInput value={selectedNode.style.backgroundColor} onSave={(value)=>void updateStyle('backgroundColor',value)} placeholder="transparent"/></label></div><div className="inspector-section"><span className="inspector-label">TYPOGRAPHY</span><label className="field-label">Font size<StyleInput value={selectedNode.style.fontSize} onSave={(value)=>void updateStyle('fontSize',value)} placeholder="1rem"/></label><label className="field-label">Alignment<select className="input" value={selectedNode.style.textAlign??'left'} onChange={(e)=>void updateStyle('textAlign',e.target.value)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="justify">Justify</option></select></label></div><div className="inspector-section"><span className="inspector-label">SPACING & SHAPE</span><label className="field-label">Padding<StyleInput value={selectedNode.style.padding} onSave={(value)=>void updateStyle('padding',value)} placeholder="1rem"/></label><label className="field-label">Border radius<StyleInput value={selectedNode.style.borderRadius} onSave={(value)=>void updateStyle('borderRadius',value)} placeholder="0.5rem"/></label><label className="field-label">Width<StyleInput value={selectedNode.style.width} onSave={(value)=>void updateStyle('width',value)} placeholder="100%"/></label></div><div className="inspector-actions"><Button size="sm" onClick={()=>store.getState().duplicate(selectedNode.id)}><Copy size={14}/>Duplicate</Button><Button size="sm" variant="danger" onClick={()=>store.getState().remove(selectedNode.id)}><Trash2 size={14}/>Delete</Button></div></> : <><div className="page-properties"><span className="page-properties-mark">▤</span><h3>{activePage.title}</h3><p>Page settings and SEO information.</p><label className="field-label">Page title<Input key={`pt-${activePage.id}-${activePage.title}`} defaultValue={activePage.title} maxLength={120} onBlur={(e)=>{if(e.currentTarget.value.trim() && e.currentTarget.value!==activePage.title) void renamePage({...activePage,title:e.currentTarget.value})}}/></label><label className="field-label">URL slug<Input key={`ps-${activePage.id}-${activePage.slug}`} defaultValue={activePage.slug} maxLength={80} onBlur={(e)=>{const slug=slugify(e.currentTarget.value);if(slug!==activePage.slug) void api(`/pages/${activePage.id}`,{method:'PATCH',body:jsonBody({slug})}).then(()=>{const updated={...activePage,slug};setActivePage(updated);setPages(pages.map(x=>x.id===updated.id?updated:x))}).catch((err)=>setError(err.message))}}/></label><label className="field-label">SEO title<Input key={`seo-${activePage.id}-${activePage.seoTitle}`} defaultValue={activePage.seoTitle??''} maxLength={120} placeholder="Page title for search" onBlur={(e)=>void updatePageSeo('seoTitle',e.currentTarget.value)}/></label><label className="field-label">SEO description<textarea key={`desc-${activePage.id}-${activePage.seoDescription}`} className="input textarea" defaultValue={activePage.seoDescription??''} maxLength={300} placeholder="Short page description" onBlur={(e)=>void updatePageSeo('seoDescription',e.currentTarget.value)}/></label><Button size="sm" onClick={()=>void setHome(activePage)}>{activePage.isHome?<Check size={14}/>:<Plus size={14}/>} {activePage.isHome?'Homepage':'Set as homepage'}</Button></div></>}</div><div className="inspector-footer"><span><Check size={13}/>Changes autosave locally</span><button onClick={()=>setProjectSettingsOpen(true)}>Website settings</button></div></aside></div>
    {error && <div className="editor-toast error" role="alert">{error}<button onClick={()=>setError('')}><X size={15}/></button></div>}{notice && <div className="editor-toast success">{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}
    {projectSettingsOpen && <div className="modal-backdrop"><form className="modal-card" onSubmit={(e)=>void saveProjectSettings(e)}><div className="modal-head"><span className="modal-icon"><Settings2 size={18}/></span><button type="button" className="close-modal" onClick={()=>setProjectSettingsOpen(false)}>×</button></div><span className="eyebrow">WEBSITE SETTINGS</span><h2>Make it yours</h2><p>These settings are saved independently for this project.</p><label className="field-label">Website name<Input value={settings.title??project.name} maxLength={120} onChange={(e)=>setSettings({...settings,title:e.target.value})}/></label><label className="field-label">Meta description<textarea className="input textarea" value={settings.description??''} maxLength={300} onChange={(e)=>setSettings({...settings,description:e.target.value})}/></label><label className="field-label">Language<select className="input" value={settings.language??'en'} onChange={(e)=>setSettings({...settings,language:e.target.value})}><option value="en">English</option><option value="ml">Malayalam</option><option value="hi">Hindi</option></select></label><label className="field-label">Brand color<input className="input color-input" type="color" value={/^#[0-9a-f]{6}$/i.test(settings.primaryColor??'')?settings.primaryColor:'#5b5ce2'} onChange={(e)=>setSettings({...settings,primaryColor:e.target.value})}/></label><label className="field-label">Font<select className="input" value={settings.fontFamily??'Inter'} onChange={(e)=>setSettings({...settings,fontFamily:e.target.value})}><option>Inter</option><option>system-ui</option><option>Georgia</option><option>Arial</option></select></label><div className="modal-actions"><Button type="button" onClick={()=>setProjectSettingsOpen(false)}>Cancel</Button><Button variant="primary" type="submit"><Save size={15}/>Save settings</Button></div></form></div>}
    {pushOpen && <div className="modal-backdrop"><div className="modal-card"><div className="modal-head"><span className="modal-icon"><GitBranch size={18}/></span><button type="button" className="close-modal" onClick={()=>setPushOpen(false)}>×</button></div><span className="eyebrow">GITHUB PUSH</span><h2>Choose a repository</h2><p>WebCraft generates and validates a standalone Vite site before committing its source.</p>{repositories.length ? <label className="field-label">Repository<select className="input select-input" value={selectedRepo} onChange={(e)=>setSelectedRepo(e.target.value)}>{repositories.map((repo)=><option key={repo.fullName} value={repo.fullName}>{repo.fullName} · {repo.private?'Private':'Public'}</option>)}</select></label> : <div className="settings-empty">No repositories found. Create one in Settings first.</div>}<div className="modal-actions"><Button type="button" onClick={()=>setPushOpen(false)}>Cancel</Button><Button variant="primary" busy={pushBusy} disabled={!selectedRepo} onClick={()=>void pushToGitHub()}><GitBranch size={15}/>Validate & push</Button></div></div></div>}
  </div>
}

function StyleInput({ value, onSave, placeholder }: { value?: string; onSave: (value: string) => void; placeholder: string }) { return <Input key={`${value??''}-${placeholder}`} defaultValue={value??''} placeholder={placeholder} maxLength={120} onBlur={(e)=>onSave(e.currentTarget.value)}/> }
function SparkleGlyph(){return <span className="sparkle-glyph">✦</span>}
function transformProps(nodes:BuilderNode[], id:string, values:Record<string,unknown>):BuilderNode[]{return nodes.map(n=>n.id===id?{...n,props:{...n.props,...values}}:{...n,children:transformProps(n.children,id,values)})}
