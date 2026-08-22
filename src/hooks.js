import { createContext, useContext, useEffect, useState } from 'react'

// A handful of cross-cutting display preferences that MediaItem needs deep
// in the tree (timeline post, nested reply, notification preview, panel —
// four+ levels of prop drilling for something this minor isn't worth it).
// Persisted so it survives a reload.
export const AppSettingsContext = createContext({ hoverPreviewsEnabled: true })
export const PickerContext = createContext({ openPickerId: null, setOpenPickerId: () => {} })

// Blob URLs fetched through the dev proxy are cached so scrolling back
// doesn't refetch them. Object URLs are never GC'd while alive, so the
// cache is bounded: oldest entries are evicted and their blob URLs
// revoked once the cap is exceeded.
const CLIENT_MEDIA_CACHE_MAX = 150
const clientMediaCache = new Map()

function getCachedClientMedia(url) {
  if (!clientMediaCache.has(url)) return undefined
  const blobUrl = clientMediaCache.get(url)
  clientMediaCache.delete(url)
  clientMediaCache.set(url, blobUrl) // refresh insertion order (recency)
  return blobUrl
}

function cacheClientMedia(url, blobUrl) {
  if (clientMediaCache.has(url)) clientMediaCache.delete(url)
  clientMediaCache.set(url, blobUrl)
  while (clientMediaCache.size > CLIENT_MEDIA_CACHE_MAX) {
    const oldestKey = clientMediaCache.keys().next().value
    URL.revokeObjectURL(clientMediaCache.get(oldestKey))
    clientMediaCache.delete(oldestKey)
  }
}

export function proxyUrl(url) {
  return `/media-proxy?url=${encodeURIComponent(url)}`
}

export function safeProxyUrl(url) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('/')) return url
  return proxyUrl(url)
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
    return fetch(proxyUrl(url), { headers })
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
    for (const u of urls) {
      if (u) {
        const cached = getCachedClientMedia(u)
        if (cached) { setState({ blobUrl: cached, loading: false, error: false }); return }
      }
    }

    let cancelled = false
    async function load() {
      for (const u of urls) {
        if (!u) continue
        try {
          const blob = await fetchMediaBlob(u)
          if (!blob) continue
          const blobUrl = URL.createObjectURL(blob)
          cacheClientMedia(u, blobUrl)
          if (!cancelled) setState({ blobUrl, loading: false, error: false })
          return
        } catch {
          // try next URL
        }
      }
      if (resolveUrls && !cancelled) {
        try {
          const extra = await resolveUrls()
          for (const u of (extra || [])) {
            if (!u) continue
            const cached = getCachedClientMedia(u)
            if (cached) {
              if (!cancelled) setState({ blobUrl: cached, loading: false, error: false })
              return
            }
            try {
              const blob = await fetchMediaBlob(u)
              if (!blob) continue
              const blobUrl = URL.createObjectURL(blob)
              cacheClientMedia(u, blobUrl)
              if (!cancelled) setState({ blobUrl, loading: false, error: false })
              return
            } catch {}
          }
        } catch {}
      }
      if (!cancelled) setState({ blobUrl: null, loading: false, error: true })
    }
    load()
    return () => { cancelled = true }
  }, [key])

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
