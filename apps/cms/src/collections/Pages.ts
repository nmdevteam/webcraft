import type { CollectionConfig } from 'payload'
import { PageDataSchema } from '@webcraft/core/schema'

export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', 'isHome', 'updatedAt'] },
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
      if (!projectId) throw new Error('A page must belong to a project')
      await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, user: req.user })
      if (operation === 'create') data.owner = req.user.id
      else data.owner = originalDoc?.owner
      const page = PageDataSchema.parse({
        title: data.title ?? originalDoc?.title,
        slug: data.slug ?? originalDoc?.slug,
        isHome: data.isHome ?? originalDoc?.isHome ?? false,
        seoTitle: data.seoTitle ?? originalDoc?.seoTitle ?? undefined,
        seoDescription: data.seoDescription ?? originalDoc?.seoDescription ?? undefined,
        nodes: data.nodes ?? originalDoc?.nodes ?? [],
      })
      Object.assign(data, page)
      const duplicates = await req.payload.find({ collection: 'pages', where: { and: [{ project: { equals: projectId } }, { slug: { equals: page.slug } }] }, limit: 2, depth: 0, user: req.user })
      if (duplicates.docs.some((item) => String(item.id) !== String(originalDoc?.id ?? ''))) throw new Error('A page with this URL slug already exists in the project.')
      if (page.isHome) {
        const homepages = await req.payload.find({ collection: 'pages', where: { and: [{ project: { equals: projectId } }, { isHome: { equals: true } }] }, limit: 2, depth: 0, user: req.user })
        if (homepages.docs.some((item) => String(item.id) !== String(originalDoc?.id ?? ''))) throw new Error('This project already has a homepage.')
      }
      if (operation === 'update' && data.revision !== undefined) {
        const expectedRevision = Number(data.revision)
        if (expectedRevision !== Number(originalDoc?.revision ?? 0)) throw new Error('Revision conflict: reload this page before saving.')
        data.revision = expectedRevision + 1
      }
      return data
    }],
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 120 },
    { name: 'slug', type: 'text', required: true, maxLength: 80, index: true },
    { name: 'isHome', type: 'checkbox', defaultValue: false },
    { name: 'seoTitle', type: 'text', maxLength: 120 },
    { name: 'seoDescription', type: 'textarea', maxLength: 300 },
    { name: 'nodes', type: 'json', required: true, defaultValue: [] },
    { name: 'revision', type: 'number', min: 0, defaultValue: 0, admin: { readOnly: true } },
    { name: 'project', type: 'relationship', relationTo: 'projects', required: true, index: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, admin: { readOnly: true } },
  ],
  timestamps: true,
}
