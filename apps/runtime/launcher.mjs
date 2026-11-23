import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { constants as fsConstants, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWebCraftServer } from './server.mjs'

const runtimeDir = dirname(fileURLToPath(import.meta.url))
const nodeExe = resolve(runtimeDir, 'node', 'node.exe')
const postgresRoot = resolve(runtimeDir, 'postgres')
const postgresBin = resolve(postgresRoot, 'bin')
const pgCtl = resolve(postgresBin, 'pg_ctl.exe')
const initdb = resolve(postgresBin, 'initdb.exe')
const createdb = resolve(postgresBin, 'createdb.exe')
const psql = resolve(postgresBin, 'psql.exe')
const logsDirName = 'logs'
const PUBLIC_HOST = '127.0.0.1'
const DB_NAME = 'webcraft'
const DB_USER = 'webcraft'
const SECRET_BYTES = 48

function fail(message) { throw new Error(message) }
function parsePort(value, fallback) {
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('A WebCraft port override is invalid.')
  return port
}

async function exists(path) {
  try { await access(path, fsConstants.F_OK); return true } catch { return false }
}

async function isPortAvailable(port) {
  const net = await import('node:net')
  const server = net.createServer()
  return await new Promise((resolvePromise) => {
    server.once('error', () => resolvePromise(false))
    server.listen(port, PUBLIC_HOST, () => server.close(() => resolvePromise(true)))
  })
}

async function findPort(preferred, start, end) {
  if (await isPortAvailable(preferred)) return preferred
  for (let port = start; port <= end; port += 1) if (await isPortAvailable(port)) return port
  fail('No free local port is available for WebCraft. Close another local service and try again.')
}

function getDataRoot() {
  if (process.env.WEBCRAFT_DATA_DIR) return resolve(process.env.WEBCRAFT_DATA_DIR)
  const local = process.env.LOCALAPPDATA || process.env.APPDATA || homedir()
  return resolve(local, 'WebCraft')
}

function validConfig(value) {
  return value && value.version === 1
    && typeof value.databasePassword === 'string' && /^[A-Za-z0-9_-]{32,100}$/.test(value.databasePassword)
    && typeof value.payloadSecret === 'string' && value.payloadSecret.length >= 32 && value.payloadSecret.length <= 200
    && typeof value.webcraftSecret === 'string' && value.webcraftSecret.length >= 32 && value.webcraftSecret.length <= 200
    && value.ports && ['database', 'cms', 'app'].every((key) => Number.isInteger(value.ports[key]) && value.ports[key] >= 1024 && value.ports[key] <= 65535)
}

async function saveConfig(path, config) {
  const temp = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  try { await rename(temp, path) } catch (error) { await unlink(temp).catch(() => undefined); throw error }
}

async function loadConfig(dataRoot) {
  const configPath = resolve(dataRoot, 'runtime.json')
  if (await exists(configPath)) {
    let config
    try { config = JSON.parse(await readFile(configPath, 'utf8')) } catch { fail(`WebCraft runtime settings are unreadable. Back up ${configPath} before repairing them.`) }
    if (!validConfig(config)) fail(`WebCraft runtime settings are invalid. Back up ${configPath} before repairing them.`)
    return { path: configPath, config }
  }
  const config = {
    version: 1,
    databasePassword: randomBytes(SECRET_BYTES).toString('base64url'),
    payloadSecret: randomBytes(SECRET_BYTES).toString('base64url'),
    webcraftSecret: randomBytes(SECRET_BYTES).toString('base64url'),
    ports: {
      database: parsePort(process.env.WEBCRAFT_DB_PORT, 55432),
      cms: parsePort(process.env.WEBCRAFT_CMS_PORT, 3000),
      app: parsePort(process.env.WEBCRAFT_APP_PORT, 5173),
    },
  }
  await saveConfig(configPath, config)
  return { path: configPath, config }
}

function runCommand(executable, args, { cwd, env, timeoutMs = 120_000, logPath } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const log = logPath ? createWriteStream(logPath, { flags: 'a', mode: 0o600 }) : null
    child.stdout.on('data', (chunk) => {
      if (log) log.write(chunk)
      else stdout = (stdout + chunk.toString()).slice(-16_384)
    })
    child.stderr.on('data', (chunk) => {
      if (log) log.write(chunk)
      else stderr = (stderr + chunk.toString()).slice(-16_384)
    })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); log?.end(); rejectPromise(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      const finish = () => {
        if (timedOut) return rejectPromise(new Error('A required WebCraft setup command timed out.'))
        if (code !== 0) return rejectPromise(new Error(`A required WebCraft setup command failed (exit ${code}).${logPath ? ` See ${logPath}.` : ''}`))
        resolvePromise({ stdout, stderr })
      }
      if (log && !log.closed) {
        log.once('close', finish)
        log.end()
      } else finish()
    })
  })
}

async function runChecked(executable, args, options) {
  try { return await runCommand(executable, args, options) } catch (error) { throw error }
}

function startChild(executable, args, { cwd, env, logPath }) {
  const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 })
  const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  child.once('close', () => log.end())
  return child
}

async function acquireLock(dataRoot) {
  const lockPath = resolve(dataRoot, 'runtime.lock')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      await handle.writeFile(`${process.pid}\n`)
      await handle.close()
      return lockPath
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const pid = Number.parseInt(await readFile(lockPath, 'utf8').catch(() => ''), 10)
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); fail('WebCraft is already running. Use its existing browser window or close the other WebCraft console first.') }
        catch (probeError) { if (probeError?.code !== 'ESRCH') throw probeError }
      }
      await unlink(lockPath).catch(() => undefined)
    }
  }
  fail('WebCraft could not acquire its local startup lock.')
}

async function choosePorts(config, configPath, dataRoot, pgIsRunning) {
  const preferred = {
    database: parsePort(process.env.WEBCRAFT_DB_PORT, config.ports.database),
    cms: parsePort(process.env.WEBCRAFT_CMS_PORT, config.ports.cms),
    app: parsePort(process.env.WEBCRAFT_APP_PORT, config.ports.app),
  }
  const database = pgIsRunning ? config.ports.database : await findPort(preferred.database, 55_432, 55_500)
  const cms = await findPort(preferred.cms, 31_000, 31_100)
  const app = await findPort(preferred.app, 51_730, 51_830)
  const updated = { ...config, ports: { database, cms, app } }
  if (JSON.stringify(updated.ports) !== JSON.stringify(config.ports)) await saveConfig(configPath, updated)
  return updated
}

async function setUpPostgres(config, dataRoot, logsDir) {
  const pgData = resolve(dataRoot, 'postgres')
  const pgLog = resolve(logsDir, 'postgres.log')
  const pgCtlLog = resolve(logsDir, 'postgres-control.log')
  const initialized = await exists(resolve(pgData, 'PG_VERSION'))
  if (!initialized) {
    if (await exists(pgData)) {
      const files = await (await import('node:fs/promises')).readdir(pgData)
      if (files.length) fail(`The PostgreSQL data directory is incomplete. Back it up before repairing it: ${pgData}`)
    }
    await mkdir(pgData, { recursive: true })
    if (process.platform === 'win32') {
      const currentUser = (await runCommand('whoami.exe', [], { cwd: dataRoot, timeoutMs: 5_000 })).stdout.trim()
      if (!currentUser || /[\r\n]/.test(currentUser)) fail('WebCraft could not determine the current Windows account to secure the local PostgreSQL data directory.')
      await runChecked('icacls.exe', [pgData, '/grant', `${currentUser}:(OI)(CI)F`], { cwd: dataRoot, timeoutMs: 30_000, logPath: pgLog })
    }
    const passwordFile = resolve(dataRoot, `.db-password-${process.pid}-${randomBytes(6).toString('hex')}.tmp`)
    await writeFile(passwordFile, `${config.databasePassword}\n`, { flag: 'wx', mode: 0o600 })
    try {
      await runChecked(initdb, ['-D', pgData, '-U', DB_USER, '--encoding=UTF8', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--pwfile', passwordFile], { cwd: dataRoot, timeoutMs: 180_000, logPath: pgLog })
    } finally { await unlink(passwordFile).catch(() => undefined) }
  }

  const pgCtlEnv = { PATH: `${postgresBin}${process.env.PATH ? `;${process.env.PATH}` : ''}` }
  const status = await runCommand(pgCtl, ['-D', pgData, 'status'], { cwd: dataRoot, env: pgCtlEnv, timeoutMs: 20_000 }).then(() => true, () => false)
  if (!status) {
    const options = `-h ${PUBLIC_HOST} -p ${config.ports.database} -c listen_addresses=${PUBLIC_HOST}`
    await runChecked(pgCtl, ['-D', pgData, '-l', pgLog, '-o', options, '-w', 'start'], { cwd: dataRoot, env: pgCtlEnv, timeoutMs: 90_000, logPath: pgCtlLog })
  }

  const psqlEnv = { ...pgCtlEnv, PGPASSWORD: config.databasePassword }
  const databaseExists = await runCommand(psql, ['-X', '-A', '-t', '-w', '-h', PUBLIC_HOST, '-p', String(config.ports.database), '-U', DB_USER, '-d', 'postgres', '-c', `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`], { cwd: dataRoot, env: psqlEnv, timeoutMs: 30_000 }).then(({ stdout }) => stdout.trim() === '1', () => false)
  if (!databaseExists) {
    await runChecked(createdb, ['-w', '-h', PUBLIC_HOST, '-p', String(config.ports.database), '-U', DB_USER, DB_NAME], { cwd: dataRoot, env: psqlEnv, timeoutMs: 30_000, logPath: pgCtlLog })
  }
  return { pgData, pgLog, pgCtlEnv }
}

function makeCmsEnv(config, dataRoot, cmsPort, appPort) {
  const cmsOrigin = `http://${PUBLIC_HOST}:${cmsPort}`
  const builderOrigin = `http://${PUBLIC_HOST}:${appPort}`
  const databaseUrl = `postgres://${DB_USER}:${encodeURIComponent(config.databasePassword)}@${PUBLIC_HOST}:${config.ports.database}/${DB_NAME}`
  return {
    NODE_ENV: 'production',
    HOSTNAME: PUBLIC_HOST,
    PORT: String(cmsPort),
    DATABASE_URL: databaseUrl,
    PAYLOAD_SECRET: config.payloadSecret,
    WEBCRAFT_SECRET: config.webcraftSecret,
    WEBCRAFT_DATA_DIR: dataRoot,
    CMS_URL: cmsOrigin,
    BUILDER_ORIGIN: builderOrigin,
    PAYLOAD_CONFIG_PATH: 'payload.config.ts',
    PATH: `${postgresBin}${process.env.PATH ? `;${process.env.PATH}` : ''}`,
  }
}

async function waitForHealth(url, child, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) fail('The local CMS stopped during startup. Check the WebCraft logs in the user data folder.')
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000), cache: 'no-store' })
      if (response.ok) return
    } catch { /* wait for the local server */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  fail('WebCraft did not become ready in time. Check the WebCraft logs in the user data folder.')
}

async function openBrowser(url) {
  if (process.env.WEBCRAFT_NO_BROWSER === '1') return
  if (process.platform !== 'win32') {
    console.log(`Open ${url} in your browser.`)
    return
  }
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', url], { windowsHide: true, stdio: 'ignore' })
  child.unref()
}

async function main() {
  for (const path of [nodeExe, pgCtl, initdb, createdb, psql]) if (!(await exists(path))) fail(`A required WebCraft runtime file is missing: ${path}`)
  const manifestPath = resolve(runtimeDir, 'manifest.json')
  let manifest
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch { fail('The WebCraft runtime manifest is missing or invalid.') }
  if (typeof manifest.cmsDir !== 'string' || typeof manifest.builderDir !== 'string') fail('The WebCraft runtime manifest is missing required paths.')
  const cmsDir = resolve(runtimeDir, manifest.cmsDir)
  const builderDir = resolve(runtimeDir, manifest.builderDir)
  const nextCli = resolve(cmsDir, 'node_modules/next/dist/bin/next')
  const payloadCli = resolve(cmsDir, 'node_modules/payload/bin.js')
  for (const path of [nextCli, payloadCli, resolve(cmsDir, 'payload.config.ts'), resolve(cmsDir, 'scripts/migrate-media.mjs'), resolve(builderDir, 'index.html')]) {
    if (!(await exists(path))) fail(`A required WebCraft app file is missing: ${path}`)
  }

  const dataRoot = getDataRoot()
  await mkdir(dataRoot, { recursive: true, mode: 0o700 })
  const logsDir = resolve(dataRoot, logsDirName)
  await mkdir(logsDir, { recursive: true, mode: 0o700 })
  const lockPath = await acquireLock(dataRoot)
  let config
  let pgData
  let pgCtlEnv
  let cmsChild
  let appServer
  let isStopping = false

  let cleanupPromise
  const cleanup = (exitCode = 0) => {
    if (cleanupPromise) return cleanupPromise
    isStopping = true
    cleanupPromise = (async () => {
      if (appServer?.listening) await new Promise((resolvePromise) => appServer.close(() => resolvePromise()))
      if (cmsChild && cmsChild.exitCode === null) {
        if (process.platform === 'win32') {
          await new Promise((resolvePromise) => {
            const kill = spawn('taskkill.exe', ['/PID', String(cmsChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
            kill.once('close', resolvePromise)
            kill.once('error', resolvePromise)
          })
        } else {
          cmsChild.kill('SIGTERM')
          await new Promise((resolvePromise) => { const timeout = setTimeout(resolvePromise, 5_000); cmsChild.once('close', () => { clearTimeout(timeout); resolvePromise() }) })
        }
      }
      if (pgData && pgCtlEnv) {
        await runCommand(pgCtl, ['-D', pgData, '-m', 'fast', '-w', 'stop'], { cwd: dataRoot, env: pgCtlEnv, timeoutMs: 45_000, logPath: resolve(logsDir, 'postgres-control.log') }).catch(() => undefined)
      }
      const lockPid = Number.parseInt(await readFile(lockPath, 'utf8').catch(() => ''), 10)
      if (lockPid === process.pid) await unlink(lockPath).catch(() => undefined)
      if (exitCode !== 0) process.exitCode = exitCode
    })()
    return cleanupPromise
  }

  process.once('SIGINT', () => { void cleanup(0) })
  process.once('SIGTERM', () => { void cleanup(0) })

  try {
    const configState = await loadConfig(dataRoot)
    config = configState.config
    const priorPgStatus = await runCommand(pgCtl, ['-D', resolve(dataRoot, 'postgres'), 'status'], { cwd: dataRoot, timeoutMs: 20_000 }).then(() => true, () => false)
    config = await choosePorts(config, configState.path, dataRoot, priorPgStatus)
    pgData = resolve(dataRoot, 'postgres')
    pgCtlEnv = { PATH: `${postgresBin}${process.env.PATH ? `;${process.env.PATH}` : ''}` }
    console.log('Preparing the local PostgreSQL database...')
    const db = await setUpPostgres(config, dataRoot, logsDir)
    pgData = db.pgData
    pgCtlEnv = db.pgCtlEnv
    const cmsEnv = makeCmsEnv(config, dataRoot, config.ports.cms, config.ports.app)

    console.log('Applying WebCraft database migrations...')
    await runChecked(nodeExe, [resolve(cmsDir, 'node_modules/payload/bin.js'), 'migrate'], { cwd: cmsDir, env: cmsEnv, timeoutMs: 180_000, logPath: resolve(logsDir, 'migrations.log') })
    await runChecked(nodeExe, [resolve(cmsDir, 'scripts/migrate-media.mjs')], { cwd: cmsDir, env: cmsEnv, timeoutMs: 30_000, logPath: resolve(logsDir, 'media-migration.log') })

    console.log('Starting the local WebCraft CMS...')
    cmsChild = startChild(nodeExe, [nextCli, 'start', '--hostname', PUBLIC_HOST, '--port', String(config.ports.cms)], { cwd: cmsDir, env: cmsEnv, logPath: resolve(logsDir, 'cms.log') })
    cmsChild.once('error', () => { void cleanup(1) })
    cmsChild.once('close', (code) => { if (!isStopping) { console.error(`The local CMS stopped (exit ${code ?? 'unknown'}). Check ${resolve(logsDir, 'cms.log')}.`); void cleanup(code || 1) } })
    const cmsOrigin = `http://${PUBLIC_HOST}:${config.ports.cms}`
    await waitForHealth(`${cmsOrigin}/api/health`, cmsChild)

    console.log('The CMS is ready; starting the WebCraft builder...')
    appServer = await createWebCraftServer({ builderDir, cmsOrigin })
    await new Promise((resolvePromise, rejectPromise) => {
      appServer.once('error', rejectPromise)
      appServer.listen(config.ports.app, PUBLIC_HOST, resolvePromise)
    })
    const appUrl = `http://${PUBLIC_HOST}:${config.ports.app}`
    await waitForHealth(`${appUrl}/api/health`, cmsChild)
    console.log(`WebCraft is ready at ${appUrl}`)
    console.log(`Local data and logs: ${dataRoot}`)
    console.log('Keep this window open while using WebCraft. Press Ctrl+C here to stop its local services.')
    await openBrowser(appUrl)
    await new Promise((resolvePromise) => {
      if (cmsChild.exitCode !== null) return resolvePromise()
      cmsChild.once('close', resolvePromise)
      process.once('SIGINT', resolvePromise)
      process.once('SIGTERM', resolvePromise)
    })
    await cleanup(cmsChild.exitCode === null ? 0 : (cmsChild.exitCode || 1))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'WebCraft could not start.')
    console.error(`See logs in ${logsDir}. Your local data was not removed.`)
    await cleanup(1)
  }
}

await main()
