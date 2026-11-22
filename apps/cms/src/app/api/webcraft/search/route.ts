import { NextResponse } from 'next/server'
import { COMPONENT_TYPES } from '@webcraft/core/schema'
import { TEMPLATES } from '@webcraft/core/templates'
import { authenticateProjectHistoryRequest } from '../../../../lib/project-history-route'

export const dynamic = 'force-dynamic'
const MAX_DOCS = 100
const MAX_RESULTS = 60
const MAX_NODE_VISITS = 2_000
const validId = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : value && typeof value === 'object' && 'id' in value ? String((value as { id: string | number }).id) : ''
const matches = (text: unknown, term: string) => typeof text === 'string' && text.toLocaleLowerCase().includes(term)
type SearchItem = { type: string; label: string; description: string; target: string }

type NodeBudget = { remaining: number; truncated: boolean }
function walkNodes(nodes: unknown, term: string, projectId: string, pageId: string, pageTitle: string, results: SearchItem[], budget: NodeBudget, depth = 0) {
  if (!Array.isArray(nodes)) return
  if (depth > 12) { if (nodes.length) budget.truncated = true; return }
  for (const value of nodes) {
    if (budget.remaining <= 0 || results.length >= MAX_RESULTS) { budget.truncated = true; return }
    budget.remaining -= 1
    if (!value || typeof value !== 'object') continue
    const node = value as { id?: unknown; type?: unknown; props?: { text?: unknown; label?: unknown }; children?: unknown }
    const nodeId = typeof node.id === 'string' ? node.id : ''
    const nodeType = typeof node.type === 'string' ? node.type : ''
    const text = typeof node.props?.text === 'string' ? node.props.text : typeof node.props?.label === 'string' ? node.props.label : ''
    if (nodeId && (matches(text, term) || matches(nodeType.replaceAll('-', ' '), term))) {
      const type = nodeType === 'section' ? 'section' : 'component'
      results.push({ type, label: text.trim().slice(0, 100) || `${nodeType} component`, description: `${pageTitle} · ${nodeType.replaceAll('-', ' ')}`, target: `/editor/${encodeURIComponent(projectId)}?page=${encodeURIComponent(pageId)}&node=${encodeURIComponent(nodeId)}` })
    }
    walkNodes(node.children, term, projectId, pageId, pageTitle, results, budget, depth + 1)
  }
}

export async function GET(request: Request) {
  const auth = await authenticateProjectHistoryRequest(request)
  if ('response' in auth) return auth.response
  const url = new URL(request.url)
  const raw = url.searchParams.get('q') ?? ''
  const requestedProjectId = url.searchParams.get('projectId')?.trim() ?? ''
  if (raw.length > 80) return NextResponse.json({ error: 'Search text is too long.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  if (requestedProjectId.length > 200) return NextResponse.json({ error: 'Project id is too long.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  const query = raw.trim().toLocaleLowerCase()
  if (query.length < 2) return NextResponse.json({ results: [], bounded: false }, { headers: { 'Cache-Control': 'no-store' } })

  try {
    const user = auth.user
    const payload = auth.payload
    const [projectDocs, pageDocs, assetDocs, installedDocs, packageDocs] = await Promise.all([
      payload.find({ collection: 'projects', where: { owner: { equals: user.id } }, limit: MAX_DOCS, depth: 0, sort: '-updatedAt', select: { name: true, category: true, templateId: true, settings: true }, user, overrideAccess: false }),
      payload.find({ collection: 'pages', where: { owner: { equals: user.id } }, limit: MAX_DOCS, depth: 0, sort: '-updatedAt', select: { title: true, slug: true, seoTitle: true, seoDescription: true, project: true, nodes: true }, user, overrideAccess: false }),
      payload.find({ collection: 'assets', where: { owner: { equals: user.id } }, limit: MAX_DOCS, depth: 0, sort: '-createdAt', select: { name: true, filename: true, alt: true, project: true }, user, overrideAccess: false }),
      payload.find({ collection: 'installed-components', where: { owner: { equals: user.id } }, limit: MAX_DOCS, depth: 0, sort: '-updatedAt', select: { name: true, project: true }, user, overrideAccess: false }),
      payload.find({ collection: 'marketplace-packages', where: { or: [{ owner: { equals: user.id } }, { published: { equals: true } }] }, limit: MAX_DOCS, depth: 0, sort: '-updatedAt', select: { name: true, type: true, category: true, description: true }, user, overrideAccess: false }),
    ])
    const projects = projectDocs.docs as Array<{ id: string | number; name: string; category?: string; templateId?: string; settings?: Record<string, unknown> }>
    const projectById = new Map(projects.map((project) => [String(project.id), project]))
    const matchingBuiltIns = COMPONENT_TYPES.filter((type) => matches(type.replaceAll('-', ' '), query))
    let addTargetProject = requestedProjectId ? projectById.get(requestedProjectId) : undefined
    if (requestedProjectId && matchingBuiltIns.length && !addTargetProject) {
      const activeProjectDocs = await payload.find({
        collection: 'projects',
        where: { and: [{ owner: { equals: user.id } }, { id: { equals: requestedProjectId } }] },
        limit: 1,
        depth: 0,
        select: { name: true },
        user,
        overrideAccess: false,
      })
      const candidate = (activeProjectDocs.docs as Array<{ id: string | number; name: string }>)[0]
      if (candidate && String(candidate.id) === requestedProjectId) addTargetProject = candidate
    }
    const results: SearchItem[] = []
    let resultsTruncated = false
    const nodeBudget: NodeBudget = { remaining: MAX_NODE_VISITS, truncated: false }
    const add = (item: SearchItem) => { if (results.length < MAX_RESULTS) results.push(item); else resultsTruncated = true }

    for (const project of projects) {
      if (matches(project.name, query) || matches(project.category, query) || matches(project.templateId, query)) add({ type: 'project', label: String(project.name).slice(0, 100), description: `${String(project.category ?? 'Website')} project`, target: `/editor/${encodeURIComponent(String(project.id))}` })
      const settings = project.settings ?? {}
      const pwa = settings.pwa && typeof settings.pwa === 'object' ? settings.pwa as Record<string, unknown> : {}
      const searchableSettings = [
        { keywords: 'website settings seo metadata origin theme color breakpoint language favicon logo design system palette typography', label: 'Website settings', description: 'SEO, branding, layout and design-system settings' },
        ...(pwa.enabled ? [{ keywords: 'pwa progressive web app offline install manifest service worker', label: 'PWA settings', description: 'Progressive web app configuration and export files' }] : []),
      ]
      for (const item of searchableSettings) if (matches(item.keywords, query)) add({ type: 'setting', label: `${item.label} · ${String(project.name).slice(0, 72)}`, description: item.description, target: `/editor/${encodeURIComponent(String(project.id))}?settings=1` })
    }

    for (const page of pageDocs.docs as Array<{ id: string | number; title: string; slug: string; seoTitle?: string; seoDescription?: string; project?: unknown; nodes?: unknown[] }>) {
      const projectId = validId(page.project)
      if (!projectById.has(projectId)) continue
      const project = projectById.get(projectId)!
      const pageTarget = `/editor/${encodeURIComponent(projectId)}?page=${encodeURIComponent(String(page.id))}`
      if ([page.title, page.slug, page.seoTitle, page.seoDescription].some((value) => matches(value, query))) add({ type: 'page', label: String(page.title).slice(0, 100), description: `${String(project.name).slice(0, 60)} · /${page.slug}`, target: pageTarget })
      walkNodes(page.nodes, query, projectId, String(page.id), String(page.title), results, nodeBudget)
    }

    for (const asset of assetDocs.docs as Array<{ id: string | number; name?: string; filename?: string; alt?: string; project?: unknown }>) {
      const projectId = validId(asset.project)
      const project = projectById.get(projectId)
      if (!project || ![asset.name, asset.filename, asset.alt].some((value) => matches(value, query))) continue
      add({ type: 'asset', label: String(asset.name || asset.filename || 'Project image').slice(0, 100), description: `${String(project.name).slice(0, 60)} · image asset`, target: `/editor/${encodeURIComponent(projectId)}?tab=assets&assetSearch=${encodeURIComponent(query)}` })
    }
    for (const item of installedDocs.docs as Array<{ name?: string; project?: unknown }>) {
      const projectId = validId(item.project)
      const project = projectById.get(projectId)
      if (project && matches(item.name, query)) add({ type: 'component', label: String(item.name).slice(0, 100), description: `${String(project.name).slice(0, 60)} · installed component package`, target: `/editor/${encodeURIComponent(projectId)}?tab=components` })
    }
    for (const item of packageDocs.docs as Array<{ id: string | number; name?: string; type?: string; category?: string; description?: string }>) {
      if (![item.name, item.category, item.description].some((value) => matches(value, query))) continue
      add({ type: item.type === 'template' ? 'template' : 'component', label: String(item.name ?? 'Marketplace package').slice(0, 100), description: `${String(item.type ?? 'component')} package · ${String(item.category ?? 'General')}`.slice(0, 120), target: `/marketplace?search=${encodeURIComponent(String(item.name ?? query))}` })
    }
    for (const template of TEMPLATES) if ([template.name, template.category, template.description].some((value) => matches(value, query))) add({ type: 'template', label: template.name, description: `${template.category} · built-in template`, target: `/?template=${encodeURIComponent(template.id)}` })
    for (const type of matchingBuiltIns) if (addTargetProject) add({ type: type === 'section' ? 'section' : 'component', label: type.replaceAll('-', ' '), description: 'Insert this built-in element into your current project page', target: `/editor/${encodeURIComponent(String(addTargetProject.id))}?add=${encodeURIComponent(type)}` })
    if (matches('GitHub integration repository push', query)) add({ type: 'integration', label: 'GitHub integration', description: 'Connect repositories and manage publishing settings', target: '/settings' })

    const bounded = [projectDocs, pageDocs, assetDocs, installedDocs, packageDocs].some((result) => Number(result.totalDocs ?? result.docs.length) > MAX_DOCS)
      || nodeBudget.truncated || resultsTruncated || results.length >= MAX_RESULTS
    return NextResponse.json({ results: results.slice(0, MAX_RESULTS), bounded }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Could not search this workspace.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
