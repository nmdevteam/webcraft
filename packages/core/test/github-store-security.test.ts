import { createCipheriv, scryptSync } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const secret = 'synthetic-webcraft-secret-' + 's'.repeat(32)
const token = 'ghp_' + 'synthetic-token-' + 't'.repeat(32)
const login = 'synthetic-user'
let workdir: string
let tempRoot: string
let originalCwd: string
let originalSecret: string | undefined
let store: typeof import('../../../apps/cms/src/lib/github-store')

function pathToStore() { return join(workdir, '../../.webcraft/github-token.enc') }

beforeEach(async () => {
  vi.resetModules()
  originalCwd = process.cwd()
  originalSecret = process.env.WEBCRAFT_SECRET
  tempRoot = mkdtempSync(join(tmpdir(), 'webcraft-github-store-'))
  workdir = join(tempRoot, 'one', 'two')
  mkdirSync(workdir, { recursive: true })
  process.chdir(workdir)
  process.env.WEBCRAFT_SECRET = secret
  store = await import('../../../apps/cms/src/lib/github-store')
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(tempRoot, { recursive: true, force: true })
  if (originalSecret === undefined) delete process.env.WEBCRAFT_SECRET
  else process.env.WEBCRAFT_SECRET = originalSecret
})

describe('GitHub token store persistence hardening', () => {
  it('round-trips v2 without writing plaintext and uses private modes', () => {
    store.saveGitHubToken(token, login)
    const file = pathToStore()
    const serialized = readFileSync(file, 'utf8')
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain(login + ':' + token)
    expect(JSON.parse(serialized).version).toBe(2)
    expect(statSync(join(workdir, '../../.webcraft')).mode & 0o777).toBe(0o700)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(store.readGitHubToken()).toEqual({ token, login })
  })

  it('rejects wrong secrets and tampered ciphertext or authenticated metadata', () => {
    store.saveGitHubToken(token, login)
    const file = pathToStore()
    const original = JSON.parse(readFileSync(file, 'utf8'))
    const tamper = (change: Record<string, unknown>) => writeFileSync(file, JSON.stringify({ ...original, ...change }), { mode: 0o600 })
    tamper({ ciphertext: Buffer.from('tampered').toString('base64') })
    expect(() => store.readGitHubToken()).toThrow()
    writeFileSync(file, JSON.stringify(original), { mode: 0o600 })
    tamper({ login: 'attacker' })
    expect(() => store.readGitHubToken()).toThrow()
    writeFileSync(file, JSON.stringify(original), { mode: 0o600 })
    process.env.WEBCRAFT_SECRET = 'wrong-secret-' + 'w'.repeat(32)
    expect(() => store.readGitHubToken()).toThrow()
  })

  it('reads historical v1 records and migrates them to v2 on the safe read path', () => {
    const iv = Buffer.alloc(12, 7)
    const cipher = createCipheriv('aes-256-gcm', scryptSync(secret, 'webcraft-github-token-v1', 32), iv)
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
    mkdirSync(join(workdir, '../../.webcraft'), { recursive: true, mode: 0o700 })
    writeFileSync(pathToStore(), JSON.stringify({ login, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }), { mode: 0o600 })
    expect(store.readGitHubToken()).toEqual({ token, login })
    const migrated = JSON.parse(readFileSync(pathToStore(), 'utf8'))
    expect(migrated.version).toBe(2)
    expect(migrated).not.toHaveProperty('token')
    expect(store.readGitHubToken()).toEqual({ token, login })
  })

  it('uses fresh salt and IV for each save', () => {
    store.saveGitHubToken(token, login)
    const first = JSON.parse(readFileSync(pathToStore(), 'utf8'))
    store.saveGitHubToken(token, login)
    const second = JSON.parse(readFileSync(pathToStore(), 'utf8'))
    expect(second.salt).not.toBe(first.salt)
    expect(second.iv).not.toBe(first.iv)
  })

  it('rejects malformed fields instead of attempting decryption', () => {
    store.saveGitHubToken(token, login)
    const file = pathToStore()
    const record = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, JSON.stringify({ ...record, salt: 'not-base64' }), { mode: 0o600 })
    expect(() => store.readGitHubToken()).toThrow(/Invalid GitHub token record/)
    writeFileSync(file, JSON.stringify(record), { mode: 0o600 })
    chmodSync(file, 0o644)
    expect(store.readGitHubToken()).toEqual({ token, login })
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})
