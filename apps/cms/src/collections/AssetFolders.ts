import type { CollectionConfig } from 'payload'

function relatedId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null && 'id' in value) return String((value as { id: string | number }).id)
  return ''
}

export const AssetFolders: CollectionConfig = {
  slug: 'asset-folders',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'project', 'updatedAt'] },
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
      const name = String(data.name ?? originalDoc?.name ?? '').trim()
      if (!projectId) throw new Error('A folder must belong to a project')
      if (!name || name.length > 80 || /[\\/\0\r\n]/.test(name)) throw new Error('Folder names must be 1–80 characters and cannot contain slashes or line breaks.')
      await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, user: req.user, req: { transactionID: req.transactionID } })
      data.name = name
      data.project = operation === 'create' ? data.project : originalDoc?.project
      data.owner = operation === 'create' ? req.user.id : originalDoc?.owner
      return data
    }],
    beforeDelete: [async ({ id, req }) => {
      if (!req.user) throw new Error('Authentication is required')
      const assets = await req.payload.find({ collection: 'assets', where: { folder: { equals: id } }, limit: 1, depth: 0, user: req.user, req: { transactionID: req.transactionID } })
      if (assets.docs.length) throw new Error('Move assets out of this folder before deleting it.')
    }],
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 80 },
    { name: 'project', type: 'relationship', relationTo: 'projects', required: true, index: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, admin: { readOnly: true } },
  ],
  timestamps: true,
}
