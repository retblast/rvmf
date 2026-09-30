// Shared media proxy, used by BOTH the Vite dev server (vite.config.js) and
// the standalone production server (server.mjs), so the two never drift.
import { Readable } from 'node:stream'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
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

const UPSTREAM_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5

// Targets the proxy refuses unless the caller explicitly opted into
// private networks (dev server, or MEDIA_PROXY_ALLOW_PRIVATE for
// self-hosters whose instance lives on the LAN). These ranges never
// appear as federated media origins — they're exactly what an SSRF
// bounce aims at: cloud metadata endpoints, router admin panels, and
// other loopback services that a deployed proxy can reach but the
// request's originator cannot.
function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64/10
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  // IPv4-mapped v6 arrives in either form; WHATWG URL canonicalizes
  // ::ffff:127.0.0.1 into ::ffff:7f00:1, so decode both.
  const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1])
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16)
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  const firstWord = parseInt(lower.split(':')[0], 16) || 0
  if ((firstWord & 0xfe00) === 0xfc00) return true // fc00::/7 ULA
  if ((firstWord & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  return false
}

async function assertPublicTarget(url, allowPrivate) {
  if (allowPrivate) return
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '0.0.0.0') {
    throw Object.assign(new Error('private host'), { code: 'PRIVATE_TARGET' })
  }
  const kind = isIP(hostname)
  if (kind === 4 || kind === 6) {
    const priv = kind === 4 ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname)
    if (priv) throw Object.assign(new Error('private host'), { code: 'PRIVATE_TARGET' })
    return
  }
  // A public-looking name can still resolve into private space
  // (DNS rebind style); validate every address it resolves to.
  const addrs = await lookup(hostname, { all: true })
  for (const { address } of addrs) {
    const priv = isIP(address) === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address)
    if (priv) throw Object.assign(new Error('private host'), { code: 'PRIVATE_TARGET' })
  }
}

// Fetch with SSRF-safe redirect handling: every hop of the redirect
// chain is re-validated against the private-range rules — a public first
// hop that bounces to 169.254.169.254 is the classic proxy bypass.
// Each hop carries a hard timeout so a slow-hostile upstream can't pin
// sockets open indefinitely.
async function fetchUpstream(target, headers, fetchImpl, allowPrivate) {
  let current = target
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicTarget(current, allowPrivate)
    const res = await fetchImpl(current.toString(), {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location')
      if (!loc || hop === MAX_REDIRECTS) throw new Error('bad redirect chain')
      current = new URL(loc, current)
      continue
    }
    return { res, url: current }
  }
  throw new Error('too many redirects')
}

// Inline-safe content types: the media the app actually renders in
// <img>/<video>/<audio> elements. Everything else — most importantly
// text/html and image/svg+xml, both of which can carry script — is
// forced to a download. A proxied response renders on the rvmf origin,
// so an inline HTML/SVG response is stored XSS: one crafted
// /media-proxy?url=... link in a DM and the attacker's markup runs
// next to the localStorage session token.
function isInlineMediaType(ct) {
  const [type] = String(ct).split(';')
  const t = type.trim().toLowerCase()
  if (t === 'image/svg+xml') return false
  return /^(image|video|audio)\//.test(t)
}

// Handle one /media-proxy request. Works with both Connect-style middleware
// (Vite dev) and node:http request/response objects, which share the
// Surface used here (writeHead/end/headersSent/destroyed/writableEnded).
export async function handleMediaProxy(req, res, { fetchImpl = fetch, allowPrivate = false } = {}) {
  if (res.destroyed || res.writableEnded) return
  const target = parseTarget(req.url || '/')
  if (!target) {
    respondOnce(res, 400, 'Missing or invalid url parameter')
    return
  }
  try {
    const { res: proxyRes, url: finalUrl } = await fetchUpstream(
      target, upstreamHeaders(req), fetchImpl, allowPrivate
    )
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
      const mOriginal = finalUrl.pathname.match(/\/original\/([^/?#]+)/)
      if (mOriginal) {
        filename = mOriginal[1]
      } else {
        const mLast = finalUrl.pathname.match(/\/([^/?#]+)$/)
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
      // Belt and braces on every proxied response: nosniff stops content-
      // type guessing, and a sandboxing CSP renders any sniffed-through
      // document inert even if a future content-type bug slips past the
      // safelist below.
      const headers = {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        "Content-Security-Policy": "default-src 'none'; sandbox",
      }
      if (isInlineMediaType(ct)) {
        // Renderable media keeps the save-as filename when one exists.
        if (cd) headers['Content-Disposition'] = cd
      } else {
        // Anything scriptable (html, svg, xml, text…) downloads instead
        // of rendering same-origin.
        headers['Content-Disposition'] = cd || 'attachment'
      }
      res.writeHead(proxyRes.status, headers)
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
  } catch (err) {
    if (err?.code === 'PRIVATE_TARGET') {
      respondOnce(res, 400, 'Refusing to proxy private addresses')
      return
    }
    respondOnce(res, 502, 'Proxy fetch failed')
  }
}
