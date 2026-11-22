import type { CollectionConfig } from 'payload'
import { resolve } from 'node:path'

function relatedId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null && 'id' in value) return String((value as { id: string | number }).id)
  return ''
}

export const Assets: CollectionConfig = {
  slug: 'assets',
  upload: {
    staticDir: resolve(process.cwd(), '.webcraft/media'),
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    filesRequiredOnCreate: true,
    imageSizes: [{ name: 'thumbnail', width: 360, height: 240 }],
    adminThumbnail: 'thumbnail',
    resizeOptions: { width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true },
  },
  access: {
    create: ({ req }) => Boolean(req.user),
    read: ({ req }) => req.user ? { owner: { equals: req.user.id } } : false,
    update: ({ req }) => req.user ? { owner: { equals: req.user.id } } : false,
    delete: ({ req }) => req.user ? { owner: { equals: req.user.id } } : false,
  },
  hooks: {
    beforeChange: [async ({ data, req, operation, originalDoc }) => {
      if (!req.user) throw new Error('Authentication is required')
      const projectId = relatedId(data.project ?? originalDoc?.project)
      if (!projectId) throw new Error('An image must belong to a project')
      await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, user: req.user, req: { transactionID: req.transactionID } })
      if (operation === 'update' && relatedId(originalDoc?.project) !== projectId) throw new Error('Assets cannot be moved between projects.')
      const folderId = relatedId(data.folder !== undefined ? data.folder : originalDoc?.folder)
      if (folderId) {
        const folder = await req.payload.findByID({ collection: 'asset-folders', id: folderId, depth: 0, user: req.user, req: { transactionID: req.transactionID } })
        if (relatedId(folder.project) !== projectId) throw new Error('Choose a folder from this project.')
      }
      if (data.name !== undefined) {
        const name = String(data.name).trim()
        if (!name || name.length > 120 || /[\\/\0\r\n]/.test(name)) throw new Error('Asset names must be 1–120 characters and cannot contain slashes or line breaks.')
        data.name = name
      }
      data.owner = operation === 'create' ? req.user.id : originalDoc?.owner
      data.project = operation === 'create' ? data.project : originalDoc?.project
      return data
    }],
  },
  fields: [
    { name: 'name', type: 'text', maxLength: 120 },
    { name: 'alt', type: 'text', maxLength: 300 },
    { name: 'folder', type: 'relationship', relationTo: 'asset-folders', index: true },
    { name: 'project', type: 'relationship', relationTo: 'projects', required: true, index: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, admin: { readOnly: true } },
  ],
}
