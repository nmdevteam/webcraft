import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

function isWithin(root, target) {
  const relativePath = relative(resolve(root), resolve(target))
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

function isApiOrMedia(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/media' || pathname.startsWith('/media/')
}

async function sendStatic(req, res, builderRoot, rootRealPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed')
  let decodedPath
  try { decodedPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname) } catch { return sendText(res, 400, 'Invalid path') }
  if (decodedPath.includes('\0') || decodedPath.includes('\\')) return sendText(res, 400, 'Invalid path')
  const segments = decodedPath.split('/')
  if (segments.some((segment) => segment.startsWith('.'))) return sendText(res, 404, 'Not found')

  const requested = decodedPath === '/' ? resolve(builderRoot, 'index.html') : resolve(builderRoot, `.${decodedPath}`)
  if (!isWithin(builderRoot, requested)) return sendText(res, 404, 'Not found')
  let candidate = requested
  let info
  try {
    info = await lstat(candidate)
    if (info.isSymbolicLink()) return sendText(res, 404, 'Not found')
    if (info.isDirectory()) {
      candidate = resolve(candidate, 'index.html')
      info = await lstat(candidate)
      if (info.isSymbolicLink()) return sendText(res, 404, 'Not found')
    }
    if (!info.isFile()) throw Object.assign(new Error('Not found'), { code: 'ENOENT' })
    if (!isWithin(rootRealPath, await realpath(candidate))) return sendText(res, 404, 'Not found')
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') return sendText(res, 500, 'Could not read this file')
    if (extname(decodedPath)) return sendText(res, 404, 'Not found')
    candidate = resolve(builderRoot, 'index.html')
    try {
      info = await lstat(candidate)
      if (!info.isFile() || info.isSymbolicLink() || !isWithin(rootRealPath, await realpath(candidate))) return sendText(res, 404, 'Not found')
    } catch { return sendText(res, 404, 'Not found') }
  }

  const extension = extname(candidate).toLowerCase()
  const isIndex = candidate.toLowerCase() === resolve(builderRoot, 'index.html').toLowerCase()
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME_TYPES.get(extension) ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  if (req.method === 'HEAD') return res.end()
  const stream = createReadStream(candidate)
  stream.on('error', () => { if (!res.headersSent) sendText(res, 500, 'Could not read this file'); else res.destroy() })
  stream.pipe(res)
}

export async function createWebCraftServer({ builderDir, cmsOrigin, host = '127.0.0.1' }) {
  const builderRoot = resolve(builderDir)
  const rootStat = await lstat(builderRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('The bundled builder directory is not safe.')
  const rootRealPath = await realpath(builderRoot)
  const cms = new URL(cmsOrigin)
  if (cms.protocol !== 'http:' || !['127.0.0.1', '::1'].includes(cms.hostname)) throw new Error('The CMS origin must use HTTP on loopback only.')

  const server = createHttpServer((req, res) => {
    let url
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) return sendText(res, 400, 'Invalid request URL')
    try { url = new URL(req.url, 'http://127.0.0.1') } catch { return sendText(res, 400, 'Invalid request URL') }
    if (url.origin !== 'http://127.0.0.1') return sendText(res, 400, 'Invalid request URL')

    if (url.pathname === '/__webcraft/health') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end('{"status":"ok"}')
    }

    if (isApiOrMedia(url.pathname)) {
      const upstream = httpRequest(new URL(req.url, cms), {
        method: req.method,
        headers: {
          ...req.headers,
          host: cms.host,
          'x-forwarded-host': req.headers.host ?? '',
          'x-forwarded-proto': 'http',
        },
      }, (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(res)
      })
      upstream.on('error', () => { if (!res.headersSent) sendText(res, 502, 'The local CMS is unavailable'); else res.destroy() })
      req.pipe(upstream)
      return
    }

    void sendStatic(req, res, builderRoot, rootRealPath)
  })

  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'))
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const builderDir = process.env.WEBCRAFT_BUILDER_DIR
  const cmsOrigin = process.env.WEBCRAFT_CMS_ORIGIN
  const port = Number(process.env.WEBCRAFT_APP_PORT || 5173)
  if (!builderDir || !cmsOrigin || !Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('Set WEBCRAFT_BUILDER_DIR, WEBCRAFT_CMS_ORIGIN, and a valid WEBCRAFT_APP_PORT before starting the server.')
    process.exit(2)
  }
  const server = await createWebCraftServer({ builderDir, cmsOrigin })
  server.listen(port, '127.0.0.1', () => console.log(`WebCraft builder is available at http://127.0.0.1:${port}`))
}
