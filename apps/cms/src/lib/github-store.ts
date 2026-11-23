import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { getGitHubStoreDir, getGitHubStorePath } from './storage-paths'

type V1Stored = { login: string; iv: string; tag: string; ciphertext: string }
type V2Stored = { version: 2; login: string; salt: string; iv: string; tag: string; ciphertext: string }
type Stored = V1Stored | V2Stored

const storeDir = getGitHubStoreDir()
const storePath = getGitHubStorePath()
const V1_SALT = 'webcraft-github-token-v1'
const MAX_RECORD_BYTES = 1_000_000
const MAX_LOGIN_LENGTH = 100
const MAX_TOKEN_LENGTH = 500

function secret(): string {
  const value = process.env.WEBCRAFT_SECRET
  if (!value || value.length < 32) throw new Error('WEBCRAFT_SECRET is missing or too short')
  return value
}

function keyV1() {
  return scryptSync(secret(), V1_SALT, 32)
}

function keyV2(salt: Buffer) {
  return scryptSync(secret(), salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 })
}

function assertString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\u0000')) throw new Error(`Invalid GitHub token record: ${field}`)
  return value
}

function decodeBase64(value: unknown, field: string, exactLength?: number) {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error(`Invalid GitHub token record: ${field}`)
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value || (exactLength !== undefined && decoded.length !== exactLength)) throw new Error(`Invalid GitHub token record: ${field}`)
  return decoded
}

function parseRecord(serialized: string): Stored {
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) throw new Error('Invalid GitHub token record')
  let value: unknown
  try { value = JSON.parse(serialized) } catch { throw new Error('Invalid GitHub token record') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid GitHub token record')
  const record = value as Record<string, unknown>
  const login = assertString(record.login, 'login', MAX_LOGIN_LENGTH)
  if (record.version === 2) {
    if (Object.keys(record).sort().join(',') !== 'ciphertext,iv,login,salt,tag,version') throw new Error('Invalid GitHub token record')
    const salt = decodeBase64(record.salt, 'salt', 16)
    const iv = decodeBase64(record.iv, 'iv', 12)
    const tag = decodeBase64(record.tag, 'tag', 16)
    const ciphertext = decodeBase64(record.ciphertext, 'ciphertext')
    if (ciphertext.length === 0) throw new Error('Invalid GitHub token record')
    return { version: 2, login, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'), ciphertext: ciphertext.toString('base64') }
  }
  if ('version' in record || Object.keys(record).sort().join(',') !== 'ciphertext,iv,login,tag') throw new Error('Invalid GitHub token record')
  const iv = decodeBase64(record.iv, 'iv', 12)
  const tag = decodeBase64(record.tag, 'tag', 16)
  const ciphertext = decodeBase64(record.ciphertext, 'ciphertext')
  if (ciphertext.length === 0) throw new Error('Invalid GitHub token record')
  return { login, iv: iv.toString('base64'), tag: tag.toString('base64'), ciphertext: ciphertext.toString('base64') }
}

function decrypt(record: Stored): string {
  const isV2 = 'version' in record
  const iv = Buffer.from(record.iv, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', isV2 ? keyV2(Buffer.from(record.salt, 'base64')) : keyV1(), iv)
  if (isV2) decipher.setAAD(Buffer.from(`webcraft-github-token:v2:${record.version}:${record.login}`, 'utf8'))
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
  let token: string
  try {
    token = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  } catch { throw new Error('Unable to decrypt GitHub token record') }
  if (!token || token.length > MAX_TOKEN_LENGTH || token.includes('\u0000') || token.includes('\ufffd')) throw new Error('Invalid decrypted GitHub token')
  return token
}

function atomicWrite(content: string) {
  mkdirSync(storeDir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(storeDir, 0o700)
  const temp = `${storePath}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(temp, 'wx', 0o600)
    writeFileSync(fd, content, { encoding: 'utf8' })
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    if (process.platform !== 'win32') chmodSync(temp, 0o600)
    renameSync(temp, storePath)
    if (process.platform !== 'win32') chmodSync(storePath, 0o600)
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (existsSync(temp)) unlinkSync(temp)
  }
}

export function saveGitHubToken(token: string, login: string) {
  assertString(token, 'token', MAX_TOKEN_LENGTH)
  assertString(login, 'login', MAX_LOGIN_LENGTH)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyV2(salt), iv)
  cipher.setAAD(Buffer.from('webcraft-github-token:v2:2:' + login, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const record: V2Stored = { version: 2, login, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
  atomicWrite(JSON.stringify(record))
}

export function readGitHubToken(): { token: string; login: string } | null {
  if (!existsSync(storePath)) return null
  let record: Stored
  try {
    const file = readFileSync(storePath, 'utf8')
    if (process.platform !== 'win32' && (statSync(storePath).mode & 0o777) !== 0o600) chmodSync(storePath, 0o600)
    record = parseRecord(file)
    const token = decrypt(record)
    if (!('version' in record)) saveGitHubToken(token, record.login)
    return { token, login: record.login }
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('Invalid') || error.message.startsWith('Unable'))) throw error
    throw new Error('Unable to read GitHub token record')
  }
}

export function disconnectGitHub() { if (existsSync(storePath)) unlinkSync(storePath) }
