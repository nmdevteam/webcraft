import { createHash } from 'node:crypto'
import { ProjectVersionSnapshotSchema, type ProjectVersionSnapshot, type VersionReason } from '@webcraft/core/schema'

const MAX_PROJECT_PAGES = 100
type TransactionID = number | string

function transactionOptions(transactionID?: TransactionID) {
  return transactionID === undefined ? {} : { req: { transactionID } }
}

export function hashProjectSnapshot(snapshot: ProjectVersionSnapshot): string {
  const validated = ProjectVersionSnapshotSchema.parse(snapshot)
  return createHash('sha256').update(JSON.stringify(validated), 'utf8').digest('hex')
}

function relationshipId(value: unknown): string {
  if (value && typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id)
  return String(value ?? '')
}

export async function readCurrentProjectSnapshot(payload: any, projectId: string, user: any, transactionID?: TransactionID): Promise<ProjectVersionSnapshot> {
  const project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false, ...transactionOptions(transactionID) })
  const result = await payload.find({
    collection: 'pages',
    where: { project: { equals: projectId } },
    limit: MAX_PROJECT_PAGES + 1,
    depth: 0,
    sort: 'slug',
    user,
    overrideAccess: false,
    ...transactionOptions(transactionID),
  })
  if (Number(result.totalDocs ?? result.docs.length) > MAX_PROJECT_PAGES || result.docs.length > MAX_PROJECT_PAGES) {
    throw new Error(`Version history supports up to ${MAX_PROJECT_PAGES} pages per project.`)
  }
  return ProjectVersionSnapshotSchema.parse({
    project: {
      name: project.name,
      category: project.category,
      templateId: project.templateId,
      settings: project.settings ?? {},
    },
    pages: result.docs.map((page: any) => ({
      sourceId: String(page.id),
      title: page.title,
      slug: page.slug,
      isHome: Boolean(page.isHome),
      ...(page.seoTitle ? { seoTitle: page.seoTitle } : {}),
      ...(page.seoDescription ? { seoDescription: page.seoDescription } : {}),
      nodes: page.nodes ?? [],
    })),
  })
}

async function findVersionByHash(payload: any, projectId: string, hash: string, user: any, transactionID?: TransactionID) {
  const found = await payload.find({
    collection: 'project-versions',
    where: { and: [{ project: { equals: projectId } }, { contentHash: { equals: hash } }] },
    limit: 1,
    depth: 0,
    sort: '-createdAt',
    user,
    overrideAccess: false,
    ...transactionOptions(transactionID),
  })
  return found.docs[0]
}

export async function createProjectVersion(
  payload: any,
  projectId: string,
  user: any,
  reason: VersionReason,
  label?: string,
  transactionID?: TransactionID,
): Promise<{ version: any; created: boolean; skipped?: 'disabled' | 'interval' | 'duplicate' }> {
  const snapshot = await readCurrentProjectSnapshot(payload, projectId, user, transactionID)
  const contentHash = hashProjectSnapshot(snapshot)
  const previous = await findVersionByHash(payload, projectId, contentHash, user, transactionID)
  if (previous) return { version: previous, created: false, skipped: 'duplicate' }

  if (reason === 'automatic') {
    const project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false, ...transactionOptions(transactionID) })
    const interval = Number(project.settings?.historyIntervalMinutes ?? 15)
    if (interval === 0) return { version: null, created: false, skipped: 'disabled' }
    const latestResult = await payload.find({
      collection: 'project-versions',
      where: { project: { equals: projectId } },
      limit: 1,
      depth: 0,
      sort: '-createdAt',
      user,
      overrideAccess: false,
      ...transactionOptions(transactionID),
    })
    const latest = latestResult.docs[0]
    const createdAt = latest?.createdAt ? Date.parse(String(latest.createdAt)) : Number.NaN
    if (Number.isFinite(createdAt) && Date.now() - createdAt < interval * 60_000) {
      return { version: null, created: false, skipped: 'interval' }
    }
  }

  const reasonLabels: Record<VersionReason, string> = {
    automatic: 'Automatic snapshot',
    manual: 'Manual snapshot',
    'before-delete': 'Before page deletion',
    'before-settings-change': 'Before settings change',
    'before-restore': 'Before restoring a version',
  }
  const safeLabel = (label?.trim() || reasonLabels[reason]).slice(0, 100)
  const fingerprint = `${projectId}:${contentHash}`
  try {
    const version = await payload.create({
      collection: 'project-versions',
      data: { project: projectId, label: safeLabel, reason, snapshot, contentHash, fingerprint },
      user,
      overrideAccess: false,
      ...transactionOptions(transactionID),
    })
    return { version, created: true }
  } catch (error) {
    // The unique project+hash fingerprint also closes the race between parallel autosaves.
    const duplicate = await findVersionByHash(payload, projectId, contentHash, user, transactionID).catch(() => undefined)
    if (duplicate) return { version: duplicate, created: false, skipped: 'duplicate' }
    throw error
  }
}

export function matchVersionPages(
  snapshotPages: Array<Pick<ProjectVersionSnapshot['pages'][number], 'sourceId' | 'slug'>>,
  currentPages: any[],
): Array<any | undefined> {
  const byId = new Map(currentPages.map((page) => [String(page.id), page]))
  const bySlug = new Map(currentPages.map((page) => [String(page.slug), page]))
  const matches = snapshotPages.map((page) => byId.get(page.sourceId))
  const matched = new Set(matches.filter(Boolean).map((page) => String((page as any).id)))
  snapshotPages.forEach((page, index) => {
    if (matches[index]) return
    const candidate = bySlug.get(page.slug)
    if (!candidate || matched.has(String(candidate.id))) return
    matches[index] = candidate
    matched.add(String(candidate.id))
  })
  return matches
}

async function applyProjectSnapshot(payload: any, projectId: string, user: any, input: unknown, transactionID: TransactionID) {
  const snapshot = ProjectVersionSnapshotSchema.parse(input)
  const project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false, ...transactionOptions(transactionID) })
  const currentResult = await payload.find({
    collection: 'pages',
    where: { project: { equals: projectId } },
    limit: MAX_PROJECT_PAGES + 1,
    depth: 0,
    sort: 'slug',
    user,
    overrideAccess: false,
    ...transactionOptions(transactionID),
  })
  if (Number(currentResult.totalDocs ?? currentResult.docs.length) > MAX_PROJECT_PAGES || currentResult.docs.length > MAX_PROJECT_PAGES) {
    throw new Error(`Version restoration supports up to ${MAX_PROJECT_PAGES} pages per project.`)
  }
  const currentPages = currentResult.docs as any[]
  const matches = matchVersionPages(snapshot.pages, currentPages)
  const used = new Set(matches.filter(Boolean).map((page) => String((page as any).id)))
  const working = new Map<string, any>()

  // Vacate every current slug and homepage slot first; this makes page renames and swaps safe.
  for (const [index, page] of currentPages.entries()) {
    const changed = await payload.update({
      collection: 'pages',
      id: page.id,
      data: { slug: `restore-${createHash('sha1').update(`${projectId}:${page.id}:${Date.now()}:${index}`).digest('hex').slice(0, 24)}`, isHome: false, revision: Number(page.revision ?? 0) },
      user,
      overrideAccess: false,
      ...transactionOptions(transactionID),
    })
    working.set(String(page.id), changed.doc ?? changed)
  }

  const restored: any[] = []
  for (const [index, page] of snapshot.pages.entries()) {
    const current = matches[index]
    const data = {
      title: page.title,
      slug: page.slug,
      isHome: false,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
      nodes: page.nodes,
      undoHistory: { past: [], future: [] },
      ...(current ? { revision: Number(working.get(String(current.id))?.revision ?? current.revision ?? 0) } : { revision: 0, project: project.id }),
    }
    const result = current
      ? await payload.update({ collection: 'pages', id: current.id, data, user, overrideAccess: false, ...transactionOptions(transactionID) })
      : await payload.create({ collection: 'pages', data, user, overrideAccess: false, ...transactionOptions(transactionID) })
    restored.push(result.doc ?? result)
  }

  for (const page of currentPages) {
    if (!used.has(String(page.id))) await payload.delete({ collection: 'pages', id: page.id, user, overrideAccess: false, ...transactionOptions(transactionID) })
  }

  const homeIndex = snapshot.pages.findIndex((page) => page.isHome)
  if (homeIndex >= 0) {
    const homePage = restored[homeIndex]
    const setHome = await payload.update({
      collection: 'pages',
      id: homePage.id,
      data: { isHome: true, revision: Number(homePage.revision ?? 0) },
      user,
      overrideAccess: false,
      ...transactionOptions(transactionID),
    })
    restored[homeIndex] = setHome.doc ?? setHome
  }

  await payload.update({
    collection: 'projects',
    id: projectId,
    data: {
      name: snapshot.project.name,
      category: snapshot.project.category,
      templateId: snapshot.project.templateId,
      settings: snapshot.project.settings,
    },
    user,
    overrideAccess: false,
    ...transactionOptions(transactionID),
  })
}

export async function restoreProjectVersion(payload: any, projectId: string, versionId: string, user: any) {
  const transactionID: TransactionID | null = await payload.db?.beginTransaction?.()
  if (transactionID === null || transactionID === undefined) throw new Error('Atomic project restore is unavailable.')
  let backup: ProjectVersionSnapshot | undefined
  try {
    await payload.findByID({ collection: 'projects', id: projectId, depth: 0, user, overrideAccess: false, ...transactionOptions(transactionID) })
    const version = await payload.findByID({ collection: 'project-versions', id: versionId, depth: 0, user, overrideAccess: false, ...transactionOptions(transactionID) })
    if (relationshipId(version.project) !== projectId) throw new Error('Version not found for this project.')
    const target = ProjectVersionSnapshotSchema.parse(version.snapshot)
    backup = await readCurrentProjectSnapshot(payload, projectId, user, transactionID)
    await createProjectVersion(payload, projectId, user, 'before-restore', `Before restoring: ${String(version.label ?? 'version').slice(0, 70)}`, transactionID)
    await applyProjectSnapshot(payload, projectId, user, target, transactionID)
    await payload.db.commitTransaction(transactionID)
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID).catch(() => undefined)
    if (backup) {
      try { await createProjectVersion(payload, projectId, user, 'before-restore', 'Recovery snapshot after failed restore') } catch { /* Preserve the original error if recovery capture is unavailable. */ }
    }
    throw error
  }
}
