import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { ensureGifConverted } from './lib/gif/convert.js'

// A handful of cross-cutting display preferences that MediaItem needs deep
// in the tree (timeline post, nested reply, notification preview, panel —
// four+ levels of prop drilling for something this minor isn't worth it).
// Persisted so it survives a reload.
export const AppSettingsContext = createContext({
  hoverPreviewsEnabled: true,
  fetchClientMedia: false,
  gifConversionEnabled: false,
  gifIncludeLarge: false,
  gifHoverAnimate: false,
})
export const PickerContext = createContext({ openPickerId: null, setOpenPickerId: () => {} })

// Transient confirmation toast. Fire-and-forget from anywhere via a
// window event — avoids prop-drilling a dispatcher through every row.
export function showToast(message) {
  window.dispatchEvent(new CustomEvent('rvmf-toast', { detail: message }))
}

// Blob URLs fetched through the dev proxy are cached so scrolling back
// doesn't refetch them. Object URLs are never GC'd while alive, so the
// cache is bounded by BOTH an entry count and a byte budget: the oldest
// entries are revoked once either cap is exceeded. Displaying rows hold
// a lease (see useClientMedia) so eviction skips blob URLs still in use
// and only falls back to revoking a live URL when every entry is leased.
const CLIENT_MEDIA_CACHE_MAX = 150
const CLIENT_MEDIA_CACHE_MAX_BYTES = 256 * 1024 * 1024
const clientMediaCache = new Map() // url -> { blobUrl, size }
const clientMediaLeases = new Map() // blobUrl -> active-mount count

// Failed URLs are remembered briefly so scrolling doesn't re-request
// them every time a row remounts — this is what keeps the dev console
// from flooding with media-proxy 404s for pruned/broken media.
const FAILED_URL_TTL_MS = 60_000
const failedMediaUrls = new Map() // url -> first-failed timestamp

function isUrlKnownFailed(url) {
  const failedAt = failedMediaUrls.get(url)
  if (!failedAt) return false
  if (Date.now() - failedAt > FAILED_URL_TTL_MS) {
    failedMediaUrls.delete(url)
    return false
  }
  return true
}

function markUrlFailed(url) {
  if (!failedMediaUrls.has(url)) failedMediaUrls.set(url, Date.now())
}

export { isUrlKnownFailed, markUrlFailed }

// Concurrent mounts of the same image (timeline + open thread panel,
// avatar reused across rows) share one request instead of racing.
// Resolves to a blob object URL, or null when the URL is known-bad.
const inflightMediaFetches = new Map() // url -> Promise<blobUrl|null>

function requestMediaBlob(fetchBlobFn, url) {
  const cached = getCachedClientMedia(url)
  if (cached) return Promise.resolve(cached)
  if (isUrlKnownFailed(url)) return Promise.resolve(null)
  let promise = inflightMediaFetches.get(url)
  if (!promise) {
    promise = (async () => {
      try {
        const blob = await fetchBlobFn(url)
        if (!blob) {
          markUrlFailed(url)
          return null
        }
        const blobUrl = URL.createObjectURL(blob)
        cacheClientMedia(url, blobUrl, blob.size)
        return blobUrl
      } catch {
        markUrlFailed(url)
        return null
      } finally {
        inflightMediaFetches.delete(url)
      }
    })()
    inflightMediaFetches.set(url, promise)
  }
  return promise
}

function getCachedClientMedia(url) {
  if (!clientMediaCache.has(url)) return undefined
  const entry = clientMediaCache.get(url)
  clientMediaCache.delete(url)
  clientMediaCache.set(url, entry) // refresh insertion order (recency)
  return entry.blobUrl
}

// ---- Lease helpers -------------------------------------------------------
// Active consumers (mounted MediaItem rows) hold a lease on the blob URL
// they're displaying. Eviction skips leased entries so a URL is never
// revoked out from under a live <img>/<video>; only when the entire cache
// is leased does the byte cap win over a live URL.

function leaseClientMedia(blobUrl) {
  clientMediaLeases.set(blobUrl, (clientMediaLeases.get(blobUrl) || 0) + 1)
}

function unleaseClientMedia(blobUrl) {
  const count = clientMediaLeases.get(blobUrl)
  if (!count) return
  if (count <= 1) clientMediaLeases.delete(blobUrl)
  else clientMediaLeases.set(blobUrl, count - 1)
}

function revokeClientMedia(url, entry) {
  clientMediaCache.delete(url)
  clientMediaLeases.delete(entry.blobUrl)
  URL.revokeObjectURL(entry.blobUrl)
}

function cacheClientMedia(url, blobUrl, size) {
  if (clientMediaCache.has(url)) {
    // Same URL re-cached (shouldn't normally happen — requestMediaBlob
    // short-circuits on hits — but a replaced blob must not leak).
    const prev = clientMediaCache.get(url)
    if (prev.blobUrl !== blobUrl) URL.revokeObjectURL(prev.blobUrl)
    clientMediaCache.delete(url)
  }
  const entry = { blobUrl, size: size || 0 }
  clientMediaCache.set(url, entry)
  let totalBytes = 0
  for (const e of clientMediaCache.values()) totalBytes += e.size
  while (clientMediaCache.size > CLIENT_MEDIA_CACHE_MAX || totalBytes > CLIENT_MEDIA_CACHE_MAX_BYTES) {
    if (clientMediaCache.size === 0) break
    // Oldest entry nobody is displaying; if every entry is leased, fall
    // back to plain LRU so the caps still hold.
    let victimKey = null
    for (const [key, e] of clientMediaCache) {
      if (!clientMediaLeases.has(e.blobUrl)) { victimKey = key; break }
    }
    if (victimKey == null) victimKey = clientMediaCache.keys().next().value
    const victim = clientMediaCache.get(victimKey)
    totalBytes -= victim.size
    revokeClientMedia(victimKey, victim)
  }
}

export function proxyUrl(url) {
  return `/media-proxy?url=${encodeURIComponent(url)}`
}

export function safeProxyUrl(url) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('/')) return url
  return proxyUrl(url)
}

// ---- Media download -----------------------------------------------------
// The display pipeline fetches blobs through the dev proxy; downloads want
// the same bytes, so they reuse the same credential guard: only send the
// bearer token toward the user's own instance, never to third-party hosts
// (the proxy forwards the header upstream as-is). Rejects non-media content
// so an HTML error/prune page is never saved as a real file.

function fetchMediaBinary(url, instanceUrl, token) {
  const headers = {}
  if (token && instanceUrl && url.startsWith(instanceUrl)) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  return fetch(proxyUrl(url), { headers, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

async function fetchDownloadableMedia(url, instanceUrl, token) {
  const res = await fetchMediaBinary(url, instanceUrl, token)
  if (!res.ok) return null
  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  if (contentType.startsWith('text/') || contentType === 'application/json') return null
  return { blob: await res.blob(), contentType }
}

// Candidate URLs for an attachment's bytes, best-first: display URL, origin
// URL, then the origin URL Mitra hides inside its signed proxy link.
export function attachmentDownloadUrls(att) {
  const urls = [att.url, att.remote_url, att._remote_fallback].filter(Boolean)
  // Dedupe while preserving order.
  return [...new Set(urls)]
}

// A safe, descriptive file name derived from the attachment id/type and the
// content type, so saves are recognizable instead of ambiguous "download".
export function filenameForAttachment(att, contentType) {
  const extMap = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg', 'audio/wav': 'wav', 'application/octet-stream': 'bin',
  }
  const mime = (contentType || '').split(';')[0].trim().toLowerCase()
  const ext = extMap[mime] || (att.type === 'image' ? 'jpg' : 'bin')
  const base = (att.id && String(att.id).replace(/[^a-zA-Z0-9_-]/g, '_')) || 'media'
  return `${base}.${ext}`
}

// Save a single attachment to disk. Returns true on success, false if every
// candidate URL failed (unreachable, timeout, or non-media body).
export async function downloadAttachment(att, { instanceUrl, token }) {
  for (const url of attachmentDownloadUrls(att)) {
    try {
      const media = await fetchDownloadableMedia(url, instanceUrl, token)
      if (!media) continue
      const blobUrl = URL.createObjectURL(media.blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filenameForAttachment(att, media.contentType)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(blobUrl)
      return true
    } catch {
      // try the next candidate URL
    }
  }
  return false
}

// Download every attachment in a list. Multiple programmatic downloads are
// only allowed if triggered in separate tasks, so space them out. Shared by
// the per-post "Download media" action now, and the account-wide media sweep
// later — just pass a flattened attachment list.
export async function downloadAllMedia(attachments, opts) {
  const list = Array.isArray(attachments) ? attachments : []
  for (const att of list) {
    await downloadAttachment(att, opts)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

// Positions a floating preview near the cursor, clamped so it never runs
// off the edge of the viewport.
export function useCursorPreview(previewWidth = 320, previewHeight = 320) {
  const [pos, setPos] = useState(null)

  function track(e) {
    const margin = 16
    let x = e.clientX + 18
    let y = e.clientY + 18
    if (x + previewWidth + margin > window.innerWidth) x = e.clientX - previewWidth - 18
    if (y + previewHeight + margin > window.innerHeight) y = e.clientY - previewHeight - 18
    setPos({ x, y })
  }
  function clear() {
    setPos(null)
  }

  return { pos, track, clear }
}

export function useClientMedia(...args) {
  const { instanceUrl, token } = useContext(AppSettingsContext)
  const resolveUrls = typeof args[args.length - 1] === 'function' ? args.pop() : null
  const urls = args
  const key = urls.filter(Boolean).join('\0')

  function fetchMedia(url) {
    const headers = {}
    // Only send the token toward our own instance — never to third-party
    // hosts. The dev proxy forwards this header upstream as-is.
    if (token && instanceUrl && url.startsWith(instanceUrl)) {
      headers['Authorization'] = `Bearer ${token}`
    }
    // Timeout so a dead connection can't pin a media slot on blurhash
    // forever — the negative cache remembers the failure briefly.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    return fetch(proxyUrl(url), { headers, signal: controller.signal })
      .finally(() => clearTimeout(timer))
  }

  // An "ok" response can still be garbage: when an origin prunes a file it
  // often serves an HTML error page with status 200. Caching that as a blob
  // yields silently broken images, so treat non-media content types as a
  // miss (octet-stream is allowed — some servers mislabel real media).
  async function fetchMediaBlob(url) {
    const res = await fetchMedia(url)
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (contentType.startsWith('text/') || contentType === 'application/json') return null
    return await res.blob()
  }

  const [state, setState] = useState(() => {
    if (!key) return { blobUrl: null, loading: false, error: false }
    for (const u of urls) {
      if (u) {
        const cached = getCachedClientMedia(u)
        if (cached) return { blobUrl: cached, loading: false, error: false }
      }
    }
    return { blobUrl: null, loading: true, error: false }
  })

  useEffect(() => {
    if (!key) return
    // Blob URLs this mount is displaying. Held as leases so cache eviction
    // never revokes a URL out from under a live <img>/<video>; released on
    // unmount.
    const leased = new Set()
    function acquire(blobUrl) {
      if (!blobUrl || leased.has(blobUrl)) return
      leaseClientMedia(blobUrl)
      leased.add(blobUrl)
    }
    function releaseAll() {
      for (const u of leased) unleaseClientMedia(u)
    }

    for (const u of urls) {
      if (u) {
        const cached = getCachedClientMedia(u)
        if (cached) {
          acquire(cached)
          setState({ blobUrl: cached, loading: false, error: false })
          return releaseAll
        }
      }
    }

    let cancelled = false
    async function load() {
      for (const u of urls) {
        if (!u) continue
        const blobUrl = await requestMediaBlob(fetchMediaBlob, u)
        if (blobUrl) {
          if (!cancelled) { acquire(blobUrl); setState({ blobUrl, loading: false, error: false }) }
          return
        }
      }
      if (resolveUrls && !cancelled) {
        try {
          const extra = await resolveUrls()
          for (const u of (extra || [])) {
            if (!u) continue
            const blobUrl = await requestMediaBlob(fetchMediaBlob, u)
            if (blobUrl) {
              if (!cancelled) { acquire(blobUrl); setState({ blobUrl, loading: false, error: false }) }
              return
            }
          }
        } catch { /* resolver failures fall through to the error state */ }
      }
      if (!cancelled) setState({ blobUrl: null, loading: false, error: true })
    }
    load()
    return () => { cancelled = true; releaseAll() }
  }, [key])

  return state
}

// Convert a GIF URL into a playable AV1/VP9 WebM (see lib/gif). Returns
// { status, videoUrl }: 'static' when the feature is off, the browser
// can't encode, or the conversion was skipped/failed; 'ready' with an
// object URL of the encoded blob otherwise. The object URL is created and
// revoked per mount; the underlying Blob is shared through the IndexedDB
// cache, so dozens of rows can display the same GIF without re-encoding.
export function useGifVideo(src, { active = false, includeLarge = false } = {}) {
  const { instanceUrl, token } = useContext(AppSettingsContext)
  const [state, setState] = useState({ status: 'static', videoUrl: null })
  const key = src || ''

  useEffect(() => {
    if (!active || !key) {
      setState({ status: 'static', videoUrl: null })
      return undefined
    }
    let cancelled = false
    let objectUrl = null
    ensureGifConverted(key, { instanceUrl, token, includeLarge })
      .then((converted) => {
        if (cancelled) return
        if (!converted?.blob) {
          setState({ status: 'static', videoUrl: null })
          return
        }
        objectUrl = URL.createObjectURL(converted.blob)
        setState({ status: 'ready', videoUrl: objectUrl })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'static', videoUrl: null })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [key, active, includeLarge, instanceUrl, token])

  return state
}

// Three layout tiers based on window width. Wide: notifications get a
// permanent left column and the thread panel gets a permanent right
// column — a real 3-pane layout, nothing slides. Medium: today's
// behavior — notifications is a header tab, thread panel slides in from
// the right over/beside the timeline. Narrow: no room for a third column
// at all, so an opened thread replaces the timeline in the same content
// area instead, with a back button to return.
const WIDE_BREAKPOINT = 1400
const NARROW_BREAKPOINT = 900

export function useLayoutTier() {
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    let raf = null
    function onResize() {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setWidth(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  if (width >= WIDE_BREAKPOINT) return 'wide'
  if (width >= NARROW_BREAKPOINT) return 'medium'
  return 'narrow'
}

const PULL_THRESHOLD = 90
const PULL_MAX_INDICATOR = 48

// Close-on-Escape for popup components (dropdowns, pickers). Child
// components register before App's global chain, so stopping immediate
// propagation here keeps the big popups from also reacting.
export function useEscapeKey(onEscape, active = true) {
  useEffect(() => {
    if (!active) return undefined
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onEscape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape, active])
}

// Scroll-down-to-refresh on a scrollable element: when already at the
// top, further pulling accumulates and past the threshold fires
// onRefresh. Handles both touch drag and mouse-wheel overscroll.
export function usePullToRefresh(el, onRefresh) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touchState = useRef({ startY: 0, active: false })
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    if (!el || refreshing) return undefined

    function endTouch() {
      touchState.current.active = false
      setPull((current) => {
        if (current >= PULL_THRESHOLD) {
          setRefreshing(true)
          onRefreshRef.current?.()
        }
        return 0
      })
    }
    function onTouchStart(e) {
      if (el.scrollTop <= 0 && e.touches.length === 1) {
        touchState.current.startY = e.touches[0].clientY
        touchState.current.active = true
      }
    }
    function onTouchMove(e) {
      if (!touchState.current.active) return
      const delta = e.touches[0].clientY - touchState.current.startY
      if (delta > 0 && el.scrollTop <= 0) {
        setPull(Math.min(delta * 0.5, PULL_MAX_INDICATOR + 40))
      } else {
        setPull(0)
      }
    }
    function onTouchEnd() {
      if (!touchState.current.active) return
      endTouch()
    }

    let wheelAccum = 0
    let wheelTimer = null
    function onWheel(e) {
      if (el.scrollTop > 0 || e.deltaY <= 0) {
        wheelAccum = 0
        setPull(0)
        return
      }
      wheelAccum += e.deltaY
      setPull(Math.min(wheelAccum * 0.4, PULL_MAX_INDICATOR))
      clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => {
        if (wheelAccum >= PULL_THRESHOLD) {
          setRefreshing(true)
          onRefreshRef.current?.()
        }
        wheelAccum = 0
        setPull(0)
      }, 250)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
      clearTimeout(wheelTimer)
    }
  }, [el, refreshing])

  // Show the spinner briefly regardless of how fast the reload resolves;
  // feels deliberate instead of flickery.
  useEffect(() => {
    if (!refreshing) return undefined
    const t = setTimeout(() => setRefreshing(false), 1500)
    return () => clearTimeout(t)
  }, [refreshing])

  return { pull, refreshing }
}
