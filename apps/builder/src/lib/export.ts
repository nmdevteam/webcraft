import JSZip from 'jszip'
import { generateSource, type ExportProject } from '@webcraft/core/exporter'
import { api } from '../api'

type PageRecord = { id: string; title: string; slug: string; isHome: boolean; seoTitle?: string; seoDescription?: string; nodes: any[] }
type ProjectRecord = { id: string; name: string; settings: unknown }
type AssetRecord = { filename: string; url?: string }
function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
export async function downloadProjectZip(project: ProjectRecord, validate = true) {
  if (validate) await api('/webcraft/export/validate', { method: 'POST', body: JSON.stringify({ projectId: project.id }) })
  const [pageResult, assetResult] = await Promise.all([
    api<{ docs: PageRecord[] }>(`/pages?where[project][equals]=${encodeURIComponent(project.id)}&limit=100&depth=0&sort=slug`),
    api<{ docs: AssetRecord[] }>(`/assets?where[project][equals]=${encodeURIComponent(project.id)}&limit=100&depth=0`),
  ])
  const assets = await Promise.all(assetResult.docs.map(async (asset) => {
    const response = await fetch(`/media/${encodeURIComponent(asset.filename)}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Could not read uploaded asset ${asset.filename}.`)
    return { filename: asset.filename, contentBase64: toBase64(await response.arrayBuffer()) }
  }))
  const source = generateSource({ name: project.name, settings: project.settings, pages: pageResult.docs.map(({ title, slug, isHome, seoTitle, seoDescription, nodes }) => ({ title, slug, isHome, seoTitle, seoDescription, nodes })) } satisfies ExportProject, assets)
  const zip = new JSZip()
  for (const [path, file] of Object.entries(source)) zip.file(path, file.content, file.encoding === 'base64' ? { base64: true } : undefined)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'website'}-source.zip`
  document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(href)
  return source
}
