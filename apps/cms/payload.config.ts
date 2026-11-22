import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { Users } from './src/collections/Users'
import { Projects } from './src/collections/Projects'
import { Pages } from './src/collections/Pages'
import { Assets } from './src/collections/Assets'

const secret = process.env.PAYLOAD_SECRET
if (!secret || secret.length < 32) throw new Error('PAYLOAD_SECRET must be at least 32 characters. Run `pnpm setup`.')
const builderOrigin = process.env.BUILDER_ORIGIN ?? 'http://127.0.0.1:5173'

export default buildConfig({
  secret,
  serverURL: process.env.CMS_URL ?? 'http://127.0.0.1:3000',
  admin: { user: Users.slug },
  editor: lexicalEditor(),
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL ?? 'postgres://webcraft:webcraft@127.0.0.1:5432/webcraft' },
    push: process.env.NODE_ENV !== 'production',
  }),
  collections: [Users, Projects, Pages, Assets],
  upload: { requestSizeLimit: 6 * 1024 * 1024, limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4, fieldSize: 16 * 1024, parts: 5 } },
  cors: [builderOrigin],
  csrf: [builderOrigin],
  typescript: { outputFile: 'src/payload-types.ts' },
  telemetry: false,
})
