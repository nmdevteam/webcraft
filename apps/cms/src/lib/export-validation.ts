import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { GeneratedFile } from '@webcraft/core/exporter'

const execFileAsync = promisify(execFile)
const MAX_SOURCE_BYTES = 8 * 1024 * 1024

export async function validateGeneratedSource(files: Record<string, GeneratedFile>) {
  const entries = Object.entries(files)
  if (!entries.length || entries.length > 300) throw new Error('Export contains an invalid number of files.')
  let totalBytes = 0
  for (const [relative, file] of entries) {
    if (relative.startsWith('/') || relative.includes('\\') || relative.split('/').some((part) => part === '..' || part === '.' || part === '')) throw new Error('Export contains an unsafe path.')
    if (relative.length > 220 || !['utf-8','base64'].includes(file.encoding)) throw new Error('Export contains an invalid file.')
    const length = file.encoding === 'base64' ? Buffer.from(file.content, 'base64').byteLength : Buffer.byteLength(file.content, 'utf8')
    if (length > MAX_SOURCE_BYTES) throw new Error('Export contains a file that is too large.')
    totalBytes += length
    if (totalBytes > MAX_SOURCE_BYTES) throw new Error('Export exceeds the 8 MB source limit.')
  }
  const root = await mkdtemp(join(tmpdir(), 'webcraft-export-'))
  try {
    for (const [relative, file] of entries) {
      const target = resolve(root, relative)
      if (!target.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Export path escaped the temporary workspace.')
      await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 })
      const content = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content
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
