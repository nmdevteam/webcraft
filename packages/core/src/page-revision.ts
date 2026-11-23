export type PageRevisionResult =
  | { ok: true; nextRevision: number }
  | { ok: false; status: 400 | 409 }

/** Prefer the unmerged REST body; Payload may copy the stored revision into hook data for PATCH requests. */
export function submittedPageRevision(requestData: unknown, hookDataRevision: unknown): unknown {
  if (requestData && typeof requestData === 'object' && !Array.isArray(requestData)) {
    return (requestData as Record<string, unknown>).revision
  }
  return hookDataRevision
}

export function nextPageRevision(submitted: unknown, current: unknown): PageRevisionResult {
  if (!Number.isSafeInteger(submitted) || (submitted as number) < 0) return { ok: false, status: 400 }
  const currentRevision = current === undefined || current === null ? 0 : Number(current)
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || submitted !== currentRevision) {
    return { ok: false, status: 409 }
  }
  return { ok: true, nextRevision: (submitted as number) + 1 }
}
