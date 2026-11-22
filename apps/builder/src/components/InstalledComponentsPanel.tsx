import { useEffect, useState } from 'react'
import { LoaderCircle, Package, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { BuilderNode, ProjectSettings } from '@webcraft/core/schema'
import { SiteRenderer } from '@webcraft/core/renderer'
import { api } from '../api'
import { Button, IconButton } from './ui'

type InstalledEntry = { id: string; name: string; description?: string; nodes: BuilderNode[] }
type InstalledRecord = { id: string; name: string; version: string; components: InstalledEntry[]; updatedAt?: string }

export function InstalledComponentsPanel({ projectId, settings, onInsert, onError, onNotice }: {
  projectId: string
  settings: ProjectSettings
  onInsert: (nodes: BuilderNode[]) => boolean
  onError: (message: string) => void
  onNotice: (message: string) => void
}) {
  const [records, setRecords] = useState<InstalledRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [expanded, setExpanded] = useState('')

  async function load() {
    setLoading(true)
    try {
      const result = await api<{ docs: InstalledRecord[] }>(`/webcraft/projects/${encodeURIComponent(projectId)}/installed-components`)
      setRecords(Array.isArray(result.docs) ? result.docs : [])
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not load installed components.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [projectId])

  async function update(record: InstalledRecord) {
    setBusy(record.id)
    try {
      const result = await api<{ installation: InstalledRecord; note?: string; upToDate?: boolean }>(`/webcraft/projects/${encodeURIComponent(projectId)}/installed-components/${encodeURIComponent(record.id)}`, { method: 'PATCH' })
      setRecords((current) => current.map((item) => item.id === record.id ? result.installation : item))
      onNotice(result.upToDate ? 'This component package is already current.' : result.note ? `Component package updated. ${result.note}` : 'Component package updated.')
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not update this package.') }
    finally { setBusy('') }
  }

  async function uninstall(record: InstalledRecord) {
    if (!window.confirm(`Uninstall “${record.name}” from this project? Its imported images will remain in the Asset Manager.`)) return
    setBusy(record.id)
    try {
      const result = await api<{ note?: string }>(`/webcraft/projects/${encodeURIComponent(projectId)}/installed-components/${encodeURIComponent(record.id)}`, { method: 'DELETE' })
      setRecords((current) => current.filter((item) => item.id !== record.id))
      onNotice(result.note ?? 'Component package uninstalled.')
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not uninstall this package.') }
    finally { setBusy('') }
  }

  if (loading) return <div className="sidebar-empty"><LoaderCircle size={18} className="spin"/><br/>Loading installed components…</div>
  return <>
    <div className="panel-intro"><b>Installed components</b><small>Reusable, project-owned copies. Add one to the current page or manage its saved version.</small></div>
    {!records.length ? <div className="sidebar-empty">No component packages are installed in this project. Browse the local marketplace to install one.</div> : <div className="installed-package-list">
      {records.map((record) => <section className="installed-package-card" key={record.id}>
        <div className="installed-package-heading"><div><b>{record.name}</b><small>Version {record.version}</small></div><IconButton label={`Uninstall ${record.name}`} disabled={Boolean(busy)} onClick={() => void uninstall(record)}><Trash2 size={14}/></IconButton></div>
        <div className="installed-component-list">{record.components.map((component) => <div className="installed-component" key={component.id}>
          <div className="installed-component-heading"><button onClick={() => setExpanded((current) => current === `${record.id}:${component.id}` ? '' : `${record.id}:${component.id}`)} aria-expanded={expanded === `${record.id}:${component.id}`}><b>{component.name}</b><small>{component.description || `${component.nodes.length} top-level element${component.nodes.length === 1 ? '' : 's'}`}</small></button><Button size="sm" onClick={() => { if (onInsert(component.nodes)) onNotice(`Inserted ${component.name} into the current page.`); else onError(`Could not insert ${component.name}; check component and page limits.`) }}><Plus size={13}/>Add</Button></div>
          {expanded === `${record.id}:${component.id}` && <div className="installed-component-preview" aria-label={`${component.name} preview`}><SiteRenderer nodes={component.nodes} settings={settings}/></div>}
        </div>)}</div>
        <Button size="sm" busy={busy === record.id} disabled={Boolean(busy)} onClick={() => void update(record)}><RefreshCw size={13}/>Update from catalog</Button>
      </section>)}
    </div>}
    <div className="panel-tip"><Package size={14}/>Installed components are copied into this project. Updating a package replaces its saved catalog copy; existing page instances stay independent and unchanged.</div>
  </>
}
