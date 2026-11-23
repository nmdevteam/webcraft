import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

async function assertNoDuplicates(db: MigrateUpArgs['db']) {
  const slugDuplicates = await db.execute(sql`
    SELECT project_id, slug, COUNT(*)::int AS duplicate_count
    FROM pages
    GROUP BY project_id, slug
    HAVING COUNT(*) > 1
    LIMIT 1
  `)
  if (slugDuplicates.rows.length) {
    throw new Error('Cannot install WebCraft integrity indexes: duplicate page slugs already exist within a project. Resolve the duplicate rows manually, then rerun this migration; no records were changed.')
  }

  const homepageDuplicates = await db.execute(sql`
    SELECT project_id, COUNT(*)::int AS duplicate_count
    FROM pages
    WHERE is_home IS TRUE
    GROUP BY project_id
    HAVING COUNT(*) > 1
    LIMIT 1
  `)
  if (homepageDuplicates.rows.length) {
    throw new Error('Cannot install WebCraft integrity indexes: a project already has multiple homepages. Choose one homepage per project, then rerun this migration; no records were changed.')
  }

  const folderDuplicates = await db.execute(sql`
    SELECT project_id, LOWER(name) AS normalized_name, COUNT(*)::int AS duplicate_count
    FROM asset_folders
    GROUP BY project_id, LOWER(name)
    HAVING COUNT(*) > 1
    LIMIT 1
  `)
  if (folderDuplicates.rows.length) {
    throw new Error('Cannot install WebCraft integrity indexes: folder names differ only by case within a project. Rename or remove the duplicate folders manually, then rerun this migration; no records were changed.')
  }
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await assertNoDuplicates(db)

  await db.execute(sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS expected_revision double precision`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS webcraft_pages_project_slug_uidx ON pages (project_id, slug)`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS webcraft_pages_one_homepage_uidx ON pages (project_id) WHERE is_home IS TRUE`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS webcraft_asset_folders_project_name_ci_uidx ON asset_folders (project_id, LOWER(name))`)
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION webcraft_check_page_revision() RETURNS trigger AS $$
    BEGIN
      IF NEW.expected_revision IS NULL
        OR NEW.expected_revision < 0
        OR NEW.expected_revision <> FLOOR(NEW.expected_revision)
        OR NEW.expected_revision <> OLD.revision THEN
        RAISE EXCEPTION 'WEBCRAFT_PAGE_REVISION_CONFLICT'
          USING ERRCODE = '40001';
      END IF;
      NEW.revision := OLD.revision + 1;
      NEW.expected_revision := NULL;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `)
  await db.execute(sql`DROP TRIGGER IF EXISTS webcraft_pages_revision_guard ON pages`)
  await db.execute(sql`
    CREATE TRIGGER webcraft_pages_revision_guard
    BEFORE UPDATE ON pages
    FOR EACH ROW EXECUTE FUNCTION webcraft_check_page_revision()
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TRIGGER IF EXISTS webcraft_pages_revision_guard ON pages`)
  await db.execute(sql`DROP FUNCTION IF EXISTS webcraft_check_page_revision()`)
  await db.execute(sql`DROP INDEX IF EXISTS webcraft_pages_project_slug_uidx`)
  await db.execute(sql`DROP INDEX IF EXISTS webcraft_pages_one_homepage_uidx`)
  await db.execute(sql`DROP INDEX IF EXISTS webcraft_asset_folders_project_name_ci_uidx`)
  await db.execute(sql`ALTER TABLE pages DROP COLUMN IF EXISTS expected_revision`)
}
