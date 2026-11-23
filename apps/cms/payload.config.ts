import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sql } from 'drizzle-orm'
import { uniqueIndex } from 'drizzle-orm/pg-core'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { Users } from './src/collections/Users'
import { Projects } from './src/collections/Projects'
import { Pages } from './src/collections/Pages'
import { AssetFolders } from './src/collections/AssetFolders'
import { Assets } from './src/collections/Assets'
import { ProjectVersions } from './src/collections/ProjectVersions'
import { MarketplacePackages } from './src/collections/MarketplacePackages'
import { MarketplaceFavorites } from './src/collections/MarketplaceFavorites'
import { InstalledComponents } from './src/collections/InstalledComponents'
import { databaseConflictResponse } from './src/lib/database-conflicts'

const secret = process.env.PAYLOAD_SECRET
if (!secret || secret.length < 32) throw new Error('PAYLOAD_SECRET must be at least 32 characters. Run `pnpm run setup`.')
const builderOrigin = process.env.BUILDER_ORIGIN ?? 'http://127.0.0.1:5173'

export default buildConfig({
  secret,
  serverURL: process.env.CMS_URL ?? 'http://127.0.0.1:3000',
  admin: { user: Users.slug },
  editor: lexicalEditor(),
  sharp,
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL ?? 'postgres://webcraft:webcraft@127.0.0.1:5432/webcraft' },
    push: process.env.NODE_ENV !== 'production',
    migrationDir: resolve(process.cwd(), 'src/migrations'),
    afterSchemaInit: [({ schema, extendTable }) => {
      const pages = schema.tables.pages
      const assetFolders = schema.tables.asset_folders
      if (!pages || !assetFolders) throw new Error('WebCraft integrity indexes could not find the pages or asset_folders table in the generated schema.')

      extendTable({
        table: pages,
        extraConfig: (table) => ({
          webcraftPagesProjectSlug: uniqueIndex('webcraft_pages_project_slug_uidx').on(table.project, table.slug),
          webcraftPagesOneHomepage: uniqueIndex('webcraft_pages_one_homepage_uidx')
            .on(table.project)
            .where(sql`${table.isHome} IS TRUE`),
        }),
      })
      extendTable({
        table: assetFolders,
        extraConfig: (table) => ({
          webcraftAssetFoldersProjectName: uniqueIndex('webcraft_asset_folders_project_name_ci_uidx')
            .on(table.project, sql`LOWER(${table.name})`),
        }),
      })
      return schema
    }],
  }),
  collections: [Users, Projects, Pages, AssetFolders, Assets, ProjectVersions, MarketplacePackages, MarketplaceFavorites, InstalledComponents],
  upload: { requestSizeLimit: 6 * 1024 * 1024, limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4, fieldSize: 16 * 1024, parts: 5 } },
  endpoints: [{
    path: '/webcraft-health',
    method: 'get',
    handler: async (req) => {
      try {
        await req.payload.db.drizzle.execute(sql`SELECT 1`)
        return Response.json({ status: 'ok', database: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
      } catch {
        return Response.json({ status: 'error', database: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
      }
    },
  }],
  cors: [builderOrigin],
  csrf: [builderOrigin],
  typescript: { outputFile: 'src/payload-types.ts' },
  hooks: {
    afterError: [({ error }) => {
      const conflict = databaseConflictResponse(error)
      if (!conflict) return
      return {
        status: conflict.status,
        response: { errors: [{ name: 'ConflictError', message: conflict.message }] },
      }
    }],
  },
  telemetry: false,
})
