import type { CollectionConfig } from 'payload'
import { ProjectSettingsSchema } from '@webcraft/core/schema'
import { TEMPLATE_CATEGORIES } from '@webcraft/core/templates'
import { validatePwaIconDimensions } from '../lib/pwa-icons'

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'category', 'updatedAt'] },
  access: {
    create: ({ req }) => Boolean(req.user),
    read: ({ req }) => req.user ? { owner: { equals: req.user.id } } : false,
    update: ({ req }) => req.user ? { owner: { equals: req.user.id } } : false,
    delete: ({ req }) => req.user ? { owner: { equals: req.user.id } } : false,
  },
  hooks: {
    beforeChange: [async ({ data, req, operation, originalDoc }) => {
      if (!req.user) throw new Error('Authentication is required')
      if (operation === 'create') data.owner = req.user.id
      else data.owner = originalDoc?.owner
      if (data.settings !== undefined) {
        data.settings = ProjectSettingsSchema.parse(data.settings)
        const iconPaths = [data.settings.pwa.icon192Path, data.settings.pwa.icon512Path].filter(Boolean)
        if (iconPaths.length) {
          const projectId = originalDoc?.id
          if (!projectId) throw new Error('PWA icons can only be selected from an existing project asset library.')
          const filenames = [...new Set(iconPaths.map((path: string) => path.slice('/media/'.length)))]
          const assets = await req.payload.find({
            collection: 'assets',
            where: { and: [
              { project: { equals: projectId } },
              { owner: { equals: req.user.id } },
              { filename: { in: filenames } },
            ] },
            limit: filenames.length + 1,
            depth: 0,
            select: { filename: true },
            user: req.user,
            overrideAccess: false,
            req: { transactionID: req.transactionID },
          })
          await validatePwaIconDimensions(data.settings.pwa, assets.docs)
        }
      }
      return data
    }],
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 120, index: true },
    { name: 'category', type: 'select', required: true, options: TEMPLATE_CATEGORIES.map((value) => ({ label: value, value })) },
    { name: 'templateId', type: 'text', required: true, maxLength: 80 },
    { name: 'settings', type: 'json', required: true, defaultValue: { language: 'en', title: 'My website', description: '', siteUrl: '', primaryColor: '#5b5ce2', fontFamily: 'Inter', logoPath: '', faviconPath: '', socialImagePath: '', customCss: '', customMetaTags: [], structuredData: '', breakpoints: { mobile: 600, tablet: 900 } } },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, admin: { readOnly: true } },
  ],
  timestamps: true,
}
