import { useEffect, useMemo, useState } from 'react'
import { Clock3, Eye, History, LoaderCircle, RotateCcw, Save, X } from 'lucide-react'
import { SiteRenderer } from '@webcraft/core/renderer'
import type { BuilderNode, ProjectSettings, ProjectVersionSnapshot, VersionReason } from '@webcraft/core/schema'
import { api, jsonBody } from '../api'
import { Button } from './ui'

type CurrentPage = { id: string; title: string; slug: string; isHome: boolean; seoTitle?: string; seoDescription?: string; nodes: BuilderNode[] }
type CurrentProject = { name: string; settings: ProjectSettings }
type VersionSummary = { id: string; label: string; reason: VersionReason; pageCount: number; createdAt: string }
type VersionDetail = VersionSummary & { snapshot: ProjectVersionSnapshot }

type Comparison = { recoverPages: number; addedPages: number; changedPages: number; settingsChanged: boolean; projectNameChanged: boolean }

export function compareVersionToCurrent(currentProject: CurrentProject, currentPages: CurrentPage[], snapshot: ProjectVersionSnapshot): Comparison {
  const byId = new Map(currentPages.map((page) => [String(page.id), page]))
  const bySlug = new Map(currentPages.map((page) => [page.slug, page]))
  const matches = snapshot.pages.map((page) => byId.get(page.sourceId))
  const matched = new Set(matches.filter(Boolean).map((page) => String(page!.id)))
  snapshot.pages.forEach((oldPage, index) => {
    if (matches[index]) return
    const candidate = bySlug.get(oldPage.slug)
    if (!candidate || matched.has(String(candidate.id))) return
    matches[index] = candidate
    matched.add(String(candidate.id))
  })
  let recoverPages = 0
  let changedPages = 0
  for (const [index, oldPage] of snapshot.pages.entries()) {
    const page = matches[index]
    if (!page) { recoverPages += 1; continue }
    matched.add(String(page.id))
    const same = JSON.stringify({ title: page.title, slug: page.slug, isHome: page.isHome, seoTitle: page.seoTitle, seoDescription: page.seoDescription, nodes: page.nodes })
      === JSON.stringify({ title: oldPage.title, slug: oldPage.slug, isHome: oldPage.isHome, seoTitle: oldPage.seoTitle, seoDescription: oldPage.seoDescription, nodes: oldPage.nodes })
    if (!same) changedPages += 1
  }
  const addedPages = currentPages.filter((page) => !matched.has(String(page.id))).length
  return {
    recoverPages,
    addedPages,
    changedPages,
    settingsChanged: JSON.stringify(currentProject.settings) !== JSON.stringify(snapshot.project.settings),
    projectNameChanged: currentProject.name !== snapshot.project.name,
  }
}

const reasonLabel: Record<VersionReason, string> = {
  automatic: 'Automatic',
  manual: 'Manual',
  'before-delete': 'Before deletion',
  'before-settings-change': 'Before settings change',
  'before-restore': 'Before restore',
}

export function HistoryModal({ projectId, project, pages, onClose, onRestored }: {
  projectId: string
  project: CurrentProject
  pages: CurrentPage[]
  onClose: () => void
  onRestored: () => Promise<void>
}) {
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<VersionDetail | null>(null)
  const [selectedPageId, setSelectedPageId] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadVersions(page = pageNumber) {
    setLoading(true); setError('')
    try {
      const result = await api<{ versions: VersionSummary[]; page: number; totalPages: number }>(`/webcraft/projects/${encodeURIComponent(projectId)}/history?page=${page}`)
      setVersions(result.versions); setPageNumber(result.page); setTotalPages(Math.max(1, result.totalPages))
      const nextId = result.versions.some((version) => version.id === selectedId) ? selectedId : result.versions[0]?.id ?? ''
      setSelectedId(nextId)
      if (!nextId) { setDetail(null); setSelectedPageId('') }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load version history.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void loadVersions(1) }, [projectId])
  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    let current = true
    setDetail(null); setError('')
    void api<{ version: VersionDetail }>(`/webcraft/projects/${encodeURIComponent(projectId)}/history/${encodeURIComponent(selectedId)}`)
      .then((result) => { if (current) { setDetail(result.version); setSelectedPageId((old) => result.version.snapshot.pages.some((page) => page.sourceId === old) ? old : result.version.snapshot.pages[0]?.sourceId ?? '') } })
      .catch((err) => { if (current) setError(err instanceof Error ? err.message : 'Could not load this snapshot.') })
    return () => { current = false }
  }, [projectId, selectedId])

  const selectedPage = detail?.snapshot.pages.find((page) => page.sourceId === selectedPageId) ?? detail?.snapshot.pages[0]
  const comparison = useMemo(() => detail ? compareVersionToCurrent(project, pages, detail.snapshot) : null, [detail, project, pages])

  async function createManualSnapshot() {
    setBusy(true); setError('')
    try {
      await api(`/webcraft/projects/${encodeURIComponent(projectId)}/history`, { method: 'POST', body: jsonBody({ reason: 'manual', label: 'Manual snapshot' }) })
      await loadVersions(1)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create a snapshot.') }
    finally { setBusy(false) }
  }

  async function restore() {
    if (!detail) return
    const missing = comparison?.recoverPages ?? 0
    const warning = `Restore “${detail.label}” from ${new Date(detail.createdAt).toLocaleString()}? This replaces the project's pages and website settings.${missing ? ` It will recover ${missing} page${missing === 1 ? '' : 's'} missing now.` : ''} A pre-restore snapshot will be kept.`
    if (!window.confirm(warning)) return
    setBusy(true); setError('')
    try {
      await api(`/webcraft/projects/${encodeURIComponent(projectId)}/history/${encodeURIComponent(detail.id)}/restore`, { method: 'POST', body: '{}' })
      await onRestored()
      onClose()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not restore this version.') }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop history-backdrop" role="presentation">
    <section className="modal-card history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <header className="history-head"><span className="modal-icon"><History size={18}/></span><button className="close-modal" type="button" onClick={onClose} aria-label="Close history"><X size={16}/></button></header>
      <div className="history-title-row"><div><span className="eyebrow">PROJECT RECOVERY</span><h2 id="history-title">Version history</h2><p>Snapshots include pages and website settings. Editor undo/redo is stored with each page.</p></div><Button size="sm" variant="secondary" disabled={busy} onClick={()=>void createManualSnapshot()}><Save size={14}/>Snapshot now</Button></div>
      {error && <div className="history-error" role="alert">{error}</div>}
      <div className="history-layout">
        <aside className="history-list" aria-label="Project snapshots">
          {loading ? <div className="history-empty"><LoaderCircle className="spin" size={18}/>Loading history…</div> : versions.length ? versions.map((version) => <button key={version.id} className={`history-version ${selectedId === version.id ? 'active' : ''}`} onClick={()=>setSelectedId(version.id)}>
            <span className="history-version-icon"><Clock3 size={14}/></span><span className="history-version-copy"><b>{version.label}</b><small>{new Date(version.createdAt).toLocaleString()}</small><small>{reasonLabel[version.reason]} · {version.pageCount} page{version.pageCount === 1 ? '' : 's'}</small></span>
          </button>) : <div className="history-empty">No snapshots yet. Use “Snapshot now” or keep automatic snapshots enabled in Website settings.</div>}
          {totalPages > 1 && <div className="history-pagination"><button disabled={pageNumber <= 1 || loading} onClick={()=>void loadVersions(pageNumber - 1)}>Previous</button><small>{pageNumber} / {totalPages}</small><button disabled={pageNumber >= totalPages || loading} onClick={()=>void loadVersions(pageNumber + 1)}>Next</button></div>}
        </aside>
        <div className="history-detail">
          {!detail && !loading ? <div className="history-empty">Select a snapshot to inspect it.</div> : !detail ? <div className="history-empty"><LoaderCircle className="spin" size={18}/>Loading snapshot…</div> : <>
            <div className="history-detail-head"><div><span className="status">{reasonLabel[detail.reason]}</span><h3>{detail.label}</h3><small>{new Date(detail.createdAt).toLocaleString()}</small></div><Button variant="primary" size="sm" busy={busy} onClick={()=>void restore()}><RotateCcw size={14}/>Restore project</Button></div>
            {comparison && <div className="history-compare" aria-label="Changes from this snapshot to the current project">
              <div><b>{comparison.recoverPages}</b><small>pages to recover</small></div><div><b>{comparison.addedPages}</b><small>pages added since</small></div><div><b>{comparison.changedPages}</b><small>pages changed</small></div><div><b>{comparison.settingsChanged || comparison.projectNameChanged ? 'Yes' : 'No'}</b><small>settings changed</small></div>
            </div>}
            <div className="history-preview-heading"><span><Eye size={14}/>Snapshot preview</span><select className="input" value={selectedPage?.sourceId ?? ''} onChange={(event)=>setSelectedPageId(event.target.value)} aria-label="Preview snapshot page">{detail.snapshot.pages.map((page)=><option key={page.sourceId} value={page.sourceId}>{page.title}{page.isHome ? ' · Homepage' : ''}</option>)}</select></div>
            {selectedPage && <div className="history-preview"><div className="history-preview-meta"><b>{selectedPage.title}</b><small>/{selectedPage.slug} · {selectedPage.nodes.length} top-level component{selectedPage.nodes.length === 1 ? '' : 's'}</small></div><div className="history-preview-site"><SiteRenderer nodes={selectedPage.nodes} settings={detail.snapshot.project.settings} pageSlugs={detail.snapshot.pages.map((page)=>page.slug)}/></div></div>}
          </>}
        </div>
      </div>
      <footer className="history-footer"><small>Restore replaces the project's current pages and website settings. Current content is backed up first.</small><Button onClick={onClose}>Close</Button></footer>
    </section>
  </div>
}
