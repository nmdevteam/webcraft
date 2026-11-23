import JSZip from 'jszip'
import { generateSource, type ExportProject, type GeneratedFile } from '@webcraft/core/exporter'
import { api, apiFetch } from '../api'
import { createFreshDirectory, type DirectoryHandle, type FileSystemWindow } from './folder-export'

type PageRecord = { id: string; title: string; slug: string; isHome: boolean; seoTitle?: string; seoDescription?: string; nodes: any[] }
type ProjectRecord = { id: string; name: string; settings: unknown }
type AssetRecord = { filename: string; url?: string }

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function buildProjectSource(project: ProjectRecord, validate = true): Promise<Record<string, GeneratedFile>> {
  if (validate) await api('/webcraft/export/validate', { method: 'POST', body: JSON.stringify({ projectId: project.id }) })
  const [pageResult, assetResult] = await Promise.all([
    api<{ docs: PageRecord[]; totalDocs?: number }>(`/pages?where[project][equals]=${encodeURIComponent(project.id)}&limit=100&depth=0&sort=slug`),
    api<{ docs: AssetRecord[]; totalDocs?: number }>(`/assets?where[project][equals]=${encodeURIComponent(project.id)}&limit=100&depth=0`),
  ])
  if (Number(pageResult.totalDocs ?? pageResult.docs.length) > 100) throw new Error('Exports support at most 100 pages per project.')
  if (Number(assetResult.totalDocs ?? assetResult.docs.length) > 100) throw new Error('Exports support at most 100 assets per project.')
  const assets: { filename: string; contentBase64: string }[] = []
  let totalAssetBytes = 0
  for (const asset of assetResult.docs) {
    const response = await apiFetch(`/assets/file/${encodeURIComponent(asset.filename)}`)
    if (!response.ok) throw new Error(`Could not read uploaded asset ${asset.filename}.`)
    const image = await response.arrayBuffer()
    if (image.byteLength > 5 * 1024 * 1024) throw new Error(`Uploaded image ${asset.filename} exceeds the 5 MB limit.`)
    totalAssetBytes += image.byteLength
    if (totalAssetBytes > 5 * 1024 * 1024) throw new Error('Uploaded images exceed the 5 MB combined export limit.')
    assets.push({ filename: asset.filename, contentBase64: toBase64(image) })
  }
  return generateSource({ name: project.name, settings: project.settings, pages: pageResult.docs.map(({ title, slug, isHome, seoTitle, seoDescription, nodes }) => ({ title, slug, isHome, seoTitle, seoDescription, nodes })) } satisfies ExportProject, assets)
}

export async function downloadProjectZip(project: ProjectRecord, validate = true) {
  const source = await buildProjectSource(project, validate)
  const zip = new JSZip()
  for (const [path, file] of Object.entries(source)) zip.file(path, file.content, file.encoding === 'base64' ? { base64: true } : undefined)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'website'}-source.zip`
  document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(href), 60_000)
  return source
}

function validateOutputPaths(source: Record<string, GeneratedFile>) {
  const paths = Object.keys(source)
  const normalized = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    if (path.length > 240 || path.startsWith('/') || path.includes('\\') || parts.some((part) => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      throw new Error('The generated site contains an unsafe local file path.')
    }
    const key = path.toLocaleLowerCase()
    if (normalized.has(key)) throw new Error('The generated site contains duplicate file paths.')
    normalized.add(key)
  }
  for (const path of paths) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      if (normalized.has(parts.slice(0, index).join('/').toLocaleLowerCase())) throw new Error('The generated site contains a file/folder path conflict.')
    }
  }
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function exportProjectToFolder(project: ProjectRecord) {
  const picker = (window as FileSystemWindow).showDirectoryPicker
  if (!picker) throw new Error('Direct folder export is not supported by this browser. Use Download ZIP instead.')
  let parent: DirectoryHandle
  try { parent = await picker.call(window, { mode: 'readwrite' }) }
  catch (error) { if ((error as { name?: string })?.name === 'AbortError') throw new Error('Folder export was cancelled.'); throw error }
  const source = await buildProjectSource(project)
  validateOutputPaths(source)
  const baseName = project.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'webcraft-site'
  const created = await createFreshDirectory(parent, baseName)
  try {
    for (const [path, file] of Object.entries(source)) {
      const parts = path.split('/')
      let directory = created.handle
      for (const segment of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(segment, { create: true })
      const fileHandle = await directory.getFileHandle(parts.at(-1)!, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(file.encoding === 'base64' ? base64ToBytes(file.content) : file.content)
      await writable.close()
    }
    return created.name
  } catch (error) {
    try { await (parent as DirectoryHandle & { removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void> }).removeEntry?.(created.name, { recursive: true }) } catch { /* Best-effort cleanup of the fresh, incomplete export only. */ }
    throw error
  }
}
