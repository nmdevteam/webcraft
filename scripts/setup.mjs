import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { resolve } from 'node:path'

const path = resolve(process.cwd(), '.env')
const make = () => randomBytes(48).toString('base64url')
if (!existsSync(path)) {
  const example = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8')
  const content = example
    .replace('replace-with-a-long-random-password', make())
    .replace('replace-with-at-least-32-random-bytes', make())
    .replace('replace-with-at-least-32-random-bytes', make())
  writeFileSync(path, content, { mode: 0o600, flag: 'wx' })
  chmodSync(path, 0o600)
  console.log('Created .env with unique local secrets (mode 0600). Keep it out of Git.')
} else {
  console.log('.env already exists; left unchanged.')
}
