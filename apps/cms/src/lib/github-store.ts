import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Stored = { login: string; iv: string; tag: string; ciphertext: string }
const storeDir = resolve(process.cwd(), '../../.webcraft')
const storePath = resolve(storeDir, 'github-token.enc')
function encryptionKey() {
  const secret = process.env.WEBCRAFT_SECRET
  if (!secret || secret.length < 32) throw new Error('WEBCRAFT_SECRET is missing or too short')
  return scryptSync(secret, 'webcraft-github-token-v1', 32)
}
export function saveGitHubToken(token: string, login: string) {
  mkdirSync(storeDir, { recursive: true, mode: 0o700 })
  chmodSync(storeDir, 0o700)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const record: Stored = { login, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
  const temp = `${storePath}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' })
  chmodSync(temp, 0o600)
  renameSync(temp, storePath)
  chmodSync(storePath, 0o600)
}
export function readGitHubToken(): { token: string; login: string } | null {
  if (!existsSync(storePath)) return null
  const record = JSON.parse(readFileSync(storePath, 'utf8')) as Stored
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
  const token = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  return { token, login: record.login }
}
export function disconnectGitHub() { if (existsSync(storePath)) unlinkSync(storePath) }
