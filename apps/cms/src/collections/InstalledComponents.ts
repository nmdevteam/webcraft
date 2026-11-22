import type { CollectionConfig } from 'payload'
import { validateTree } from '@webcraft/core/schema'
import { ComponentEntrySchema } from '@webcraft/core/marketplace'

function relatedId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null && 'id' in value) return String((value as { id: string | number }).id)
  return ''
}

export const InstalledComponents: CollectionConfig = {
  slug: 'installed-components',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'project', 'version', 'updatedAt'] },
  access: {
    create: () => false,
    read: ({ req }) => req.user ? { owner: { equals: req.user.id } } : false,
    update: () => false,
    delete: () => false,
  },
  indexes: [{ fields: ['owner', 'project', 'sourcePackage'], unique: true }],
  hooks: {
    beforeChange: [async ({ data, req, operation, originalDoc }) => {
      if (!req.user) throw new Error('Authentication is required')
      if (operation === 'update' && String(originalDoc?.owner ?? '') !== String(req.user.id)) throw new Error('Only the installed component owner can update this record.')
      const projectId = relatedId(data.project ?? originalDoc?.project)
      const packageId = relatedId(data.sourcePackage ?? originalDoc?.sourcePackage)
      if (!projectId || !packageId) throw new Error('Project and source package are required.')
      const project = await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, user: req.user })
      const source = await req.payload.findByID({ collection: 'marketplace-packages', id: packageId, depth: 0, user: req.user })
      if (source.type !== 'component') throw new Error('Only component packages can be installed in a project.')
      if (operation === 'update' && (relatedId(originalDoc?.project) !== projectId || relatedId(originalDoc?.sourcePackage) !== packageId)) {
        throw new Error('An installed component cannot be moved to another project or source package.')
      }
      const rawEntries = data.components ?? originalDoc?.components
      if (!Array.isArray(rawEntries) || rawEntries.length < 1 || rawEntries.length > 20) throw new Error('An installation must contain 1–20 component entries.')
      const entries = rawEntries.map((entry) => ComponentEntrySchema.parse(entry))
      const ids = new Set<string>()
      let count = 0
      for (const entry of entries) {
        if (ids.has(entry.id)) throw new Error('Installed component IDs must be unique.')
        ids.add(entry.id)
        const tree = validateTree(entry.nodes)
        count += tree.reduce((total, node) => total + 1 + countNodes(node.children), 0)
      }
      if (count > 2_000) throw new Error('An installation may contain at most 2,000 nodes.')
      data.components = entries
      data.name = String(data.name ?? originalDoc?.name ?? source.name).slice(0, 120)
      data.version = String(data.version ?? originalDoc?.version ?? (source.packageData as any)?.version ?? '').slice(0, 40)
      data.project = project.id
      data.sourcePackage = source.id
      data.owner = operation === 'create' ? req.user.id : originalDoc?.owner
      const duplicate = await req.payload.find({
        collection: 'installed-components',
        where: { and: [{ owner: { equals: req.user.id } }, { project: { equals: projectId } }, { sourcePackage: { equals: packageId } }] },
        limit: 2,
        depth: 0,
        user: req.user,
      })
      if (duplicate.docs.some((doc) => String(doc.id) !== String(originalDoc?.id ?? ''))) throw new Error('This package is already installed in the project.')
      return data
    }],
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'version', type: 'text', required: true, maxLength: 40 },
    { name: 'project', type: 'relationship', relationTo: 'projects', required: true, index: true },
    { name: 'sourcePackage', type: 'relationship', relationTo: 'marketplace-packages', required: true, index: true },
    { name: 'components', type: 'json', required: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, admin: { readOnly: true } },
  ],
  timestamps: true,
}

function countNodes(nodes: { children: any[] }[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0)
}
