import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { GeneratedFile } from '@webcraft/core/exporter'

const execFileAsync = promisify(execFile)
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_FILES = 300
const MAX_BUILD_OUTPUT_FILES = 1000
const MAX_BUILD_OUTPUT_BYTES = 100 * 1024 * 1024
const SAFE_PATH_PART = /^[^<>:"|?*\u0000-\u001f]+$/
const TEXT_ASSET = /\.(?:js|mjs|cjs|css|html|json|webmanifest|txt|xml|svg)$/i

export type ProductionArtifactMetrics = {
  productionBuildMs: number
  outputFileCount: number
  outputTotalBytes: number
  javascriptBundleBytes: number
  cssBundleBytes: number
  htmlBytes: number
  otherAssetBytes: number
  gzipTextAssetBytes: number
  gzipJavaScriptBytes: number
  gzipCssBytes: number
  gzipHtmlBytes: number
}

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

/** Measure actual files in a generated production dist directory; no browser/Lighthouse scores are inferred. */
export async function measureProductionArtifacts(dist: string, productionBuildMs: number): Promise<ProductionArtifactMetrics> {
  let outputFileCount = 0
  let outputTotalBytes = 0
  let javascriptBundleBytes = 0
  let cssBundleBytes = 0
  let htmlBytes = 0
  let gzipTextAssetBytes = 0
  let gzipJavaScriptBytes = 0
  let gzipCssBytes = 0
  let gzipHtmlBytes = 0

  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Generated build output contains a symbolic link.')
      if (entry.isDirectory()) {
        await visit(fullPath)
        continue
      }
      if (!entry.isFile()) throw new Error('Generated build output contains a non-file entry.')
      outputFileCount += 1
      if (outputFileCount > MAX_BUILD_OUTPUT_FILES) throw new Error('Generated build output contains too many files to measure safely.')
      const info = await stat(fullPath)
      if (!info.isFile() || info.size > MAX_BUILD_OUTPUT_BYTES) throw new Error('Generated build output contains an invalid or oversized file.')
      outputTotalBytes += info.size
      if (outputTotalBytes > MAX_BUILD_OUTPUT_BYTES) throw new Error('Generated build output exceeds the 100 MB measurement limit.')
      const extension = entry.name.toLowerCase()
      const bytes = await readBuildFile(fullPath, info.size)
      if (extension.endsWith('.js') || extension.endsWith('.mjs') || extension.endsWith('.cjs')) javascriptBundleBytes += info.size
      else if (extension.endsWith('.css')) cssBundleBytes += info.size
      else if (extension.endsWith('.html')) htmlBytes += info.size
      else if (!(extension.endsWith('.json') || extension.endsWith('.webmanifest') || extension.endsWith('.txt') || extension.endsWith('.xml') || extension.endsWith('.svg'))) {
        // Binary files contribute to overall output, but not to compressed text-asset totals.
        continue
      }
      if (TEXT_ASSET.test(extension)) {
        const gzipBytes = gzipSync(bytes).byteLength
        gzipTextAssetBytes += gzipBytes
        if (extension.endsWith('.js') || extension.endsWith('.mjs') || extension.endsWith('.cjs')) gzipJavaScriptBytes += gzipBytes
        else if (extension.endsWith('.css')) gzipCssBytes += gzipBytes
        else if (extension.endsWith('.html')) gzipHtmlBytes += gzipBytes
      }
    }
  }

  await visit(dist)
  if (outputFileCount === 0) throw new Error('Generated production build contains no output files.')
  return {
    productionBuildMs: Math.max(0, Math.round(productionBuildMs)),
    outputFileCount,
    outputTotalBytes,
    javascriptBundleBytes,
    cssBundleBytes,
    htmlBytes,
    otherAssetBytes: Math.max(0, outputTotalBytes - javascriptBundleBytes - cssBundleBytes - htmlBytes),
    gzipTextAssetBytes,
    gzipJavaScriptBytes,
    gzipCssBytes,
    gzipHtmlBytes,
  }
}

async function readBuildFile(path: string, expectedBytes: number): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises')
  const buffer = await readFile(path)
  if (buffer.byteLength !== expectedBytes) throw new Error('Generated build output changed while it was being measured.')
  return buffer
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
    const buildStarted = performance.now()
    await execFileAsync('npm', ['run', 'build'], { cwd: root, env, timeout: 120_000, maxBuffer: 1_000_000 })
    const productionBuildMs = performance.now() - buildStarted
    const metrics = await measureProductionArtifacts(join(root, 'dist'), productionBuildMs)
    return { valid: true, fileCount: entries.length, totalBytes, productionArtifacts: metrics }
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
