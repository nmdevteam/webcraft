import type { BuilderNode } from './schema'
import { PageDataSchema, ProjectSettingsSchema, validateTree } from './schema'
import { designSystemCss } from './design-system'

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
    if (assetPaths.has(filename)) throw new Error('Duplicate asset filename in export')
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.contentBase64) || asset.contentBase64.length > 7_000_000) throw new Error('Asset encoding is invalid or too large')
    assetFiles[`public/assets/${filename}`] = { content: asset.contentBase64, encoding: 'base64' }
    assetPaths.set(filename, `/assets/${filename}`)
  }
  const rewriteMediaPath = (value: string | undefined) => {
    if (!value || !value.startsWith('/media/')) return value
    const filename = value.slice('/media/'.length).split(/[?#]/)[0] ?? ''
    const localPath = assetPaths.get(filename)
    if (!localPath) throw new Error('A referenced project image is unavailable for export.')
    return localPath
  }
  const copyNodes = (nodes: BuilderNode[]): BuilderNode[] => nodes.map((node) => {
    const nextSrc = rewriteMediaPath(node.props.src)
    return { ...node, props: { ...node.props, ...(nextSrc ? { src: nextSrc } : {}) }, children: copyNodes(node.children) }
  })
  const exportPages = pages.map((page) => ({ ...page, nodes: copyNodes(page.nodes) }))
  const exportSettings = {
    ...settings,
    logoPath: rewriteMediaPath(settings.logoPath) ?? '',
    faviconPath: rewriteMediaPath(settings.faviconPath) ?? '',
  }
  const data = { name: project.name, settings: exportSettings, pages: exportPages }
  const customMeta = settings.customMetaTags.map((tag) => `<meta ${tag.attribute}="${escapeHtml(tag.key)}" content="${escapeHtml(tag.content)}"/>`).join('\n')
  const favicon = exportSettings.faviconPath ? `<link rel="icon" href="${escapeHtml(exportSettings.faviconPath)}"/>` : ''
  const files: Record<string, GeneratedFile> = {
    'package.json': textFile(JSON.stringify({ name: safeSlug(project.name), private: true, version: '1.0.0', type: 'module', scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview' }, dependencies: { react: '19.3.1', 'react-dom': '19.3.1', 'react-router-dom': '7.18.6' }, devDependencies: { '@vitejs/plugin-react': '6.3.0', vite: '8.3.8', typescript: '5.9.3', '@types/react': '19.2.14', '@types/react-dom': '19.2.3' } }, null, 2)),
    'index.html': textFile(`<!doctype html>\n<html lang="${escapeHtml(settings.language)}"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta name="description" content="${escapeHtml(settings.description)}"/>${favicon}${customMeta ? `\n${customMeta}` : ''}<title>${escapeHtml(settings.title || project.name)}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`),
    'tsconfig.json': textFile(JSON.stringify({ compilerOptions: { target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', skipLibCheck: true, moduleResolution: 'Bundler', resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx', strict: true }, include: ['src', 'vite.config.ts'] }, null, 2)),
    'vite.config.ts': textFile(`import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n`),
    'src/main.tsx': textFile(`import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport { BrowserRouter } from 'react-router-dom'\nimport App from './App'\nimport './styles.css'\n\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>)\n`),
    'src/site.json': textFile(JSON.stringify(data, null, 2)),
    'src/components/SiteRenderer.tsx': textFile(rendererFile()),
    'src/App.tsx': textFile(appFile()),
    'src/styles.css': textFile(`:root{font-family:${settings.fontFamily},system-ui,sans-serif;color:#202338;background:#fff;font-synthesis:none;text-rendering:optimizeLegibility;--wc-primary:${settings.primaryColor}}*{box-sizing:border-box}body{margin:0}img,video{max-width:100%;height:auto}.wc-site-brand{display:flex;align-items:center;padding:1rem 1.5rem}.wc-site-brand img{display:block;max-width:min(220px,60vw);max-height:72px;object-fit:contain}.wc-section-content{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.wc-node form{display:flex;gap:.75rem;align-items:center;justify-content:center;flex-wrap:wrap}.wc-node input{padding:.7rem;border:1px solid #d1d5db;border-radius:.5rem}@media(max-width:${settings.breakpoints.mobile}px){.wc-section-content{grid-template-columns:1fr}}\n${designSystemCss(settings.designSystem)}\n${settings.customCss}\n`),
    'README.md': textFile(`# ${safeMarkdown(project.name)}\n\nGenerated by WebCraft. This is a standalone React + Vite + TypeScript website and does not need WebCraft or its CMS to run.\n\n## Run locally\n\n\`\`\`sh\nnpm install\nnpm run dev\n\n# Production build\nnpm run build\n\n# Preview the built site\nnpm run preview\n\`\`\`\n\nEdit page data in \`src/site.json\` and rendering in \`src/components/SiteRenderer.tsx\`.\n`),
    ...assetFiles,
  }
  for (const page of exportPages) files[`src/pages/${safeSlug(page.slug)}.tsx`] = textFile(`import React from 'react'\nimport { SiteRenderer } from '../components/SiteRenderer'\nimport site from '../site.json'\nexport default function Page(){const page=site.pages.find(p=>p.slug===${q(page.slug)})!;return <main><SiteRenderer nodes={page.nodes} settings={site.settings}/></main>}\n`)
  return files
}
function safeMarkdown(value: string) { return value.replace(/[\r\n]/g, ' ').replace(/[`#]/g, '') }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)) }
function rendererFile() { return `import React from 'react'
type BaseStyle = React.CSSProperties & { gridColumns?: number }
type NodeStyle = BaseStyle & { responsive?: { tablet?: BaseStyle; mobile?: BaseStyle } }
type Node={id:string;type:string;props?:{text?:string;href?:string;src?:string;alt?:string;level?:number};style?:NodeStyle;children?:Node[]}
type Settings={logoPath?:string;title?:string;breakpoints?:{tablet:number;mobile:number}}
const tags:Record<string,string>={section:'section',container:'div',heading:'h2',paragraph:'p',text:'span',button:'a',link:'a',image:'img',video:'video',icon:'span',divider:'hr',spacer:'div',grid:'div',flex:'div',columns:'div',card:'article',navbar:'nav',footer:'footer',hero:'section',features:'section',testimonials:'section',pricing:'section',faq:'section',team:'section',statistics:'section',gallery:'section','contact-form':'section',newsletter:'section',cta:'section'}
const styleKeys=['color','backgroundColor','fontFamily','fontSize','fontWeight','fontStyle','textDecoration','textTransform','textAlign','lineHeight','letterSpacing','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','borderRadius','border','borderWidth','borderStyle','borderColor','boxShadow','gap','rowGap','columnGap','display','flexDirection','justifyContent','alignItems','flexWrap','maxWidth','minWidth','width','maxHeight','minHeight','height','overflow','opacity'] as const
function safeUrl(value?:string){if(!value)return '#';const v=value.trim();const lower=v.toLowerCase();if(lower.startsWith('javascript:')||lower.startsWith('vbscript:')||lower.startsWith('data:')||lower.startsWith('file:'))return '#';return lower.startsWith('https://')||lower.startsWith('mailto:')||lower.startsWith('tel:')||(v.startsWith('/')&&!v.startsWith('//'))||v.startsWith('#')||v.startsWith('?')||v.startsWith('./')||v.startsWith('../')?v:'#'}
function responsiveRules(nodes:Node[],breakpoints:{tablet:number;mobile:number}){const tablet:string[]=[],mobile:string[]=[];const kebab=(key:string)=>key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase());const declarations=(style?:BaseStyle)=>{if(!style)return '';const output:string[]=[];for(const [key,value] of Object.entries(style)){if(value===undefined)continue;if(key==='gridColumns'){if(typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=12)output.push('grid-template-columns:repeat('+value+',minmax(0,1fr))');continue}if(!styleKeys.includes(key as typeof styleKeys[number]))continue;const text=String(value);if(/[{};<>]|url\\s*\\(|expression\\s*\\(|javascript:|@import/i.test(text))continue;output.push(kebab(key)+':'+text)}return output.join(';')};const visit=(items:Node[])=>{for(const node of items){const id=node.id;if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))continue;const t=declarations(node.style?.responsive?.tablet),m=declarations(node.style?.responsive?.mobile);if(t)tablet.push('[data-node-id="'+id+'"]{'+t+'}');if(m)mobile.push('[data-node-id="'+id+'"]{'+m+'}');visit(node.children??[])}};visit(nodes);return (tablet.length?'@media(max-width:'+breakpoints.tablet+'px){'+tablet.join('')+'}':'')+(mobile.length?'@media(max-width:'+breakpoints.mobile+'px){'+mobile.join('')+'}':'')}
export function SiteRenderer({nodes,settings}:{nodes:Node[];settings?:Settings}){const bp=settings?.breakpoints??{tablet:900,mobile:600};const css=responsiveRules(nodes,bp);const logo=settings?.logoPath&&/^\\/assets\\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\\.(png|jpe?g|webp|gif)$/i.test(settings.logoPath)?settings.logoPath:'';return <div className="wc-site">{logo&&<header className="wc-site-brand"><img src={logo} alt={(settings?.title||'Website')+' logo'}/></header>}{css&&<style>{css}</style>}{nodes.map(node=><NodeView key={node.id} node={node}/>)}</div>}
function NodeView({node}:{node:Node}){const tag=node.type==='heading'?('h'+Math.max(1,Math.min(6,node.props?.level??2))):tags[node.type]??'div';const Tag=tag as keyof React.JSX.IntrinsicElements;const style={...node.style} as React.CSSProperties;delete (style as any).responsive;delete (style as any).gridColumns;if(node.style?.gridColumns)style.gridTemplateColumns='repeat('+node.style.gridColumns+',minmax(0,1fr))';if(node.type==='grid'||node.type==='columns')style.display=node.style?.display??'grid';if(node.type==='flex')style.display=node.style?.display??'flex';const children=(node.children??[]).map(child=><NodeView key={child.id} node={child}/>);const text=node.props?.text??'';const common={className:'wc-node wc-'+node.type+(node.type==='heading'?' wc-heading-level-'+Math.max(1,Math.min(6,node.props?.level??2)):''),style,'data-node-id':node.id};if(node.type==='image')return <img {...common} src={safeUrl(node.props?.src)} alt={node.props?.alt??''} loading="lazy"/>;if(node.type==='video')return <video {...common} src={safeUrl(node.props?.src)} controls preload="metadata"/>;if(node.type==='divider')return <hr {...common}/>;if(node.type==='spacer')return <div {...common} aria-hidden="true" style={{...style,minHeight:style.minHeight??style.height??'2rem'}}/>;if(node.type==='icon')return <span {...common} role="img" aria-label="decorative icon">{text||'✦'}</span>;if(node.type==='contact-form'||node.type==='newsletter')return <section {...common}><h2>{text}</h2><form onSubmit={e=>e.preventDefault()}><label>Email address <input type="email" placeholder="you@example.com" required/></label><button type="submit">{node.type==='newsletter'?'Subscribe':'Send message'}</button></form>{children}</section>;if(node.type==='button'||node.type==='link')return <a {...common} href={safeUrl(node.props?.href)}>{text}{children}</a>;return <Tag {...common}>{text}{children}</Tag>}
` }
function appFile() { return `import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import site from './site.json'
import { SiteRenderer } from './components/SiteRenderer'
export default function App(){const home=site.pages.find(p=>p.isHome)??site.pages[0];return <Routes>{site.pages.map(page=><Route key={page.slug} path={page.slug===home.slug?'/':'/'+page.slug} element={<main><SiteRenderer nodes={page.nodes} settings={site.settings}/></main>}/>)}<Route path="*" element={<Navigate to="/" replace/>}/></Routes>}
` }
