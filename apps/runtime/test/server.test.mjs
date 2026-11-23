import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { createWebCraftServer } from '../server.mjs'

let tempRoot
let builderDir
let cmsServer
let appServer
let appOrigin
let cmsRequests
let cmsOrigin

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function close(server) {
  if (!server?.listening) return
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'webcraft-runtime-test-'))
  builderDir = join(tempRoot, 'builder')
  await mkdir(builderDir)
  await writeFile(join(builderDir, 'index.html'), '<!doctype html><title>WebCraft test</title>')
  await mkdir(join(builderDir, 'assets'))
  await writeFile(join(builderDir, 'assets', 'app.js'), 'window.webcraftTest = true;')
  await writeFile(join(tempRoot, 'secret.txt'), 'must not be exposed')
  cmsRequests = []
  cmsServer = createHttpServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      cmsRequests.push({ method: req.method, url: req.url, body, host: req.headers.host })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'x-webcraft-cms': 'reached' })
      res.end(JSON.stringify({ method: req.method, url: req.url, body }))
    })
  })
  const cmsPort = await listen(cmsServer)
  cmsOrigin = `http://127.0.0.1:${cmsPort}`
  appServer = await createWebCraftServer({ builderDir, cmsOrigin })
  const appPort = await listen(appServer)
  appOrigin = `http://127.0.0.1:${appPort}`
})

afterEach(async () => {
  await close(appServer)
  await close(cmsServer)
  await rm(tempRoot, { recursive: true, force: true })
})

test('serves the builder index and client routes with defensive headers', async () => {
  const root = await fetch(appOrigin)
  assert.equal(root.status, 200)
  assert.match(root.headers.get('content-type'), /^text\/html/)
  assert.equal(root.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(root.headers.get('x-frame-options'), 'DENY')
  assert.match(await root.text(), /WebCraft test/)

  const route = await fetch(`${appOrigin}/project/new-page`)
  assert.equal(route.status, 200)
  assert.match(await route.text(), /WebCraft test/)
})

test('serves built assets and returns 404 for missing files with extensions', async () => {
  const asset = await fetch(`${appOrigin}/assets/app.js`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type'), /^text\/javascript/)
  assert.equal(await asset.text(), 'window.webcraftTest = true;')

  const missing = await fetch(`${appOrigin}/assets/missing.js`)
  assert.equal(missing.status, 404)
})

test('proxies API and media requests, preserving method, path, query, and body', async () => {
  const response = await fetch(`${appOrigin}/api/projects?limit=2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"name":"smoke"}',
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-webcraft-cms'), 'reached')
  assert.deepEqual(await response.json(), {
    method: 'POST',
    url: '/api/projects?limit=2',
    body: '{"name":"smoke"}',
  })
  assert.equal(cmsRequests[0].host, new URL(cmsOrigin).host)

  const media = await fetch(`${appOrigin}/media/generated/logo.png`)
  assert.equal(media.status, 200)
  assert.equal((await media.json()).url, '/media/generated/logo.png')
})

test('does not expose traversal paths or accept backslashes as static paths', async () => {
  const traversal = await fetch(`${appOrigin}/%252e%252e/secret.txt`)
  assert.equal(traversal.status, 404)
  assert.doesNotMatch(await traversal.text(), /must not be exposed/)

  const backslash = await fetch(`${appOrigin}/%5c..%5csecret.txt`)
  assert.equal(backslash.status, 400)
})

test('rejects absolute-form request targets rather than proxying back into itself', async () => {
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: new URL(appOrigin).port,
      method: 'GET',
      path: `${appOrigin}/api/health`,
    }, resolve)
    request.once('error', reject)
    request.end()
  })
  assert.equal(response.statusCode, 400)
  response.resume()
})

test('rejects public or non-HTTP CMS origins', async () => {
  await assert.rejects(createWebCraftServer({ builderDir, cmsOrigin: 'https://example.com' }), /loopback only/)
  await assert.rejects(createWebCraftServer({ builderDir, cmsOrigin: 'http://example.com:3000' }), /loopback only/)
})
