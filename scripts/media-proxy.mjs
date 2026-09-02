// Shared media proxy, used by BOTH the Vite dev server (vite.config.js) and
// the standalone production server (server.mjs), so the two never drift.
import { Readable } from 'node:stream'
//
// The browser can't fetch arbitrary remote media directly — CORS forbids it,
// and some instances require the Authorization header. This endpoint accepts
// `GET /media-proxy?url=<encoded>` and proxies the resource back to the
// client: it forwards the caller's Authorization header upstream (so tokens
// are only ever used toward the origin the browser already decided to send
// them to) and returns the body with permissive CORS so <img>/<video> and
// blob fetches work cross-origin.

// Single choke point for sending a plain-text response. Every exit path goes
// through here, so a second writeHead on an already-sent response — the thing
// that used to crash servers on flaky connections — cannot happen by
// construction.
function respondOnce(res, status, text) {
  if (res.headersSent || res.destroyed || res.writableEnded) return
  try {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(text)
  } catch {
    try { res.destroy() } catch { /* already dead */ }
  }
}

// Insert the Authorization header from the inbound request into the fetch to
// the target, but only if the caller is hitting the resource on the same host
// they authenticated against. The browser already gates this before it ever
// sends the header here (see the client media fetcher), so this is a second,
// defensive line — never proactively forward to arbitrary hosts.
function upstreamHeaders(req) {
  const headers = {}
  const auth = req.headers.authorization
  if (auth) headers['Authorization'] = auth
  const cookie = req.headers.cookie
  if (cookie) headers['Cookie'] = cookie
  return headers
}

// Parse and validate the `url` query parameter. Returns a URL object or
// null. SSRF guard: only http(s) targets may be proxied — without this the
// server would be an open proxy (and a way to hit internal addresses).
function parseTarget(reqUrl) {
  const url = new URL(reqUrl, 'http://localhost')
  const target = url.searchParams.get('url')
  if (!target) return null
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed
}

// Handle one /media-proxy request. Works with both Connect-style middleware
// (Vite dev) and node:http request/response objects, which share the
// Surface used here (writeHead/end/headersSent/destroyed/writableEnded).
export async function handleMediaProxy(req, res, { fetchImpl = fetch } = {}) {
  if (res.destroyed || res.writableEnded) return
  const target = parseTarget(req.url || '/')
  if (!target) {
    respondOnce(res, 400, 'Missing or invalid url parameter')
    return
  }
  try {
    const proxyRes = await fetchImpl(target.toString(), {
      headers: upstreamHeaders(req),
      redirect: 'follow',
    })
    if (res.headersSent || res.destroyed || res.writableEnded) return
    const ct = proxyRes.headers.get('content-type') || 'application/octet-stream'
    try {
      // Derive a Content-Disposition filename so the browser's "Save Image
      // as…" dialog shows a meaningful name instead of "media-proxy.ext".
      // Chrome only respects `attachment` (not `inline`) for the save-dialog
      // filename, and <img> still renders regardless of the disposition type.
      // Cross-browser: emit both filename (ASCII) and filename* (RFC 5987)
      // for maximum compatibility (Safari, Firefox, Chrome all support it).
      //
      // 1. Mastodon format:  /original/filename.ext
      // 2. Last path segment for direct file URLs (Pleroma, etc.)
      // 3. Upstream Content-Disposition as fallback (Mitra proxy URLs)
      let filename = null
      const mOriginal = target.pathname.match(/\/original\/([^/?#]+)/)
      if (mOriginal) {
        filename = mOriginal[1]
      } else {
        const mLast = target.pathname.match(/\/([^/?#]+)$/)
        if (mLast && /\.\w{2,5}$/.test(mLast[1])) filename = mLast[1]
      }
      if (!filename) {
        const upstreamCD = proxyRes.headers.get('content-disposition')
        if (upstreamCD) {
          // Prefer filename* (RFC 5987) for proper UTF-8 support
          const mStar = upstreamCD.match(/filename\*\s*=\s*(?:UTF-8''|[^']*'[^']*')([^;\n]+)/i)
          if (mStar) {
            try { filename = decodeURIComponent(mStar[1].trim()) } catch { /* ignore */ }
          }
          if (!filename) {
            const mPlain = upstreamCD.match(/filename="?([^";\n]+)"?/i)
            if (mPlain) filename = mPlain[1].trim()
          }
        }
      }
      const safeName = filename ? filename.replace(/"/g, '') : ''
      const cd = safeName
        ? `attachment; filename="${safeName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
        : ''
      res.writeHead(proxyRes.status, {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
        ...(cd ? { 'Content-Disposition': cd } : {}),
      })
    } catch {
      try { res.destroy() } catch { /* already dead */ }
      return
    }
    // Headers are out — past this point a failure can only end in tearing
    // the socket down, never in writing new headers.
    try {
      // Stream the upstream body through instead of buffering the whole
      // file: a large video/audio attachment used to cost two full copies
      // in server RAM (arrayBuffer() + Buffer.from()). Node's fetch exposes
      // a web ReadableStream; a mocked fetch (tests) may only have the
      // buffered path, so keep that as the fallback.
      if (proxyRes.body && typeof proxyRes.body.getReader === 'function') {
        const readable = Readable.fromWeb(proxyRes.body)
        // Tearing the connection down is the only valid failure response
        // once the headers are out; swallowing the error would leave the
        // socket hanging.
        readable.on('error', () => {
          try { res.destroy() } catch { /* already dead */ }
        })
        res.on('close', () => readable.destroy())
        readable.pipe(res)
        return
      }
      const body = Buffer.from(await proxyRes.arrayBuffer())
      if (res.writableEnded || res.destroyed) return
      res.end(body)
    } catch {
      try { res.destroy() } catch { /* already dead */ }
    }
  } catch {
    respondOnce(res, 502, 'Proxy fetch failed')
  }
}
