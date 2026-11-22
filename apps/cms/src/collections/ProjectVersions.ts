import type { CollectionConfig } from 'payload'
import { ProjectVersionSnapshotSchema, VERSION_REASONS } from '@webcraft/core/schema'
import { hashProjectSnapshot } from '../lib/project-history'

export const ProjectVersions: CollectionConfig = {
  slug: 'project-versions',
  admin: { useAsTitle: 'label', defaultColumns: ['label', 'reason', 'pageCount', 'createdAt'] },
  access: {
    create: ({ req }) => Boolean(req.user),
    read: ({ req }) => req.user ? { owner: { equals: req.user.id } } : false,
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeChange: [async ({ data, req, operation }) => {
      if (!req.user) throw new Error('Authentication is required')
      if (operation !== 'create') throw new Error('Project versions are immutable.')
      const projectValue = data.project
      const projectId = typeof projectValue === 'object' && projectValue !== null ? projectValue.id : projectValue
      if (!projectId) throw new Error('A project version must belong to a project.')
      const project = await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, user: req.user, overrideAccess: false, req: { transactionID: req.transactionID } })
      const snapshot = ProjectVersionSnapshotSchema.parse(data.snapshot)
      const contentHash = hashProjectSnapshot(snapshot)
      data.owner = req.user.id
      data.project = project.id
      data.snapshot = snapshot
      data.contentHash = contentHash
      data.fingerprint = `${projectId}:${contentHash}`
      data.pageCount = snapshot.pages.length
      data.label = String(data.label ?? 'Snapshot').trim().slice(0, 100) || 'Snapshot'
      return data
    }],
  },
  fields: [
    { name: 'project', type: 'relationship', relationTo: 'projects', required: true, index: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, admin: { readOnly: true } },
    { name: 'label', type: 'text', required: true, maxLength: 100 },
    { name: 'reason', type: 'select', required: true, options: VERSION_REASONS.map((value) => ({ label: value.replaceAll('-', ' '), value })) },
    { name: 'pageCount', type: 'number', required: true, min: 1, max: 100, admin: { readOnly: true } },
    { name: 'contentHash', type: 'text', required: true, maxLength: 64, index: true, admin: { hidden: true, readOnly: true } },
    { name: 'fingerprint', type: 'text', required: true, maxLength: 220, unique: true, admin: { hidden: true, readOnly: true } },
    { name: 'snapshot', type: 'json', required: true, admin: { hidden: true } },
  ],
  timestamps: true,
}
