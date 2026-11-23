type DatabaseErrorLike = Error & {
  code?: unknown
  constraint?: unknown
  cause?: unknown
  originalError?: unknown
}

const uniqueConflictMessages: Record<string, string> = {
  webcraft_pages_project_slug_uidx: 'A page with this URL slug already exists in the project.',
  webcraft_pages_one_homepage_uidx: 'This project already has a homepage.',
  webcraft_asset_folders_project_name_ci_uidx: 'A folder with this name already exists in the project (folder names are case-insensitive).',
}

function postgresError(error: unknown): DatabaseErrorLike | undefined {
  const seen = new Set<unknown>()
  let current: unknown = error
  for (let depth = 0; depth < 8 && current && !seen.has(current); depth += 1) {
    seen.add(current)
    if (typeof current !== 'object') return undefined
    const candidate = current as DatabaseErrorLike
    if (typeof candidate.code === 'string' && (candidate.code === '40001' || candidate.code === '23505')) return candidate
    current = candidate.cause ?? candidate.originalError
  }
  return undefined
}

export function databaseConflictResponse(error: unknown): { status: 409; message: string } | undefined {
  const databaseError = postgresError(error)
  if (!databaseError) return undefined
  if (databaseError.code === '40001' && String(databaseError.message ?? '').includes('WEBCRAFT_PAGE_REVISION_CONFLICT')) {
    return { status: 409, message: 'Revision conflict: another save completed first. Reload this page before saving again.' }
  }
  if (databaseError.code === '23505' && typeof databaseError.constraint === 'string' && uniqueConflictMessages[databaseError.constraint]) {
    return { status: 409, message: uniqueConflictMessages[databaseError.constraint]! }
  }
  return undefined
}
