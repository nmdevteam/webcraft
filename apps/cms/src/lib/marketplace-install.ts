import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { MarketplaceAsset } from '@webcraft/core/marketplace'
import { MarketplaceApiError } from './marketplace-route'

const mediaRoot = resolve(process.cwd(), '.webcraft/media')
const safeFilename = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif)$/i

function validateImage(buffer: Buffer, asset: MarketplaceAsset) {
  const valid = asset.mimeType === 'image/png'
    ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : asset.mimeType === 'image/jpeg'
      ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : asset.mimeType === 'image/gif'
        ? buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
        : buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!valid) throw new MarketplaceApiError(`Image “${asset.filename}” does not match its declared MIME type.`)
}

export function createAssetReferenceMap(assets: MarketplaceAsset[]): Map<string, string> {
  return new Map(assets.map((asset) => {
    if (!safeFilename.test(asset.filename) || basename(asset.filename) !== asset.filename) throw new MarketplaceApiError('A package contains an unsafe image filename.')
    const extension = asset.filename.split('.').at(-1)!.toLowerCase()
    const target = `wc-${randomUUID().replace(/-/g, '').slice(0, 16)}.${extension}`
    return [`/media/${asset.filename}`, `/media/${target}`]
  }))
}

export function remapMediaReferences(value: unknown, mapping: Map<string, string>): any {
  if (typeof value === 'string') {
    if (mapping.has(value)) return mapping.get(value)!
    return value.replace(/\/media\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif)/gi, (match) => mapping.get(match) ?? match)
  }
  if (Array.isArray(value)) return value.map((item) => remapMediaReferences(item, mapping))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapMediaReferences(item, mapping)]))
  return value
}

export type CreatedMarketplaceAsset = { filename: string; thumbnailFilename?: string }

export async function createProjectAssets(payload: any, user: any, projectId: string | number, assets: MarketplaceAsset[], mapping: Map<string, string>, transactionID: string | number): Promise<CreatedMarketplaceAsset[]> {
  const created: CreatedMarketplaceAsset[] = []
  try {
    for (const asset of assets) {
      const newPath = mapping.get(`/media/${asset.filename}`)
      if (!newPath) throw new MarketplaceApiError('A package image could not be mapped into the destination project.')
      const filename = newPath.slice('/media/'.length)
      const buffer = Buffer.from(asset.contentBase64, 'base64')
      if (buffer.byteLength < 1 || buffer.byteLength > 5 * 1024 * 1024 || buffer.toString('base64') !== asset.contentBase64) throw new MarketplaceApiError('A package image has invalid or oversized base64 data.')
      validateImage(buffer, asset)
      const filePath = resolve(mediaRoot, filename)
      if (!filePath.startsWith(`${mediaRoot}/`)) throw new MarketplaceApiError('A package image path is invalid.')
      created.push({ filename })
      const file = { name: filename, data: buffer, mimetype: asset.mimeType, size: buffer.byteLength }
      const doc = await payload.create({
        collection: 'assets',
        data: { name: asset.filename, alt: '', project: projectId, owner: user.id },
        file,
        user,
        overrideAccess: true,
        req: { transactionID },
      })
      created[created.length - 1] = { filename: String((doc as any).filename ?? filename), thumbnailFilename: (doc as any).sizes?.thumbnail?.filename }
    }
  } catch (error) {
    await removeCreatedAssetFiles(created)
    throw error
  }
  return created
}

export async function removeCreatedAssetFiles(items: CreatedMarketplaceAsset[]) {
  for (const item of items) {
    for (const name of [item.filename, item.thumbnailFilename].filter(Boolean) as string[]) {
      if (!safeFilename.test(name) || basename(name) !== name) continue
      const path = resolve(mediaRoot, name)
      if (path.startsWith(`${mediaRoot}/`)) await unlink(path).catch(() => undefined)
    }
  }
}
