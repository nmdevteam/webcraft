import { randomUUID } from 'node:crypto'
import { chmod, copyFile, constants, link, lstat, mkdir, readFile, readdir, rmdir, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

const cwd = process.cwd()
const legacyDir = resolve(cwd, 'public/media')
const storageRoot = resolve(cwd, '.webcraft')
const privateDir = resolve(storageRoot, 'media')

async function ensureDirectory(path, label) {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory; migration stopped.`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await mkdir(path, { mode: 0o700 })
  }
}

await ensureDirectory(storageRoot, 'Private storage root')
await ensureDirectory(privateDir, 'Private media directory')
await chmod(privateDir, 0o700)

let legacyInfo
try {
  legacyInfo = await lstat(legacyDir)
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.log('No legacy public media directory found; private media storage is ready.')
    process.exit(0)
  }
  throw error
}
if (legacyInfo.isSymbolicLink() || !legacyInfo.isDirectory()) throw new Error('Legacy media path must be a real directory; migration stopped.')

const names = await readdir(legacyDir)
const entries = []

// Preflight every source and destination before moving any file. This makes
// conflicts fail safely without leaving a partially migrated directory.
for (const filename of names) {
  if (filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\')) throw new Error('Unsafe legacy media filename; migration stopped.')
  const source = resolve(legacyDir, filename)
  const destination = resolve(privateDir, filename)
  const sourceInfo = await lstat(source)
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) throw new Error(`Unexpected non-file in legacy media directory: ${filename}`)

  let destinationExists = false
  try {
    const destinationInfo = await lstat(destination)
    if (destinationInfo.isSymbolicLink() || !destinationInfo.isFile()) throw new Error(`Unsafe destination for ${filename}; migration stopped.`)
    const [oldBytes, newBytes] = await Promise.all([readFile(source), readFile(destination)])
    if (!oldBytes.equals(newBytes)) throw new Error(`A different private media file already exists as ${filename}; migration stopped without overwriting either file.`)
    destinationExists = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  entries.push({ filename, source, destination, destinationExists })
}

for (const entry of entries) {
  const { filename, source, destination, destinationExists } = entry
  if (destinationExists) {
    await unlink(source)
    continue
  }

  const stage = resolve(privateDir, `.migration-${process.pid}-${randomUUID()}`)
  try {
    const sourceInfo = await lstat(source)
    if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) throw new Error(`Legacy source changed during migration: ${filename}`)
    await copyFile(source, stage, constants.COPYFILE_EXCL)
    const [sourceBytes, stagedBytes] = await Promise.all([readFile(source), readFile(stage)])
    if (!sourceBytes.equals(stagedBytes)) throw new Error(`Legacy source changed while copying: ${filename}`)

    try {
      await link(stage, destination)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const destinationInfo = await lstat(destination)
      if (destinationInfo.isSymbolicLink() || !destinationInfo.isFile()) throw new Error(`Unsafe destination appeared during migration: ${filename}`)
      const [sourceNow, destinationNow] = await Promise.all([readFile(source), readFile(destination)])
      if (!sourceNow.equals(destinationNow)) throw new Error(`A different private media file appeared as ${filename}; neither file was overwritten.`)
    }

    const destinationInfo = await lstat(destination)
    if (destinationInfo.isSymbolicLink() || !destinationInfo.isFile()) throw new Error(`Unsafe destination after migration: ${filename}`)
    const [sourceNow, destinationNow] = await Promise.all([readFile(source), readFile(destination)])
    if (!sourceNow.equals(destinationNow)) throw new Error(`Could not verify migrated media file: ${filename}`)
    await unlink(source)
  } catch (error) {
    throw new Error(`Migration stopped at ${filename}; rerun the migration after resolving the reported issue. ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    await unlink(stage).catch((error) => { if (error?.code !== 'ENOENT') throw error })
  }
}

await rmdir(legacyDir)
console.log(`Migrated ${entries.length} legacy upload${entries.length === 1 ? '' : 's'} into private .webcraft/media storage.`)
