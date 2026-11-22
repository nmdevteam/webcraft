import type { CollectionConfig } from 'payload'

async function allowFirstUser({ req }: { req: any }) {
  if (req.user) return false
  const result = await req.payload.find({ collection: 'users', limit: 1, depth: 0, overrideAccess: true })
  return result.totalDocs === 0
}

export const Users: CollectionConfig = {
  slug: 'users',
  auth: { tokenExpiration: 60 * 60 * 24 * 7, maxLoginAttempts: 10, lockTime: 15 * 60 * 1000 },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'email'] },
  access: {
    create: allowFirstUser,
    read: ({ req }) => req.user ? { id: { equals: req.user.id } } : false,
    update: ({ req }) => req.user ? { id: { equals: req.user.id } } : false,
    delete: () => false,
  },
  hooks: {
    beforeValidate: [({ data, operation }) => {
      if (operation === 'create' || data?.password !== undefined) {
        if (typeof data?.password !== 'string' || data.password.length < 10 || data.password.length > 128) throw new Error('Password must be between 10 and 128 characters.')
      }
      return data
    }],
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 120 },
  ],
}
