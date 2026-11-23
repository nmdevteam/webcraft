import { constants as fsConstants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import sharp, { type Metadata } from 'sharp'
import { PwaSettingsSchema } from '@webcraft/core/pwa'

export const MAX_PRIVATE_MEDIA_BYTES = 5 * 1024 * 1024
const SAFE_MEDIA_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(png|jpe?g|webp|gif)$/i

export type ProjectMediaRecord = { filename?: unknown }

export async function readPrivateMediaBuffer(filename: string, mediaRoot = resolve(process.cwd(), '.webcraft/media')): Promise<Buffer> {
  if (basename(filename) !== filename || !SAFE_MEDIA_FILENAME.test(filename)) throw new Error('An uploaded asset has an unsafe filename.')
  mediaRoot = resolve(/*turbopackIgnore: true*/ mediaRoot)
  const rootStat = await lstat(mediaRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await realpath(/*turbopackIgnore: true*/ mediaRoot) !== mediaRoot) {
    throw new Error('The uploaded asset storage directory is not safe.')
  }
  const path = resolve(mediaRoot, filename)
  const handle = await open(/*turbopackIgnore: true*/ path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  try {
    const fileStat = await handle.stat()
    if (!fileStat.isFile()) throw new Error('An uploaded asset is not a regular file.')
    if (fileStat.size > MAX_PRIVATE_MEDIA_BYTES) throw new Error('An uploaded asset exceeds the 5 MB limit.')
    const buffer = await handle.readFile()
    if (buffer.byteLength > MAX_PRIVATE_MEDIA_BYTES) throw new Error('An uploaded asset exceeds the 5 MB limit.')
    return buffer
  } finally {
    await handle.close()
  }
}

/** Validate only project-owned records supplied by an owner-scoped Payload query. */
export async function validatePwaIconDimensions(
  value: unknown,
  assets: readonly ProjectMediaRecord[],
  mediaRoot = resolve(process.cwd(), '.webcraft/media'),
): Promise<void> {
  const settings = PwaSettingsSchema.parse(value ?? {})
  const selections = [
    { path: settings.icon192Path, size: 192 },
    { path: settings.icon512Path, size: 512 },
  ].filter((item) => item.path)
  if (!selections.length) return

  const buffers = new Map<string, Buffer>()
  for (const selection of selections) {
    const filename = selection.path.slice('/media/'.length)
    const matches = assets.filter((asset) => asset.filename === filename)
    if (matches.length !== 1) throw new Error(`The selected ${selection.size}×${selection.size} PWA icon must be an image in this project’s asset library.`)

    let buffer = buffers.get(filename)
    if (!buffer) {
      buffer = await readPrivateMediaBuffer(filename, mediaRoot)
      buffers.set(filename, buffer)
    }
    let metadata: Metadata
    try {
      metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata()
    } catch {
      throw new Error(`The selected ${selection.size}×${selection.size} PWA icon is not a valid supported raster image.`)
    }
    if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format ?? '')) {
      throw new Error(`The selected ${selection.size}×${selection.size} PWA icon is not a supported PNG, JPEG, WebP, or GIF image.`)
    }
    if (metadata.width !== selection.size || metadata.height !== selection.size) {
      throw new Error(`The selected PWA icon must be exactly ${selection.size}×${selection.size} pixels; this image is ${metadata.width ?? 'unknown'}×${metadata.height ?? 'unknown'}.`)
    }
  }
}
