import type { CollectionConfig } from 'payload'
import { MarketplacePackageSchema } from '@webcraft/core/marketplace'

export const MarketplacePackages: CollectionConfig = {
  slug: 'marketplace-packages',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'type', 'category', 'version', 'published', 'updatedAt'] },
  access: {
    create: () => false,
    read: ({ req }) => req.user ? { or: [{ owner: { equals: req.user.id } }, { published: { equals: true } }] } as any : false,
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeChange: [({ data, req, operation, originalDoc }) => {
      if (!req.user) throw new Error('Authentication is required')
      if (operation === 'update' && String(originalDoc?.owner ?? '') !== String(req.user.id)) throw new Error('Only the package owner can update this marketplace item.')
      const candidate = data.packageData ?? originalDoc?.packageData
      const parsed = MarketplacePackageSchema.parse(candidate)
      if (data.type !== undefined && data.type !== parsed.type) throw new Error('Package type does not match its validated manifest.')
      if (operation === 'update' && originalDoc?.type !== parsed.type) throw new Error('Marketplace package type cannot be changed.')
      const published = data.published ?? originalDoc?.published ?? false
      if (published && String(originalDoc?.owner ?? req.user.id) !== String(req.user.id)) throw new Error('Only the package owner can publish this item.')
      data.packageData = parsed
      data.type = parsed.type
      data.name = parsed.name
      data.description = parsed.description
      data.category = parsed.category
      data.version = parsed.version
      data.formatVersion = parsed.formatVersion
      data.published = Boolean(published)
      data.owner = operation === 'create' ? req.user.id : originalDoc?.owner
      return data
    }],
  },
  fields: [
    { name: 'type', type: 'select', required: true, options: [{ label: 'Component', value: 'component' }, { label: 'Template', value: 'template' }], index: true },
    { name: 'name', type: 'text', required: true, maxLength: 120, index: true },
    { name: 'description', type: 'textarea', maxLength: 1000 },
    { name: 'category', type: 'text', required: true, maxLength: 80, index: true },
    { name: 'version', type: 'text', required: true, maxLength: 40, index: true },
    { name: 'formatVersion', type: 'number', required: true, min: 1 },
    { name: 'published', type: 'checkbox', defaultValue: false, index: true },
    { name: 'packageData', type: 'json', required: true, admin: { hidden: true } },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, admin: { readOnly: true } },
  ],
  timestamps: true,
}
