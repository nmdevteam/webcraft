import type { CollectionConfig } from 'payload'
import { resolve } from 'node:path'

export const Assets: CollectionConfig = {
  slug: 'assets',
  upload: {
    staticDir: resolve(process.cwd(), 'public/media'),
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
      const projectValue = data.project ?? originalDoc?.project
      const projectId = typeof projectValue === 'object' && projectValue !== null ? projectValue.id : projectValue
      if (!projectId) throw new Error('An image must belong to a project')
      await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, user: req.user })
      data.owner = operation === 'create' ? req.user.id : originalDoc?.owner
      return data
    }],
  },
  fields: [
    { name: 'alt', type: 'text', maxLength: 300 },
    { name: 'project', type: 'relationship', relationTo: 'projects', required: true, index: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, admin: { readOnly: true } },
  ],
}
