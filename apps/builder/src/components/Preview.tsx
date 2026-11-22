import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Monitor, Smartphone, Tablet } from 'lucide-react'
import { ProjectSettingsSchema, type BuilderNode, type ProjectSettings } from '@webcraft/core/schema'
import { SiteRenderer } from '@webcraft/core/renderer'
import { api, apiAllDocs } from '../api'

type Project = { id: string; name: string; settings: ProjectSettings }
type Page = { id: string; title: string; slug: string; isHome: boolean; seoTitle?: string; seoDescription?: string; nodes: BuilderNode[] }
const desktopWidth = 1200
export function Preview() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const [query, setQuery] = useSearchParams()
  const [project, setProject] = useState<Project | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [page, setPage] = useState<Page | null>(null)
  const [device, setDevice] = useState<'desktop'|'tablet'|'mobile'>('desktop')
  const [error, setError] = useState('')
  useEffect(() => {
    Promise.all([
      api<Project>(`/projects/${encodeURIComponent(projectId)}?depth=0`),
      apiAllDocs<Page>(`/pages?where[project][equals]=${encodeURIComponent(projectId)}&limit=100&depth=0`),
    ]).then(([p,loadedPages])=>{
      const normalized = { ...p, settings: ProjectSettingsSchema.parse(p.settings ?? {}) }
      setProject(normalized); setPages(loadedPages)
      const active = loadedPages.find((x)=>x.id===query.get('page')) ?? loadedPages.find((x)=>x.isHome) ?? loadedPages[0] ?? null
      setPage(active); if(active)setQuery({page:active.id},{replace:true})
    }).catch((err)=>setError(err instanceof Error?err.message:'Could not load preview.'))
  },[projectId])
  function navigateInternal(event: React.MouseEvent) {
    const anchor=(event.target as HTMLElement).closest('a')
    if(!anchor)return
    const href=anchor.getAttribute('href')??''
    if(href.startsWith('/')&&!href.startsWith('//')){
      const target=pages.find(item=>item.slug===href.replace(/^\//,''))
      if(target){event.preventDefault();setPage(target);setQuery({page:target.id})}
    }
  }
  if(error)return <div className="preview-error"><p>{error}</p><button onClick={()=>navigate('/')}>Back</button></div>
  if(!project||!page)return <div className="boot-screen"><span>Preparing preview…</span></div>
  const width = device === 'desktop' ? desktopWidth : project.settings.breakpoints[device]
  return <div className="preview-shell"><header className="preview-toolbar"><button className="preview-back" onClick={()=>navigate(`/editor/${projectId}?page=${page.id}`)}><ArrowLeft size={16}/>Back to editor</button><div className="preview-title"><span className="preview-dot"/><b>Preview</b><span>/</span><span>{project.settings.title || project.name}</span><span>/</span><strong>{page.title}</strong></div><div className="viewport-picker">{(['desktop','tablet','mobile'] as const).map((item)=><button key={item} className={device===item?'selected':''} onClick={()=>setDevice(item)} aria-label={`${item} viewport`}>{item==='desktop'?<Monitor size={16}/>:item==='tablet'?<Tablet size={16}/>:<Smartphone size={16}/>}</button>)}</div></header><main className={`preview-workspace preview-${device}`}><div className="preview-website" style={{width:`${width}px`,maxWidth:'100%'}} onClick={navigateInternal}><SiteRenderer nodes={page.nodes} settings={project.settings} pageSlugs={pages.map(p=>p.slug)}/></div></main><footer className="preview-footer"><span>{page.seoTitle||page.title}</span><select value={page.id} onChange={(e)=>{const next=pages.find(p=>p.id===e.target.value);if(next){setPage(next);setQuery({page:next.id})}}} aria-label="Preview page">{pages.map(p=><option key={p.id} value={p.id}>{p.title}{p.isHome?' · Home':''}</option>)}</select><span>{device} viewport · {width}px</span></footer></div>
}
