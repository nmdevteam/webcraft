import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, ArrowDownToLine, ArrowRight, Boxes, Check, ChevronDown, Clock3, Copy, FilePlus2, FolderKanban, Globe2, Layers3, LogOut, MoreHorizontal, Plus, Search, Settings2, Sparkles, Sun, Moon, Trash2, WandSparkles } from 'lucide-react'
import { TEMPLATES, templateById } from '@webcraft/core/templates'
import { api, jsonBody } from '../api'
import { useAuthStore } from '../store/auth'
import { downloadProjectZip } from '../lib/export'
import { Button, IconButton, Input, Status } from './ui'

type Project = { id: string; name: string; category: string; templateId: string; settings: any; createdAt: string; updatedAt: string }
type Page = { id: string; title: string; slug: string; isHome: boolean; nodes: any[] }
type ProjectsResponse = { docs: Project[]; totalDocs: number }

export function Dashboard() {
  const navigate = useNavigate()
  const { user, clear } = useAuthStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [templateId, setTemplateId] = useState('business')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [theme, setTheme] = useState<'light'|'dark'>(() => localStorage.getItem('webcraft-theme') === 'dark' ? 'dark' : 'light')

  async function refresh() {
    setLoading(true)
    try {
      const result = await api<ProjectsResponse>('/projects?limit=100&depth=0&sort=-updatedAt')
      setProjects(result.docs)
      const counts = await Promise.all(result.docs.map(async (project) => {
        const response = await api<{ totalDocs: number }>(`/pages?where[project][equals]=${encodeURIComponent(project.id)}&limit=1&depth=0`)
        return [project.id, response.totalDocs] as const
      }))
      setPageCounts(Object.fromEntries(counts))
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load projects.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('webcraft-theme', theme) }, [theme])
  const filtered = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())), [projects, search])
  const totalPages = Object.values(pageCounts).reduce((sum, count) => sum + count, 0)
  const template = templateById(templateId)

  async function createProject(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const name = projectName.trim() || 'Untitled website'
      const created = await api<Project>('/projects', { method: 'POST', body: jsonBody({ name, category: template.category, templateId: template.id, settings: { language: 'en', title: name, description: '', primaryColor: '#5b5ce2', fontFamily: 'Inter' } }) })
      const nodes = structuredClone(template.nodes)
      const page = await api<Page>('/pages', { method: 'POST', body: jsonBody({ title: 'Home', slug: 'home', isHome: true, nodes, revision: 0, project: created.id }) })
      setDialog(false); setProjectName(''); navigate(`/editor/${created.id}?page=${page.id}`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create project.') }
    finally { setBusy(false) }
  }
  async function rename(project: Project) {
    const name = window.prompt('New website name', project.name)?.trim()
    if (!name || name === project.name) return
    try { await api(`/projects/${project.id}`, { method: 'PATCH', body: jsonBody({ name, settings: { ...project.settings, title: name } }) }); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Rename failed.') }
  }
  async function duplicate(project: Project) {
    setBusy(true); setError('')
    try {
      const copy = await api<Project>('/projects', { method: 'POST', body: jsonBody({ name: `${project.name} copy`, category: project.category, templateId: project.templateId, settings: project.settings }) })
      const { docs } = await api<{ docs: Page[] }>(`/pages?where[project][equals]=${encodeURIComponent(project.id)}&limit=100&depth=0`)
      for (const page of docs) await api('/pages', { method: 'POST', body: jsonBody({ title: page.title, slug: page.slug, isHome: page.isHome, nodes: page.nodes, revision: 0, project: copy.id }) })
      await refresh(); setNotice(`Duplicated “${project.name}”.`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Duplicate failed.') }
    finally { setBusy(false) }
  }
  async function remove(project: Project) {
    if (!window.confirm(`Delete “${project.name}”, all its pages, and its uploaded images? This cannot be undone.`)) return
    setBusy(true); setError('')
    try {
      await api(`/webcraft/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' }); await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Delete failed.') }
    finally { setBusy(false) }
  }
  async function exportProject(project: Project) {
    setBusy(true); setError(''); setNotice('')
    try { await downloadProjectZip(project); setNotice(`Validated source downloaded for “${project.name}”.`) }
    catch (err) { setError(err instanceof Error ? err.message : 'Export failed.') }
    finally { setBusy(false) }
  }

  return <div className="app-shell">
    <aside className="side-nav"><div className="brand-lockup"><span className="brand-mark"><Boxes size={20}/></span><b>webcraft</b><span className="local-badge">LOCAL</span></div>
      <div className="workspace-switch"><span className="avatar">{(user?.name ?? user?.email ?? 'W').slice(0,1).toUpperCase()}</span><span className="workspace-meta"><b>{user?.name || 'Your workspace'}</b><small>Personal workspace</small></span><ChevronDown size={15}/></div>
      <div className="nav-section-label">WORKSPACE</div><button className="nav-link active"><FolderKanban size={17}/>Overview</button><button className="nav-link" onClick={() => document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' })}><Globe2 size={17}/>My websites <span className="nav-count">{projects.length}</span></button><button className="nav-link" onClick={() => { setError(''); setDialog(true) }}><Sparkles size={17}/>Templates</button>
      <div className="nav-section-label nav-gap">PREFERENCES</div><button className="nav-link" onClick={() => navigate('/settings')}><Settings2 size={17}/>Settings</button>
      <div className="side-nav-bottom"><div className="storage-card"><div className="storage-icon"><Layers3 size={16}/></div><b>Your work, your machine.</b><p>Projects are stored in your local Payload database.</p><span><i/></span><small>LOCAL-FIRST WORKSPACE</small></div><button className="nav-link" onClick={() => clear()}><LogOut size={17}/>Sign out</button></div>
    </aside>
    <main className="dashboard-main"><header className="top-header"><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Overview</strong></div><div className="header-actions"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="Toggle theme">{theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}</button><span className="user-chip"><span className="avatar small">{(user?.name ?? 'W').slice(0,1).toUpperCase()}</span>{user?.name || user?.email}</span></div></header>
      <div className="dashboard-content"><div className="welcome-row"><div><span className="eyebrow">SUNDAY, YOUR WAY</span><h1>Good to see you, {user?.name?.split(' ')[0] || 'there'}<span className="wave-dot">.</span></h1><p>Bring your next website to life, one good idea at a time.</p></div><Button variant="primary" onClick={() => { setError(''); setDialog(true) }}><Plus size={17}/>Create website</Button></div>
        <div className="stats-row"><div className="stat-card"><span className="stat-icon purple"><Globe2 size={17}/></span><small>Total websites</small><b>{projects.length}</b><span className="stat-foot">In your workspace</span></div><div className="stat-card"><span className="stat-icon blue"><Layers3 size={17}/></span><small>Total pages</small><b>{totalPages}</b><span className="stat-foot">Across your websites</span></div><div className="stat-card"><span className="stat-icon amber"><Clock3 size={17}/></span><small>Last saved</small><b className="stat-date">{projects[0] ? new Date(projects[0].updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</b><span className="stat-foot">Latest project update</span></div><div className="stat-card"><span className="stat-icon green"><Activity size={17}/></span><small>Workspace status</small><b className="stat-online"><span/>Ready</b><span className="stat-foot">Local database connected</span></div></div>
        <div className="section-heading" id="projects"><div><span className="eyebrow">YOUR CREATIVE SPACE</span><h2>My websites <span className="count-pill">{projects.length}</span></h2></div><div className="project-toolbar"><label className="search-box"><Search size={16}/><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search websites" aria-label="Search websites"/></label><Button variant="secondary" onClick={() => { setError(''); setDialog(true) }}><Plus size={16}/>New website</Button></div></div>
        {error && <div className="inline-error dismissible" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}{notice && <div className="inline-success">{notice}<button onClick={() => setNotice('')}>×</button></div>}
        {loading ? <div className="loading-grid">{[1,2,3].map((n) => <div className="skeleton-card" key={n}/>)}</div> : filtered.length ? <div className="project-grid">{filtered.map((project, index) => <ProjectCard key={project.id} project={project} count={pageCounts[project.id] ?? 0} index={index} onOpen={() => navigate(`/editor/${project.id}`)} onPreview={() => navigate(`/preview/${project.id}`)} onRename={() => void rename(project)} onDuplicate={() => void duplicate(project)} onDelete={() => void remove(project)} onExport={() => void exportProject(project)} busy={busy}/>)}</div> : <div className="empty-state"><div className="empty-illustration"><WandSparkles size={26}/></div><h3>{search ? 'No websites match your search' : 'A fresh canvas awaits'}</h3><p>{search ? 'Try a different name or clear the search.' : 'Create a website from a template or start with a blank page.'}</p>{!search && <Button variant="primary" onClick={() => setDialog(true)}><Plus size={16}/>Create your first website</Button>}</div>}
        <div className="template-strip"><div><span className="eyebrow">A LITTLE INSPIRATION</span><h2>Start with a template</h2><p>Pick a direction. Make it yours.</p></div><button className="all-templates" onClick={() => setDialog(true)}>Browse templates <ArrowRight size={15}/></button></div><div className="template-row">{TEMPLATES.slice(1,5).map((t, i) => <button className={`template-mini mini-${i}`} key={t.id} onClick={() => { setTemplateId(t.id); setProjectName(''); setDialog(true) }}><span className="template-mini-icon">{i === 0 ? <Globe2 size={18}/> : i === 1 ? <Sparkles size={18}/> : i === 2 ? <Boxes size={18}/> : <FilePlus2 size={18}/>}</span><b>{t.name}</b><small>{t.category}</small><ArrowRight size={15}/></button>)}</div>
        <footer className="dashboard-footer"><span>WebCraft local builder</span><span>All changes stay in your workspace <span className="local-foot-dot"/></span></footer>
      </div>
    </main>
    {dialog && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setDialog(false) }}><form className="modal-card" onSubmit={createProject}><div className="modal-head"><span className="modal-icon"><Sparkles size={18}/></span><button type="button" className="close-modal" onClick={() => setDialog(false)}>×</button></div><span className="eyebrow">NEW PROJECT</span><h2>What are we building?</h2><p>Choose a template to get moving, or begin with a blank canvas.</p><label className="field-label">Website name<Input autoFocus value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g. Northstar Studio" maxLength={120}/></label><label className="field-label">Starting point<select className="input select-input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>{TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.category}</option>)}</select></label><div className="template-description"><Check size={14}/>{template.description}</div>{error && <div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><Button type="button" onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary" type="submit" busy={busy}><Plus size={16}/>Create website</Button></div></form></div>}
  </div>
}

function ProjectCard({ project, count, index, onOpen, onPreview, onRename, onDuplicate, onDelete, onExport, busy }: { project: Project; count: number; index: number; onOpen: () => void; onPreview: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void; onExport: () => void; busy: boolean }) {
  const [menu, setMenu] = useState(false)
  const stamp = new Date(project.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return <article className="project-card"><button className={`project-thumb thumb-${index % 4}`} onClick={onOpen} aria-label={`Open ${project.name}`}><span className="thumb-top"><span className="thumb-brand"><i/>{project.name}</span><span className="thumb-actions"><span/><span/><span/></span></span><div className="thumb-content"><span className="thumb-eyebrow">{project.category.toUpperCase()}</span><b>{project.name}</b><i/><i/><i/></div><span className="thumb-bottom"><span>{project.templateId === 'blank' ? 'Blank canvas' : 'WebCraft template'}</span><span className="thumb-screen">↗</span></span></button><div className="project-details"><div className="project-title-row"><button className="project-name" onClick={onOpen}>{project.name}</button><div className="menu-wrap"><IconButton label="Project actions" onClick={() => setMenu(!menu)}><MoreHorizontal size={19}/></IconButton>{menu && <><button className="menu-close" onClick={() => setMenu(false)} aria-label="Close menu"/><div className="project-menu">{[[<ArrowRight size={15}/>,'Open editor',onOpen],[<Globe2 size={15}/>,'Preview',onPreview],[<ArrowDownToLine size={15}/>,'Export source',onExport],[<Copy size={15}/>,'Duplicate',onDuplicate],[<Settings2 size={15}/>,'Rename',onRename],[<Trash2 size={15}/>,'Delete',onDelete]].map(([icon,label,fn]: any) => <button key={label} className={label==='Delete'?'menu-danger':''} onClick={() => { setMenu(false); fn() }}>{icon}{label}</button>)}</div></>}</div></div><div className="project-meta"><span><Layers3 size={13}/>{count} {count === 1 ? 'page' : 'pages'}</span><span><Clock3 size={13}/>{stamp}</span></div><div className="project-card-footer"><Status tone="success">Saved</Status><div className="card-actions"><button onClick={onPreview}>Preview</button><Button size="sm" variant="secondary" disabled={busy} onClick={onOpen}>Open editor<ArrowRight size={14}/></Button></div></div></div></article>
}
