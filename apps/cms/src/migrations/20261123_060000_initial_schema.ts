import { readFile } from 'node:fs/promises'
import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

const requiredTables = [
  'asset_folders',
  'assets',
  'installed_components',
  'marketplace_favorites',
  'marketplace_packages',
  'pages',
  'payload_kv',
  'payload_locked_documents',
  'payload_locked_documents_rels',
  'payload_preferences',
  'payload_preferences_rels',
  'project_versions',
  'projects',
  'users',
  'users_sessions',
] as const

const requiredEnums = [
  'enum_marketplace_favorites_kind',
  'enum_marketplace_packages_type',
  'enum_project_versions_reason',
  'enum_projects_category',
] as const

const requiredSequences = [
  'asset_folders_id_seq',
  'assets_id_seq',
  'installed_components_id_seq',
  'marketplace_favorites_id_seq',
  'marketplace_packages_id_seq',
  'pages_id_seq',
  'payload_kv_id_seq',
  'payload_locked_documents_id_seq',
  'payload_locked_documents_rels_id_seq',
  'payload_preferences_id_seq',
  'payload_preferences_rels_id_seq',
  'project_versions_id_seq',
  'projects_id_seq',
  'users_id_seq',
] as const

const payloadMigrationLedgerSql = `
CREATE TABLE public.payload_migrations (
    id integer NOT NULL,
    name character varying,
    batch numeric,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.payload_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.payload_migrations_id_seq OWNED BY public.payload_migrations.id;
ALTER TABLE ONLY public.payload_migrations ALTER COLUMN id SET DEFAULT nextval('public.payload_migrations_id_seq'::regclass);
ALTER TABLE ONLY public.payload_migrations
    ADD CONSTRAINT payload_migrations_pkey PRIMARY KEY (id);
CREATE INDEX payload_migrations_created_at_idx ON public.payload_migrations USING btree (created_at);
CREATE INDEX payload_migrations_updated_at_idx ON public.payload_migrations USING btree (updated_at);
`

type BaselineContract = {
  tables: Map<string, Set<string>>
  enums: Set<string>
  sequences: Set<string>
  indexes: Set<string>
  constraints: Set<string>
}

function captureNames(source: string, pattern: RegExp): Set<string> {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]))
}

export function parseBaselineContract(source: string): BaselineContract {
  if (/^\s*(?:\\|SET\s|SELECT\s+pg_catalog\.set_config\()/m.test(source)) {
    throw new Error('The WebCraft schema baseline must not contain psql meta-commands or session-level setup statements.')
  }

  const tables = new Map<string, Set<string>>()
  const tablePattern = /CREATE TABLE public\.([A-Za-z_][A-Za-z0-9_]*) \(\r?\n([\s\S]*?)\r?\n\);/g
  for (const match of source.matchAll(tablePattern)) {
    const [, tableName, body] = match
    const columns = new Set<string>()
    for (const line of body.split(/\r?\n/)) {
      const column = /^\s{4}("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+/.exec(line)
      if (!column) throw new Error(`Unable to parse a column in the WebCraft baseline table ${tableName}.`)
      columns.add(column[1].replaceAll('"', ''))
    }
    if (tables.has(tableName) || columns.size === 0) throw new Error(`Invalid or duplicate WebCraft baseline table: ${tableName}.`)
    tables.set(tableName, columns)
  }

  const enums = captureNames(source, /CREATE TYPE public\.([A-Za-z_][A-Za-z0-9_]*) AS ENUM/g)
  const sequences = captureNames(source, /CREATE SEQUENCE public\.([A-Za-z_][A-Za-z0-9_]*)\b/g)
  const indexes = captureNames(source, /CREATE (?:UNIQUE )?INDEX ([A-Za-z_][A-Za-z0-9_]*) ON public\./g)
  const constraints = captureNames(source, /ADD CONSTRAINT ([A-Za-z_][A-Za-z0-9_]*)\s/g)

  if (tables.has('payload_migrations') || sequences.has('payload_migrations_id_seq')) {
    throw new Error('The WebCraft schema baseline must not create Payload migration-ledger objects.')
  }
  if (
    tables.size !== requiredTables.length
    || requiredTables.some((name) => !tables.has(name))
    || enums.size !== requiredEnums.length
    || requiredEnums.some((name) => !enums.has(name))
    || sequences.size !== requiredSequences.length
    || requiredSequences.some((name) => !sequences.has(name))
    || indexes.size === 0
    || constraints.size === 0
  ) {
    throw new Error('The WebCraft initial schema SQL resource does not match the expected application schema inventory.')
  }

  return { tables, enums, sequences, indexes, constraints }
}

function missingNames(required: Iterable<string>, rows: Array<Record<string, unknown>>): string[] {
  const found = new Set(rows.map((row) => String(row.name)))
  return [...required].filter((name) => !found.has(name))
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const baseline = await readFile(new URL('./20261123_060000_initial_schema.sql', import.meta.url), 'utf8')
  const contract = parseBaselineContract(baseline)
  const tableList = sql.join(requiredTables.map((name) => sql`${name}`), sql`, `)

  const tables = await db.execute(sql`
    SELECT table_name AS name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> 'payload_migrations'
  `)
  const enums = await db.execute(sql`
    SELECT t.typname AS name
    FROM pg_type AS t
    JOIN pg_namespace AS n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  `)
  const sequences = await db.execute(sql`
    SELECT sequence_name AS name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
      AND sequence_name <> 'payload_migrations_id_seq'
  `)
  const migrationLedger = await db.execute(sql`
    SELECT to_regclass('public.payload_migrations') IS NOT NULL AS exists
  `)
  const hasPayloadMigrationLedger = Boolean(migrationLedger.rows[0]?.exists)

  if (tables.rows.length === 0 && enums.rows.length === 0 && sequences.rows.length === 0) {
    if (!hasPayloadMigrationLedger) await db.execute(sql.raw(payloadMigrationLedgerSql))
    await db.execute(sql.raw(baseline))
    return
  }

  const columns = await db.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN (${tableList})
  `)
  const indexes = await db.execute(sql`
    SELECT indexname AS name
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN (${tableList})
  `)
  const constraints = await db.execute(sql`
    SELECT constraint_name AS name
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name IN (${tableList})
  `)

  const missingTables = missingNames(requiredTables, tables.rows)
  const missingEnums = missingNames(requiredEnums, enums.rows)
  const missingSequences = missingNames(requiredSequences, sequences.rows)
  const actualColumns = new Map<string, Set<string>>()
  for (const row of columns.rows) {
    const tableName = String(row.table_name)
    const tableColumns = actualColumns.get(tableName) ?? new Set<string>()
    tableColumns.add(String(row.column_name))
    actualColumns.set(tableName, tableColumns)
  }
  const missingColumns: string[] = []
  for (const [tableName, expectedColumns] of contract.tables) {
    const foundColumns = actualColumns.get(tableName) ?? new Set<string>()
    for (const columnName of expectedColumns) {
      if (!foundColumns.has(columnName)) missingColumns.push(`${tableName}.${columnName}`)
    }
  }
  const missingIndexes = missingNames(contract.indexes, indexes.rows)
  const missingConstraints = missingNames(contract.constraints, constraints.rows)

  if (
    missingTables.length || missingEnums.length || missingSequences.length
    || missingColumns.length || missingIndexes.length || missingConstraints.length
  ) {
    const missing = [
      ...(missingTables.length ? [`tables: ${missingTables.join(', ')}`] : []),
      ...(missingEnums.length ? [`enum types: ${missingEnums.join(', ')}`] : []),
      ...(missingSequences.length ? [`sequences: ${missingSequences.join(', ')}`] : []),
      ...(missingColumns.length ? [`columns: ${missingColumns.join(', ')}`] : []),
      ...(missingIndexes.length ? [`indexes: ${missingIndexes.join(', ')}`] : []),
      ...(missingConstraints.length ? [`constraints: ${missingConstraints.join(', ')}`] : []),
    ]
    throw new Error(
      `Cannot apply the WebCraft initial schema baseline to a non-empty partial database. Missing ${missing.join('; ')}. No schema objects or records were changed. Restore a complete backup or use a fresh, dedicated WebCraft database.`,
    )
  }

  // A schema push may already have created the complete current schema. Leave it and all data untouched.
  // Payload's migration runner needs its ledger table to record this migration after `up` returns.
  if (!hasPayloadMigrationLedger) await db.execute(sql.raw(payloadMigrationLedgerSql))
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'The WebCraft initial schema baseline is intentionally irreversible. It will not drop tables or data; restore a database backup or use a fresh, dedicated database to reset the installation.',
  )
}
