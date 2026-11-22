export type WritableFile = { write(data: string | Uint8Array): Promise<void>; close(): Promise<void> }
export type DirectoryHandle = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<WritableFile> }>
}
export type FileSystemWindow = Window & { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle> }

function errorName(error: unknown) {
  return (error as { name?: string } | null)?.name
}

export async function createFreshDirectory(parent: DirectoryHandle, name: string) {
  for (let suffix = 1; suffix <= 10000; suffix += 1) {
    const candidate = suffix === 1 ? name : `${name}-${suffix}`
    try {
      await parent.getDirectoryHandle(candidate)
      continue
    } catch (error) {
      const name = errorName(error)
      if (name === 'TypeMismatchError') continue
      if (name !== 'NotFoundError') throw error
    }
    try {
      return { name: candidate, handle: await parent.getDirectoryHandle(candidate, { create: true }) }
    } catch (error) {
      if (errorName(error) === 'TypeMismatchError') continue
      throw error
    }
  }
  throw new Error('Could not find an unused folder name for this export.')
}
