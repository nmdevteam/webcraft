import { APIError, type CollectionConfig } from 'payload'
import { PageDataSchema, PageUndoHistorySchema } from '@webcraft/core/schema'
import { nextPageRevision, submittedPageRevision } from '@webcraft/core/page-revision'

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
      await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, user: req.user, req: { transactionID: req.transactionID } })
      const originalProject = originalDoc?.project
      const originalProjectId = typeof originalProject === 'object' && originalProject !== null ? originalProject.id : originalProject
      if (operation === 'update' && String(projectId) !== String(originalProjectId)) throw new Error('Pages cannot be moved between projects.')
      if (operation === 'create') data.owner = req.user.id
      else data.owner = originalDoc?.owner
      data.project = operation === 'create' ? data.project : originalDoc?.project
      const page = PageDataSchema.parse({
        title: data.title ?? originalDoc?.title,
        slug: data.slug ?? originalDoc?.slug,
        isHome: data.isHome ?? originalDoc?.isHome ?? false,
        seoTitle: data.seoTitle ?? originalDoc?.seoTitle ?? undefined,
        seoDescription: data.seoDescription ?? originalDoc?.seoDescription ?? undefined,
        nodes: data.nodes ?? originalDoc?.nodes ?? [],
      })
      Object.assign(data, page)
      data.undoHistory = PageUndoHistorySchema.parse(data.undoHistory ?? originalDoc?.undoHistory ?? {})
      if (operation === 'update') {
        const submittedRevision = submittedPageRevision(req.data, data.revision)
        const revision = nextPageRevision(submittedRevision, originalDoc?.revision)
        if (!revision.ok) {
          const message = revision.status === 409
            ? 'Revision conflict: reload this page before saving.'
            : 'A page revision is required. Reload this page before saving.'
          throw new APIError(message, revision.status, null, true)
        }
        data.expectedRevision = submittedRevision
        data.revision = revision.nextRevision
      } else data.expectedRevision = null
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
    { name: 'undoHistory', type: 'json', defaultValue: { past: [], future: [] }, admin: { hidden: true } },
    { name: 'revision', type: 'number', min: 0, defaultValue: 0, admin: { readOnly: true } },
    { name: 'expectedRevision', type: 'number', admin: { hidden: true, readOnly: true } },
    { name: 'project', type: 'relationship', relationTo: 'projects', required: true, index: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, admin: { readOnly: true } },
  ],
  timestamps: true,
}
