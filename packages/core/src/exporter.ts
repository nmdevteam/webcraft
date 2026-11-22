import type { BuilderNode } from './schema'
import { PageDataSchema, ProjectSettingsSchema, validateTree } from './schema'
import { designSystemCss } from './design-system'
import { animationCss } from './animation'
import { createPwaManifest, generatePwaServiceWorker, offlineFallbackHtml } from './pwa'

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
    socialImagePath: rewriteMediaPath(settings.socialImagePath) ?? '',
    pwa: {
      ...settings.pwa,
      icon192Path: rewriteMediaPath(settings.pwa.icon192Path) ?? '',
      icon512Path: rewriteMediaPath(settings.pwa.icon512Path) ?? '',
    },
  }
  const data = { name: project.name, settings: exportSettings, pages: exportPages }
  const customMeta = settings.customMetaTags.map((tag) => `<meta ${tag.attribute}="${escapeHtml(tag.key)}" content="${escapeHtml(tag.content)}"/>`).join('\n')
  const customMetaKeys = new Set(settings.customMetaTags.map((tag) => `${tag.attribute}:${tag.key.toLowerCase()}`))
  const standardMeta = (attribute: 'name' | 'property', key: string, value: string) => customMetaKeys.has(`${attribute}:${key}`) ? '' : `<meta ${attribute}="${key}" content="${escapeHtml(value)}"/>`
  const homeRoute = exportPages.find((page) => page.isHome)!
  const homeTitle = homeRoute.seoTitle?.trim() || settings.title || homeRoute.title || project.name
  const homeDescription = homeRoute.seoDescription?.trim() || settings.description
  const routePath = (page: ExportPage) => page.slug === homeRoute.slug ? '/' : `/${page.slug}`
  const canonicalHome = settings.siteUrl ? new URL(routePath(homeRoute), settings.siteUrl).toString() : ''
  const socialImageUrl = canonicalHome && exportSettings.socialImagePath ? new URL(exportSettings.socialImagePath, settings.siteUrl).toString() : ''
  const jsonLd = safeJsonLd(settings.structuredData)
  const sitemap = settings.siteUrl ? textFile(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${exportPages.map((page) => `  <url><loc>${escapeXml(new URL(routePath(page), settings.siteUrl).toString())}</loc></url>`).join('\n')}\n</urlset>\n`) : undefined
  const robots = textFile(`User-agent: *\nAllow: /\n${settings.siteUrl ? `Sitemap: ${new URL('/sitemap.xml', settings.siteUrl).toString()}\n` : ''}`)
  const favicon = exportSettings.faviconPath ? `<link rel="icon" href="${escapeHtml(exportSettings.faviconPath)}"/>` : ''
  const canonicalTag = canonicalHome ? `<link rel="canonical" href="${escapeHtml(canonicalHome)}"/>` : ''
  const generatedMeta = [
    standardMeta('property', 'og:type', 'website'),
    standardMeta('property', 'og:title', homeTitle),
    standardMeta('property', 'og:description', homeDescription),
    canonicalHome ? standardMeta('property', 'og:url', canonicalHome) : '',
    socialImageUrl ? standardMeta('property', 'og:image', socialImageUrl) : '',
    standardMeta('name', 'twitter:card', socialImageUrl ? 'summary_large_image' : 'summary'),
    standardMeta('name', 'twitter:title', homeTitle),
    standardMeta('name', 'twitter:description', homeDescription),
    socialImageUrl ? standardMeta('name', 'twitter:image', socialImageUrl) : '',
  ].filter(Boolean).join('\n')
  const motionCss = exportPages.map((page) => animationCss(page.nodes, settings.breakpoints, page.slug)).filter(Boolean).join('\n')
  const pwaHead = exportSettings.pwa.enabled
    ? `<link rel="manifest" href="/manifest.webmanifest"/><meta name="theme-color" content="${escapeHtml(exportSettings.pwa.themeColor)}"/>${exportSettings.pwa.icon192Path ? `<link rel="apple-touch-icon" href="${escapeHtml(exportSettings.pwa.icon192Path)}"/>` : ''}`
    : ''
  const pwaFiles = exportSettings.pwa.enabled ? {
    'public/manifest.webmanifest': textFile(JSON.stringify(createPwaManifest(exportSettings.pwa), null, 2)),
    'public/sw.js': textFile(generatePwaServiceWorker(exportSettings.pwa.cacheStrategy, exportSettings.pwa.offlineFallback)),
    ...(exportSettings.pwa.offlineFallback ? { 'public/offline.html': textFile(offlineFallbackHtml(exportSettings.pwa.name, exportSettings.pwa.themeColor)) } : {}),
  } : {}
  const pwaRegistration = exportSettings.pwa.enabled ? "import site from './site.json'\nif(site.settings.pwa?.enabled && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(()=>{})\n" : ''
  const files: Record<string, GeneratedFile> = {
    'package.json': textFile(JSON.stringify({ name: safeSlug(project.name), private: true, version: '1.0.0', type: 'module', scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview' }, dependencies: { react: '19.3.1', 'react-dom': '19.3.1', 'react-router-dom': '7.18.6' }, devDependencies: { '@vitejs/plugin-react': '6.3.0', vite: '8.3.8', typescript: '5.9.3', '@types/react': '19.2.14', '@types/react-dom': '19.2.3' } }, null, 2)),
    'index.html': textFile(`<!doctype html>\n<html lang="${escapeHtml(settings.language)}"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>${standardMeta('name', 'description', homeDescription)}${favicon}${pwaHead}${canonicalTag}${generatedMeta ? `\n${generatedMeta}` : ''}${customMeta ? `\n${customMeta}` : ''}${jsonLd ? `\n<script type="application/ld+json">${jsonLd}</script>` : ''}<title>${escapeHtml(homeTitle)}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`),
    'robots.txt': robots,
    ...(sitemap ? { 'sitemap.xml': sitemap } : {}),
    'tsconfig.json': textFile(JSON.stringify({ compilerOptions: { target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', skipLibCheck: true, moduleResolution: 'Bundler', resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx', strict: true }, include: ['src', 'vite.config.ts'] }, null, 2)),
    'vite.config.ts': textFile(`import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n`),
    'src/main.tsx': textFile(`import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport { BrowserRouter } from 'react-router-dom'\nimport App from './App'\n${pwaRegistration}import './styles.css'\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>)\n`),
    'src/site.json': textFile(JSON.stringify(data, null, 2)),
    'src/components/SiteRenderer.tsx': textFile(rendererFile()),
    'src/components/FormRuntime.tsx': textFile(formRuntimeFile()),
    'src/components/MotionRuntime.tsx': textFile(motionRuntimeFile()),
    'src/App.tsx': textFile(appFile()),
    'src/styles.css': textFile(`:root{font-family:${settings.fontFamily},system-ui,sans-serif;color:#202338;background:#fff;font-synthesis:none;text-rendering:optimizeLegibility;--wc-primary:${settings.primaryColor}}*{box-sizing:border-box}body{margin:0}img,video{max-width:100%;height:auto}.wc-site-brand{display:flex;align-items:center;padding:1rem 1.5rem}.wc-site-brand img{display:block;max-width:min(220px,60vw);max-height:72px;object-fit:contain}.wc-section-content{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.wc-node input,.wc-node textarea,.wc-node select{padding:.7rem;border:1px solid #d1d5db;border-radius:.5rem;font:inherit}.wc-form{width:min(100%,42rem);margin-inline:auto}.wc-form-fields{display:grid;gap:1rem}.wc-form-field{display:grid;gap:.35rem}.wc-form-field>span{font-weight:600}.wc-form-field input,.wc-form-field textarea,.wc-form-field select{width:100%}.wc-form-choice{display:flex;align-items:center;gap:.5rem}.wc-form-status{margin-top:.75rem}.wc-form-error{color:#a11b1b}.wc-form-success{color:#146c43}.wc-node input[type=checkbox],.wc-node input[type=radio]{width:auto}.wc-node form button{padding:.75rem 1rem;border:0;border-radius:.5rem;background:var(--wc-primary);color:white;font:inherit;cursor:pointer}.wc-motion-hidden{visibility:visible}@media(max-width:${settings.breakpoints.mobile}px){.wc-section-content{grid-template-columns:1fr}}\n${motionCss}\n${designSystemCss(settings.designSystem)}\n${settings.customCss}\n`),
    'README.md': textFile(`# ${safeMarkdown(project.name)}\n\nGenerated by WebCraft. This is a standalone React + Vite + TypeScript website and does not need WebCraft or its CMS to run.\n\n## Run locally\n\n\`\`\`sh\nnpm install\nnpm run dev\n\n# Production build\nnpm run build\n\n# Preview the built site\nnpm run preview\n\`\`\`\n\nEdit page data in \`src/site.json\` and rendering in \`src/components/SiteRenderer.tsx\`.\nForms submit only when configured with an HTTPS or same-origin endpoint; frontend-only forms validate locally and do not send responses. External submissions omit credentials and require the endpoint to permit browser CORS requests. PWA files are emitted only when enabled; service-worker caches are same-origin, entry- and response-size-bounded, and do not cache API/fetch destinations. Validate the generated site on its intended HTTPS host before relying on installation or offline behavior.\n`),
    ...assetFiles,
    ...pwaFiles,
  }
  for (const page of exportPages) files[`src/pages/${safeSlug(page.slug)}.tsx`] = textFile(`import React from 'react'\nimport { SiteRenderer } from '../components/SiteRenderer'\nimport site from '../site.json'\nexport default function Page(){const page=site.pages.find(p=>p.slug===${q(page.slug)})!;return <main><SiteRenderer nodes={page.nodes} settings={site.settings} pageSlug={page.slug} allowExitAnimation/></main>}\n`)
  return files
}
function safeMarkdown(value: string) { return value.replace(/[\r\n]/g, ' ').replace(/[`#]/g, '') }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)) }
function escapeXml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!)) }
function safeJsonLd(value: string) {
  if (!value.trim()) return ''
  return JSON.stringify(JSON.parse(value)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}
function rendererFile() { return `import React from 'react'
import { GeneratedForm } from './FormRuntime'
import { useMotionRuntime } from './MotionRuntime'
type BaseStyle = React.CSSProperties & { gridColumns?: number }
type NodeStyle = BaseStyle & { responsive?: { tablet?: BaseStyle; mobile?: BaseStyle } }
type Animation = { enabled?: boolean; trigger?: string; once?: boolean; durationMs?: number; delayMs?: number }
type Node={id:string;type:string;props?:{text?:string;href?:string;src?:string;alt?:string;level?:number;formConfig?:unknown};style?:NodeStyle;animation?:Animation;children?:Node[]}
type Settings={logoPath?:string;title?:string;breakpoints?:{tablet:number;mobile:number}}
const tags:Record<string,string>={section:'section',container:'div',heading:'h2',paragraph:'p',text:'span',button:'a',link:'a',image:'img',video:'video',icon:'span',divider:'hr',spacer:'div',grid:'div',flex:'div',columns:'div',card:'article',navbar:'nav',footer:'footer',hero:'section',features:'section',testimonials:'section',pricing:'section',faq:'section',team:'section',statistics:'section',gallery:'section',form:'section','contact-form':'section',newsletter:'section',cta:'section'}
const styleKeys=['color','backgroundColor','fontFamily','fontSize','fontWeight','fontStyle','textDecoration','textTransform','textAlign','lineHeight','letterSpacing','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','borderRadius','border','borderWidth','borderStyle','borderColor','boxShadow','gap','rowGap','columnGap','display','flexDirection','justifyContent','alignItems','flexWrap','maxWidth','minWidth','width','maxHeight','minHeight','height','overflow','opacity'] as const
function safeUrl(value?:string){if(!value)return '#';const v=value.trim();const lower=v.toLowerCase();if(lower.startsWith('javascript:')||lower.startsWith('vbscript:')||lower.startsWith('data:')||lower.startsWith('file:'))return '#';return lower.startsWith('https://')||lower.startsWith('mailto:')||lower.startsWith('tel:')||(v.startsWith('/')&&!v.startsWith('//'))||v.startsWith('#')||v.startsWith('?')||v.startsWith('./')||v.startsWith('../')?v:'#'}
function responsiveRules(nodes:Node[],breakpoints:{tablet:number;mobile:number}){const tablet:string[]=[],mobile:string[]=[];const kebab=(key:string)=>key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase());const declarations=(style?:BaseStyle)=>{if(!style)return '';const output:string[]=[];for(const [key,value] of Object.entries(style)){if(value===undefined)continue;if(key==='gridColumns'){if(typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=12)output.push('grid-template-columns:repeat('+value+',minmax(0,1fr))');continue}if(!styleKeys.includes(key as typeof styleKeys[number]))continue;const text=String(value);if(/[{};<>]|url\\s*\\(|expression\\s*\\(|javascript:|@import/i.test(text))continue;output.push(kebab(key)+':'+text)}return output.join(';')};const visit=(items:Node[])=>{for(const node of items){const id=node.id;if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))continue;const t=declarations(node.style?.responsive?.tablet),m=declarations(node.style?.responsive?.mobile);if(t)tablet.push('[data-node-id="'+id+'"]{'+t+'}');if(m)mobile.push('[data-node-id="'+id+'"]{'+m+'}');visit(node.children??[])}};visit(nodes);return (tablet.length?'@media(max-width:'+breakpoints.tablet+'px){'+tablet.join('')+'}':'')+(mobile.length?'@media(max-width:'+breakpoints.mobile+'px){'+mobile.join('')+'}':'')}
export function SiteRenderer({nodes,settings,pageSlug,editorMode=false,allowExitAnimation=true}:{nodes:Node[];settings?:Settings;pageSlug:string;editorMode?:boolean;allowExitAnimation?:boolean}){const root=React.useRef<HTMLDivElement>(null);const bp=settings?.breakpoints??{tablet:900,mobile:600};const css=responsiveRules(nodes,bp);const logo=settings?.logoPath&&/^\\/assets\\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\\.(png|jpe?g|webp|gif)$/i.test(settings.logoPath)?settings.logoPath:'';useMotionRuntime(root,{editorMode,allowExitAnimation});return <div ref={root} className={'wc-site'+(editorMode?' is-edit-mode':'')} data-page-slug={pageSlug} data-allow-exit-animation={allowExitAnimation?'true':'false'}>{logo&&<header className="wc-site-brand"><img src={logo} alt={(settings?.title||'Website')+' logo'}/></header>}{css&&<style>{css}</style>}{nodes.map(node=><NodeView key={node.id} node={node}/>)}</div>}
function NodeView({node}:{node:Node}){const tag=node.type==='heading'?('h'+Math.max(1,Math.min(6,node.props?.level??2))):tags[node.type]??'div';const Tag=tag as keyof React.JSX.IntrinsicElements;const style={...node.style} as React.CSSProperties;delete (style as any).responsive;delete (style as any).gridColumns;if(node.style?.gridColumns)style.gridTemplateColumns='repeat('+node.style.gridColumns+',minmax(0,1fr))';if(node.type==='grid'||node.type==='columns')style.display=node.style?.display??'grid';if(node.type==='flex')style.display=node.style?.display??'flex';const children=(node.children??[]).map(child=><NodeView key={child.id} node={child}/>);const text=node.props?.text??'';const motion=node.animation?.enabled?node.animation.trigger:undefined;const common={className:'wc-node wc-'+node.type+(node.type==='heading'?' wc-heading-level-'+Math.max(1,Math.min(6,node.props?.level??2)):''),style,'data-node-id':node.id,'data-wc-motion':motion,'data-wc-motion-once':node.animation?.once?'true':'false','data-wc-exit-duration':node.animation?.durationMs??0,'data-wc-exit-delay':node.animation?.delayMs??0};if(node.type==='image')return <img {...common} src={safeUrl(node.props?.src)} alt={node.props?.alt??''} loading="lazy"/>;if(node.type==='video')return <video {...common} src={safeUrl(node.props?.src)} controls preload="metadata"/>;if(node.type==='divider')return <hr {...common}/>;if(node.type==='spacer')return <div {...common} aria-hidden="true" style={{...style,minHeight:style.minHeight??style.height??'2rem'}}/>;if(node.type==='icon')return <span {...common} role="img" aria-label="decorative icon">{text||'✦'}</span>;if(node.type==='form'||node.type==='contact-form'||node.type==='newsletter')return <section {...common}><GeneratedForm title={text||(node.type==='newsletter'?'Newsletter':'Contact us')} config={node.props?.formConfig}/>{children}</section>;if(node.type==='button'||node.type==='link')return <a {...common} href={safeUrl(node.props?.href)}>{text}{children}</a>;return <Tag {...common}>{text}{children}</Tag>}
` }
function formRuntimeFile() { return `import React from 'react'
type Option={value:string;label:string}
type Field={id:string;type:string;name:string;label:string;description?:string;placeholder?:string;required?:boolean;options?:Option[];minLength?:number;maxLength?:number;min?:number|string;max?:number|string;step?:number;pattern?:string;accept?:string;multiple?:boolean;maxFileSizeBytes?:number;defaultValue?:string}
type Config={submissionMode:'frontend-only'|'external';endpointUrl?:string;successMessage:string;errorMessage:string;fields:Field[]}
const fallbackFields:Field[]=[{id:'name',type:'text',name:'name',label:'Your name',required:true},{id:'email',type:'email',name:'email',label:'Email address',placeholder:'you@example.com',required:true},{id:'message',type:'textarea',name:'message',label:'Message',required:true,maxLength:2000},{id:'submit',type:'submit',name:'submit',label:'Send message'}]
function normalize(value:unknown,title:string):Config{const candidate=value as Partial<Config>|null;if(candidate&&Array.isArray(candidate.fields)&&candidate.fields.length&&candidate.fields.some(field=>field.type==='submit'))return candidate as Config;return {submissionMode:'frontend-only',successMessage:'Your form is ready.',errorMessage:'We could not submit your response. Please try again.',fields:fallbackFields.map(field=>field.id==='submit'?{...field,label:title==='Newsletter'?'Subscribe':'Send message'}:field)}}
function safeEndpoint(value?:string){if(!value||value.length>500||value.includes('\\\\')||/[\\r\\n]/.test(value))return '';const trimmed=value.trim();if(trimmed.startsWith('/')&&!trimmed.startsWith('//')&&!/[?#]/.test(trimmed))return trimmed;try{const url=new URL(trimmed);if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.search||url.hash)return '';return url.toString()}catch{return ''}}
export function GeneratedForm({title,config}:{title:string;config?:unknown}){const active=normalize(config,title);const [message,setMessage]=React.useState('');const [failed,setFailed]=React.useState(false);const [busy,setBusy]=React.useState(false);const form=React.useRef<HTMLFormElement>(null);async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;setMessage('');setFailed(false);const element=form.current;if(!element)return;const data=new FormData(element);for(const field of active.fields){if(field.type==='checkbox'&&field.required&&data.getAll(field.name).length===0){setFailed(true);setMessage('Choose at least one option for '+field.label+'.');element.querySelector<HTMLElement>('[name="'+CSS.escape(field.name)+'"]')?.focus();return}if(field.type==='file'&&field.maxFileSizeBytes){const files=data.getAll(field.name).filter((item):item is File=>item instanceof File&&item.size>0);if(files.some(file=>file.size>field.maxFileSizeBytes!)){setFailed(true);setMessage('A selected file is too large for '+field.label+'.');return}}}if(active.submissionMode==='frontend-only'){setMessage('No response was sent. Configure an HTTPS or same-origin endpoint to receive submissions.');return}const endpoint=safeEndpoint(active.endpointUrl);if(!endpoint){setFailed(true);setMessage('This form has no safe submission endpoint configured.');return}setBusy(true);try{const response=await fetch(endpoint,{method:'POST',body:data,credentials:'omit',mode:'cors',redirect:'error',headers:{Accept:'application/json'}});if(!response.ok)throw new Error('Request failed');element.reset();setMessage(active.successMessage||'Your response was submitted.')}catch{setFailed(true);setMessage(active.errorMessage||'We could not submit your response. Please try again.')}finally{setBusy(false)}}function fieldView(field:Field){if(field.type==='submit')return <button key={field.id} type="submit" disabled={busy}>{field.label}</button>;const description=field.description?<small id={field.id+'-description'}>{field.description}</small>:null;const required=!!field.required;if(field.type==='select')return <label className="wc-form-field" key={field.id}><span>{field.label}{required?' *':''}</span><select name={field.name} required={required} defaultValue={field.defaultValue??''} aria-describedby={field.description?field.id+'-description':undefined}><option value="" disabled>Select an option</option>{(field.options??[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>{description}</label>;if(field.type==='radio'||field.type==='checkbox')return <fieldset className="wc-form-field" key={field.id}><legend>{field.label}{required?' *':''}</legend>{(field.options??[]).map(option=><label className="wc-form-choice" key={option.value}><input type={field.type} name={field.name} value={option.value} required={field.type==='radio'&&required} defaultChecked={field.defaultValue===option.value}/>{option.label}</label>)}{description}</fieldset>;const common={name:field.name,required,minLength:field.minLength,maxLength:field.maxLength,min:field.min,max:field.max,step:field.step,pattern:field.pattern,placeholder:field.placeholder,defaultValue:field.type==='file'?undefined:field.defaultValue,accept:field.accept,multiple:field.multiple,'aria-describedby':field.description?field.id+'-description':undefined};let control:React.ReactNode;if(field.type==='textarea')control=<textarea {...common} rows={4}/>;else control=<input {...common} type={['text','email','password','number','date','file'].includes(field.type)?field.type:'text'}/>;return <label className="wc-form-field" key={field.id}><span>{field.label}{required?' *':''}</span>{control}{description}</label>}return <form ref={form} className="wc-form" onSubmit={submit} noValidate={false}><h2>{title}</h2><div className="wc-form-fields">{active.fields.map(fieldView)}</div><p className={'wc-form-status '+(failed?'wc-form-error':'wc-form-success')} aria-live={failed?'assertive':'polite'} role={failed?'alert':'status'}>{message}</p></form>}
` }

function motionRuntimeFile() { return `import React from 'react'
type MotionOptions={editorMode:boolean;allowExitAnimation:boolean}
export function useMotionRuntime(root:React.RefObject<HTMLDivElement|null>,options:MotionOptions){React.useEffect(()=>{const element=root.current;if(!element)return;const targets=Array.from(element.querySelectorAll<HTMLElement>('[data-wc-motion="scroll"]'));let observer:IntersectionObserver|undefined;let exiting=false;const media=window.matchMedia('(prefers-reduced-motion: reduce)');const setup=()=>{observer?.disconnect();observer=undefined;if(options.editorMode||media.matches){for(const item of targets)item.classList.add('wc-motion-visible');return}for(const item of targets)item.classList.remove('wc-motion-visible');if(!('IntersectionObserver'in window)){for(const item of targets)item.classList.add('wc-motion-visible');return}observer=new IntersectionObserver(entries=>{for(const entry of entries){const item=entry.target as HTMLElement;if(entry.isIntersecting){item.classList.add('wc-motion-visible');if(item.dataset.wcMotionOnce!=='false')observer?.unobserve(item)}else if(item.dataset.wcMotionOnce==='false')item.classList.remove('wc-motion-visible')}},{threshold:.15});for(const item of targets)observer.observe(item)};const onClick=(event:MouseEvent)=>{if(!options.allowExitAnimation||options.editorMode||media.matches||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const target=event.target instanceof Element?event.target:null;const link=target?.closest('a');if(!link||link.hasAttribute('download')||link.target&&link.target!=='_self')return;const exits=Array.from(element.querySelectorAll<HTMLElement>('[data-wc-motion="exit"]'));if(!exits.length)return;let destination:URL;try{destination=new URL(link.href,window.location.href)}catch{return}if(destination.origin!==window.location.origin)return;event.preventDefault();if(exiting)return;exiting=true;let wait=0;for(const item of exits){item.classList.add('wc-motion-exiting');const duration=Number(item.dataset.wcExitDuration)||0;const delay=Number(item.dataset.wcExitDelay)||0;wait=Math.max(wait,duration+delay)}window.setTimeout(()=>window.location.assign(destination.href),wait)};element.addEventListener('click',onClick,true);setup();media.addEventListener('change',setup);return()=>{element.removeEventListener('click',onClick,true);media.removeEventListener('change',setup);observer?.disconnect()}},[root,options.editorMode,options.allowExitAnimation])}
` }
function appFile() { return `import React from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import site from './site.json'
import { SiteRenderer } from './components/SiteRenderer'
type PageMetadata = (typeof site.pages)[number] & { seoTitle?: string; seoDescription?: string }
const pages = site.pages as PageMetadata[]
function setMeta(attribute:'name'|'property',key:string,value:string){if((site.settings.customMetaTags??[]).some(tag=>tag.attribute===attribute&&tag.key.toLowerCase()===key))return;let meta=document.head.querySelector<HTMLMetaElement>('meta['+attribute+'="'+key+'"]');if(!value){meta?.remove();return}if(!meta){meta=document.createElement('meta');meta.setAttribute(attribute,key);document.head.append(meta)}meta.content=value}
function setCanonical(value:string){let link=document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');if(!value){link?.remove();return}if(!link){link=document.createElement('link');link.rel='canonical';document.head.append(link)}link.href=value}
function HeadMetadata(){const pathname=useLocation().pathname;const normalizedPathname=pathname.length>1?pathname.replace(/\\/+$/,''):pathname;const home=pages.find(p=>p.isHome)??pages[0];const page=pages.find(p=>(p.slug===home.slug?'/':'/'+p.slug)===normalizedPathname)??home;React.useEffect(()=>{const title=page.seoTitle?.trim()||(page.isHome?site.settings.title:page.title)||site.name;const description=page.seoDescription?.trim()||site.settings.description||'';const canonical=site.settings.siteUrl?new URL(page.slug===home.slug?'/':'/'+page.slug,site.settings.siteUrl).toString():'';const image=site.settings.socialImagePath&&site.settings.siteUrl?new URL(site.settings.socialImagePath,site.settings.siteUrl).toString():'';document.title=title;setCanonical(canonical);setMeta('name','description',description);setMeta('property','og:title',title);setMeta('property','og:description',description);setMeta('property','og:url',canonical);setMeta('property','og:image',image);setMeta('name','twitter:card',image?'summary_large_image':'summary');setMeta('name','twitter:title',title);setMeta('name','twitter:description',description);setMeta('name','twitter:image',image)},[pathname,page.slug]);return null}
export default function App(){const home=pages.find(p=>p.isHome)??pages[0];return <><HeadMetadata/><Routes>{pages.map(page=><Route key={page.slug} path={page.slug===home.slug?'/':'/'+page.slug} element={<main><SiteRenderer nodes={page.nodes} settings={site.settings} pageSlug={page.slug} allowExitAnimation/></main>}/>)}<Route path="*" element={<Navigate to="/" replace/>}/></Routes></>}
` }

// Route-specific metadata is updated after the generated React app hydrates.
// Source analysis reports static file measurements, not browser performance scores.
// Configure the verified public origin before generating canonical URLs and sitemaps.
