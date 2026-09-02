#!/usr/bin/env node
// Standalone production server for the built app (dist/). Serves the static
// bundle on any host/port and provides the same /media-proxy endpoint the
// Vite dev server does, so remote media renders identically in production.
//
// Usage:  node server.mjs              (or: npm run serve)
// Env:    HOST=0.0.0.0  PORT=4173  RVMF_DIST=./dist
//
// Put this behind a reverse proxy (Caddy/nginx) that terminates TLS and you
// have a subdomain install — see the README's "Deployment" section.
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleMediaProxy } from './scripts/media-proxy.mjs'
import { MAX_PORT, nextPort, portClimbedNotice } from './src/lib/port-utils.js'

const HOST = process.env.HOST || '0.0.0.0'
const PORT = Number(process.env.PORT || 4173)

// Auto-port: when the configured port is already taken (a dev reload of the
// running instance, another process, etc.) we climb to the next free port and
// print a visible notice instead of crashing on EADDRINUSE.
let currentPort = PORT
const DIST_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  process.env.RVMF_DIST || 'dist'
)

// Vite emits fingerprinted assets under /assets/; those can be cached
// forever. Everything else (notably index.html) is short-lived so clients
// pick up redeploys quickly.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

// Resolve a request path to a file inside DIST_DIR, refusing anything that
// would escape it (path traversal) and normalizing "dir" requests to
// index.html, so unknown routes still load the SPA.
function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath)
  const root = path.resolve(DIST_DIR)
  // Vite assets are referenced relative to the document root; keep this
  // simple and always map onto the dist directory.
  let file = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '')
  if (file === '/' || file === '') file = '/index.html'
  if (file.endsWith('/')) file += 'index.html'
  const resolved = path.resolve(root, file.startsWith('/') ? file.slice(1) : file)
  // Prevent escaping the dist root without relying on path prefix tricks.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

async function serveStatic(res, urlPath) {
  const filePath = resolveRequestPath(urlPath)
  if (!filePath) {
    res.writeHead(403).end('Forbidden')
    return
  }
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    // Missing file: fall back to index.html so client-side navigation and
    // deep links work. /assets/* files are real and must stay 404 — serving
    // HTML for a missing chunk just hides the failure.
    if (urlPath.startsWith('/assets/')) {
      res.writeHead(404).end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    createReadStream(path.join(DIST_DIR, 'index.html')).pipe(res)
    return
  }
  if (!stat.isFile()) {
    res.writeHead(404).end('Not found')
    return
  }
  const ext = path.extname(filePath).toLowerCase()
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' }
  if (urlPath.startsWith('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  else headers['Cache-Control'] = 'no-cache'
  res.writeHead(200, headers)
  createReadStream(filePath).pipe(res)
}

const server = createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0]
  if (urlPath === '/media-proxy' || urlPath === '/media-proxy/') {
    handleMediaProxy(req, res).catch(() => {
      try { res.destroy() } catch { /* already dead */ }
    })
    return
  }
  serveStatic(res, urlPath)
})

// Log the real bound port. Reading it from server.address() (rather than a
// closure over the requested port) keeps this honest: with auto-climb the
// requested port and the bound port can differ, and reusing one server object
// for the retry means a stale listen callback can fire with the old port.
server.on('listening', () => {
  const addr = server.address()
  const port = addr && typeof addr === 'object' ? addr.port : currentPort
  console.log(`rvmf server listening on http://${HOST}:${port}`)
  console.log(`serving ${DIST_DIR}`)
})

// Climb on EADDRINUSE. Rely on listen() errors (rather than a pre-flight
// socket probe) so bind and check are one atomic step — no TOCTOU gap where
// two processes race to claim the same port and both "win" the probe.
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err
  const next = nextPort(currentPort)
  if (next === null || next > MAX_PORT) {
    console.error(`Port ${currentPort} is in use and no free port is available in the valid range.`)
    process.exit(1)
  }
  console.log(portClimbedNotice(currentPort, next))
  currentPort = next
  server.listen(currentPort, HOST)
})

server.listen(PORT, HOST)
