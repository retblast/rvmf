// rvmf service worker: makes the app installable and keeps a small
// static shell for offline boots. Deliberately conservative:
//   - API traffic (/api/, /oauth/) and the media proxy are NEVER
//     intercepted — the app must see live federation data and fresh
//     error states, never stale caches.
//   - Hashed /assets/* are immutable: cache-first.
//   - Everything else same-origin (navigations, icons, manifest):
//     network-first with cache fallback, so redeploys surface fast
//     while an offline launch still gets the shell.
//   - server.mjs serves sw.js with no-cache, so browser update checks
//     pick up new deploys immediately; bump VERSION on breaking
//     precache changes.
const VERSION = 'rvmf-v1'
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))
      ))
      // Hashed bundles change names on every deploy; without a purge
      // the surviving cache grows forever with dead builds. Evicted
      // entries repopulate on demand — cache-first falls through to the
      // network and re-caches on the next hit.
      .then(() => caches.open(VERSION))
      .then((cache) => cache.keys().then((requests) => Promise.all(
        requests
          .filter((request) => new URL(request.url).pathname.startsWith('/assets/'))
          .map((request) => cache.delete(request))
      )))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const pathname = url.pathname
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/oauth/') ||
    pathname.startsWith('/media-proxy')
  ) return

  if (pathname.startsWith('/assets/')) {
    // Immutable fingerprinted bundles: answer from cache when possible.
    event.respondWith(
      caches.match(request).then((hit) => hit || fetchAndCache(request))
    )
    return
  }

  event.respondWith(
    fetchAndCache(request).catch(() => {
      if (request.mode === 'navigate') return caches.match('/')
      return caches.match(request)
    })
  )
})

async function fetchAndCache(request) {
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(VERSION)
    // Put a copy into the cache without delaying the response.
    cache.put(request, response.clone())
  }
  return response
}
