import type { CollectionConfig } from 'payload'

function relatedId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null && 'id' in value) return String((value as { id: string | number }).id)
  return ''
}

export const MarketplaceFavorites: CollectionConfig = {
  slug: 'marketplace-favorites',
  access: {
    create: () => false,
    read: ({ req }) => req.user ? { owner: { equals: req.user.id } } : false,
    update: () => false,
    delete: () => false,
  },
  indexes: [{ fields: ['owner', 'packageId'], unique: true }],
  hooks: {
    beforeChange: [async ({ data, req, operation, originalDoc }) => {
      if (!req.user) throw new Error('Authentication is required')
      if (operation !== 'create' && String(originalDoc?.owner ?? '') !== String(req.user.id)) throw new Error('Only the favorite owner can update this record.')
      const packageId = String(data.packageId ?? originalDoc?.packageId ?? '')
      const kind = String(data.kind ?? originalDoc?.kind ?? '')
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(packageId) || !['component', 'template'].includes(kind)) throw new Error('Invalid marketplace favorite.')
      const item = await req.payload.findByID({ collection: 'marketplace-packages', id: packageId, depth: 0, user: req.user })
      if (item.type !== kind) throw new Error('Favorite type does not match the marketplace package.')
      const duplicates = await req.payload.find({
        collection: 'marketplace-favorites',
        where: { and: [{ owner: { equals: req.user.id } }, { packageId: { equals: packageId } }] },
        limit: 2,
        depth: 0,
        user: req.user,
      })
      if (duplicates.docs.some((doc) => String(doc.id) !== String(originalDoc?.id ?? ''))) throw new Error('This item is already in favorites.')
      if (operation === 'create') {
        const allFavorites = await req.payload.find({ collection: 'marketplace-favorites', where: { owner: { equals: req.user.id } }, limit: 201, depth: 0, user: req.user })
        if (Number(allFavorites.totalDocs ?? allFavorites.docs.length) >= 200) throw new Error('A user can save at most 200 marketplace favorites.')
      }
      data.packageId = packageId
      data.kind = kind
      data.owner = operation === 'create' ? req.user.id : originalDoc?.owner
      return data
    }],
  },
  fields: [
    { name: 'packageId', type: 'text', required: true, index: true, maxLength: 80 },
    { name: 'kind', type: 'select', required: true, options: [{ label: 'Component', value: 'component' }, { label: 'Template', value: 'template' }], index: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, admin: { readOnly: true } },
  ],
  timestamps: true,
}
