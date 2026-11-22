import type { BuilderNode } from './schema'
import { PageDataSchema, ProjectSettingsSchema, validateTree } from './schema'

export type ExportPage = { title: string; slug: string; isHome: boolean; seoTitle?: string; seoDescription?: string; nodes: BuilderNode[] }
export type ExportProject = { name: string; settings?: unknown; pages: ExportPage[] }
export type ExportAsset = { filename: string; contentBase64: string }
export type GeneratedFile = { content: string; encoding: 'utf-8' | 'base64' }
const q = (value: string) => JSON.stringify(value)
const safeSlug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page'
const textFile = (content: string): GeneratedFile => ({ content, encoding: 'utf-8' })

export function generateSource(project: ExportProject, assets: ExportAsset[] = []): Record<string, GeneratedFile> {
  if (!project.name.trim() || project.name.length > 120) throw new Error('Project name is invalid')
  const settings = ProjectSettingsSchema.parse(project.settings ?? {})
  if (!project.pages.length || project.pages.length > 100) throw new Error('A project needs 1–100 pages to export')
  const seen = new Set<string>()
  const pages = project.pages.map((page) => {
    const normalized = PageDataSchema.parse(page)
    if (seen.has(normalized.slug)) throw new Error(`Duplicate page slug: ${normalized.slug}`)
    seen.add(normalized.slug)
    return { ...normalized, nodes: validateTree(normalized.nodes) }
  })
  if (!pages.some((page) => page.isHome)) pages[0]!.isHome = true
  const assetFiles: Record<string, GeneratedFile> = {}
  const assetPaths = new Map<string, string>()
  for (const asset of assets) {
    const filename = asset.filename.split('/').pop() ?? ''
    if (asset.filename !== filename || asset.filename.includes('\\') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(png|jpe?g|webp|gif)$/i.test(filename)) throw new Error('Asset filename is not allowed')
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.contentBase64) || asset.contentBase64.length > 7_000_000) throw new Error('Asset encoding is invalid or too large')
    assetFiles[`public/assets/${filename}`] = { content: asset.contentBase64, encoding: 'base64' }
    assetPaths.set(filename, `/assets/${filename}`)
  }
  const copyNodes = (nodes: BuilderNode[]): BuilderNode[] => nodes.map((node) => {
    const src = node.props.src
    let nextSrc = src
    if (src?.includes('/media/')) {
      const filename = src.slice(src.lastIndexOf('/media/') + 7).split(/[?#]/)[0] ?? ''
      const localPath = assetPaths.get(filename)
      if (localPath) nextSrc = localPath
    }
    return { ...node, props: { ...node.props, ...(nextSrc ? { src: nextSrc } : {}) }, children: copyNodes(node.children) }
  })
  const exportPages = pages.map((page) => ({ ...page, nodes: copyNodes(page.nodes) }))
  const data = { name: project.name, settings, pages: exportPages }
  const files: Record<string, GeneratedFile> = {
    'package.json': textFile(JSON.stringify({ name: safeSlug(project.name), private: true, version: '1.0.0', type: 'module', scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview' }, dependencies: { react: '19.3.1', 'react-dom': '19.3.1', 'react-router-dom': '7.18.6' }, devDependencies: { '@vitejs/plugin-react': '6.3.0', vite: '8.3.8', typescript: '5.9.3', '@types/react': '19.2.14', '@types/react-dom': '19.2.3' } }, null, 2)),
    'index.html': textFile(`<!doctype html>\n<html lang="${settings.language}"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta name="description" content="${escapeHtml(settings.description)}"/><title>${escapeHtml(settings.title || project.name)}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`),
    'tsconfig.json': textFile(JSON.stringify({ compilerOptions: { target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', skipLibCheck: true, moduleResolution: 'Bundler', resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx', strict: true }, include: ['src', 'vite.config.ts'] }, null, 2)),
    'vite.config.ts': textFile(`import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n`),
    'src/main.tsx': textFile(`import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport { BrowserRouter } from 'react-router-dom'\nimport App from './App'\nimport './styles.css'\n\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>)\n`),
    'src/site.json': textFile(JSON.stringify(data, null, 2)),
    'src/components/SiteRenderer.tsx': textFile(rendererFile()),
    'src/App.tsx': textFile(appFile()),
    'src/styles.css': textFile(`:root{font-family:${settings.fontFamily},system-ui,sans-serif;color:#202338;background:#fff;font-synthesis:none;text-rendering:optimizeLegibility}*{box-sizing:border-box}body{margin:0}img,video{max-width:100%;height:auto}.wc-section-content{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.wc-node form{display:flex;gap:.75rem;align-items:center;justify-content:center;flex-wrap:wrap}.wc-node input{padding:.7rem;border:1px solid #d1d5db;border-radius:.5rem}@media(max-width:700px){.wc-section-content{grid-template-columns:1fr}}\n`),
    'README.md': textFile(`# ${safeMarkdown(project.name)}\n\nGenerated by WebCraft. This is a standalone React + Vite + TypeScript website and does not need WebCraft or its CMS to run.\n\n## Run locally\n\n\`\`\`sh\nnpm install\nnpm run dev\n\n# Production build\nnpm run build\n\n# Preview the built site\nnpm run preview\n\`\`\`\n\nEdit page data in \`src/site.json\` and rendering in \`src/components/SiteRenderer.tsx\`.\n`),
    ...assetFiles,
  }
  for (const page of exportPages) files[`src/pages/${safeSlug(page.slug)}.tsx`] = textFile(`import React from 'react'\nimport { SiteRenderer } from '../components/SiteRenderer'\nimport site from '../site.json'\nexport default function Page(){const page=site.pages.find(p=>p.slug===${q(page.slug)})!;return <main><SiteRenderer nodes={page.nodes}/></main>}\n`)
  return files
}
function safeMarkdown(value: string) { return value.replace(/[\r\n]/g, ' ').replace(/[`#]/g, '') }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)) }
function rendererFile() { return `import React from 'react'
type Node={id:string;type:string;props?:{text?:string;href?:string;src?:string;alt?:string;level?:number};style?:Record<string,string|number>;children?:Node[]}
const tags:Record<string,string>={section:'section',container:'div',heading:'h2',paragraph:'p',text:'span',button:'a',link:'a',image:'img',video:'video',icon:'span',divider:'hr',spacer:'div',grid:'div',flex:'div',columns:'div',card:'article',navbar:'nav',footer:'footer',hero:'section',features:'section',testimonials:'section',pricing:'section',faq:'section',team:'section',statistics:'section',gallery:'section','contact-form':'section',newsletter:'section',cta:'section'}
function safeUrl(value?:string){if(!value)return '#';const v=value.trim();const lower=v.toLowerCase();if(lower.startsWith('javascript:')||lower.startsWith('vbscript:')||lower.startsWith('data:')||lower.startsWith('file:'))return '#';return lower.startsWith('https://')||lower.startsWith('mailto:')||lower.startsWith('tel:')||(v.startsWith('/')&&!v.startsWith('//'))||v.startsWith('#')||v.startsWith('?')||v.startsWith('./')||v.startsWith('../')?v:'#'}
export function SiteRenderer({nodes}:{nodes:Node[]}){return <>{nodes.map(node=><NodeView key={node.id} node={node}/>)}</>}
function NodeView({node}:{node:Node}){const tag=node.type==='heading'?('h'+Math.max(1,Math.min(6,node.props?.level??2))):tags[node.type]??'div';const Tag=tag as keyof React.JSX.IntrinsicElements;const style={...node.style} as React.CSSProperties;if(node.type==='grid'||node.type==='columns'){style.display='grid';style.gridTemplateColumns='repeat(3,minmax(0,1fr))'}if(node.type==='flex')style.display='flex';const children=(node.children??[]).map(child=><NodeView key={child.id} node={child}/>);const text=node.props?.text??'';if(node.type==='image')return <img className="wc-node" style={style} src={safeUrl(node.props?.src)} alt={node.props?.alt??''} loading="lazy"/>;if(node.type==='video')return <video className="wc-node" style={style} src={safeUrl(node.props?.src)} controls preload="metadata"/>;if(node.type==='divider')return <hr className="wc-node" style={style}/>;if(node.type==='spacer')return <div aria-hidden="true" className="wc-node" style={{...style,minHeight:style.height??'2rem'}}/>;if(node.type==='icon')return <span className="wc-node" style={style} role="img" aria-label="decorative icon">{text||'✦'}</span>;if(node.type==='contact-form'||node.type==='newsletter')return <section className="wc-node" style={style}><h2>{text}</h2><form onSubmit={e=>e.preventDefault()}><label>Email address <input type="email" placeholder="you@example.com" required/></label><button type="submit">{node.type==='newsletter'?'Subscribe':'Send message'}</button></form>{children}</section>;if(node.type==='button'||node.type==='link')return <a className="wc-node" style={style} href={safeUrl(node.props?.href)}>{text}{children}</a>;return <Tag className={'wc-node wc-'+node.type} style={style}>{text}{children}</Tag>}
` }
function appFile() { return `import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import site from './site.json'
import { SiteRenderer } from './components/SiteRenderer'
export default function App(){const home=site.pages.find(p=>p.isHome)??site.pages[0];return <Routes>{site.pages.map(page=><Route key={page.slug} path={page.slug===home.slug?'/':'/'+page.slug} element={<main><SiteRenderer nodes={page.nodes}/></main>}/>)}<Route path="*" element={<Navigate to="/" replace/>}/></Routes>}
` }
