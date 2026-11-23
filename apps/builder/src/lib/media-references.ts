export function replaceMediaReferences(value: unknown, oldPath: string, newPath: string): unknown {
  if (typeof value === 'string') {
    const escapedPath = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const reference = new RegExp(`(^|[\\s"'(=,:])${escapedPath}([?#][^\\s"'(),;]*)?(?=$|[\\s"'(),;])`, 'g')
    return value.replace(reference, (_match, prefix: string, suffix: string | undefined) => `${prefix}${newPath}${newPath ? suffix ?? '' : ''}`)
  }
  if (Array.isArray(value)) return value.map((item) => replaceMediaReferences(item, oldPath, newPath))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceMediaReferences(item, oldPath, newPath)]))
  return value
}
