import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Return the per-user application data directory for packaged installs.
 * Development keeps its existing workspace-relative locations when the
 * variable is unset.
 */
export function getMediaStorageRoot(): string {
  const root = process.env.WEBCRAFT_DATA_DIR
    ? resolve(process.env.WEBCRAFT_DATA_DIR)
    : resolve(process.cwd(), '.webcraft')
  return resolve(root, 'media')
}

export function getGitHubStoreDir(): string {
  return process.env.WEBCRAFT_DATA_DIR
    ? resolve(process.env.WEBCRAFT_DATA_DIR)
    : resolve(process.cwd(), '../../.webcraft')
}

export function getGitHubStorePath(): string {
  return resolve(getGitHubStoreDir(), 'github-token.enc')
}

/** Platform-safe containment check for a resolved child path. */
export function isPathWithin(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target))
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}
