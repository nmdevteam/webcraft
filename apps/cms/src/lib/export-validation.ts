import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { GeneratedFile } from '@webcraft/core/exporter'

const execFileAsync = promisify(execFile)
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_FILES = 300
const SAFE_PATH_PART = /^[^<>:"|?*\u0000-\u001f]+$/

function decodeCanonicalBase64(value: string): Buffer {
  if (value.length > 4 * Math.ceil(MAX_SOURCE_BYTES / 3) || value.length % 4 !== 0) {
    throw new Error('Export contains invalid base64 content.')
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const dataLength = value.length - padding
  for (let index = 0; index < dataLength; index++) {
    const code = value.charCodeAt(index)
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) {
      throw new Error('Export contains invalid base64 content.')
    }
  }
  const last = value.charCodeAt(dataLength - 1)
  const lastValue = last >= 65 && last <= 90 ? last - 65
    : last >= 97 && last <= 122 ? last - 97 + 26
      : last >= 48 && last <= 57 ? last - 48 + 52
        : last === 43 ? 62 : last === 47 ? 63 : -1
  if (padding === 2 && (lastValue < 0 || lastValue % 16 !== 0)) throw new Error('Export contains non-canonical base64 content.')
  if (padding === 1 && (lastValue < 0 || lastValue % 4 !== 0)) throw new Error('Export contains non-canonical base64 content.')
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) throw new Error('Export contains non-canonical base64 content.')
  return decoded
}

function validatePath(relative: string) {
  const parts = relative.split('/')
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
  if (relative.length > 220 || relative.startsWith('/') || relative.includes('\\') || parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || windowsReserved.test(part) || !SAFE_PATH_PART.test(part))) {
    throw new Error('Export contains an unsafe path.')
  }
}

export async function validateGeneratedSource(files: Record<string, GeneratedFile>) {
  const entries = Object.entries(files)
  if (!entries.length || entries.length > MAX_FILES) throw new Error('Export contains an invalid number of files.')
  let totalBytes = 0
  const pathKeys = new Set<string>()
  const decoded = new Map<string, string | Buffer>()
  for (const [relative, file] of entries) {
    validatePath(relative)
    const pathKey = relative.toLowerCase()
    if (pathKeys.has(pathKey)) throw new Error('Export contains colliding file paths.')
    pathKeys.add(pathKey)
    if (!file || !['utf-8', 'base64'].includes(file.encoding) || typeof file.content !== 'string') throw new Error('Export contains an invalid file.')
    const content = file.encoding === 'base64' ? decodeCanonicalBase64(file.content) : file.content
    if (file.encoding === 'utf-8' && Buffer.from(file.content, 'utf8').toString('utf8') !== file.content) throw new Error('Export contains invalid UTF-8 content.')
    const length = typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.byteLength
    if (length > MAX_SOURCE_BYTES) throw new Error('Export contains a file that is too large.')
    totalBytes += length
    if (totalBytes > MAX_SOURCE_BYTES) throw new Error('Export exceeds the 8 MB source limit.')
    decoded.set(relative, content)
  }

  const root = await mkdtemp(join(tmpdir(), 'webcraft-export-'))
  try {
    for (const [relative, content] of decoded) {
      const target = resolve(root, relative)
      if (!target.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Export path escaped the temporary workspace.')
      await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 })
      await writeFile(target, content, { mode: 0o600, flag: 'wx' })
    }
    const env: NodeJS.ProcessEnv = {
      PATH: `${resolve(process.execPath, '..')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
      HOME: root,
      TMPDIR: root,
      npm_config_cache: join(root, '.npm-cache'),
      npm_config_userconfig: join(root, '.npmrc'),
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      NODE_ENV: 'production',
    }
    await execFileAsync('npm', ['install', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: root, env, timeout: 150_000, maxBuffer: 1_000_000 })
    await execFileAsync('npm', ['run', 'build'], { cwd: root, env, timeout: 120_000, maxBuffer: 1_000_000 })
    return { valid: true, fileCount: entries.length, totalBytes }
  } catch (error) {
    const commandError = error as Error & { stdout?: Buffer | string; stderr?: Buffer | string }
    const output = [commandError.stderr, commandError.stdout].filter(Boolean).map((item) => Buffer.isBuffer(item) ? item.toString('utf8') : String(item)).join(' ')
    const message = output || (error instanceof Error ? error.message : 'Build failed.')
    const compact = message.replaceAll(root, '[temporary export]').replace(/\s+/g, ' ').slice(0, 800)
    throw new Error(`Generated project build failed: ${compact}`)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
}
