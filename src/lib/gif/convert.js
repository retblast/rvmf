// Main-thread orchestration for GIF -> AV1/VP9 conversion. Keep this
// module free of React imports (hooks.js imports it): it only touches
// fetch, the cache, and a Web Worker. Conversion of a single URL is
// deduped across mounts, and all conversions run through one worker at a
// time so a timeline full of GIFs can't spin up a codec per row.
import {
  GIF_LARGE_BYTES,
  GIF_MIN_BYTES,
  GIF_MAX_INPUT_BYTES,
  detectGifBytes,
  isGifUrl,
  videoEncodingAvailable,
} from './core.js'
import { gifCachePut, gifCacheGet, gifCacheDelete } from './cache.js'

export { GIF_LARGE_BYTES, GIF_MIN_BYTES, GIF_MAX_INPUT_BYTES }

// URLs that were checked and bounced (too small, not a GIF, fetch failed)
// are remembered briefly so scrolling doesn't re-fetch and re-decode them
// on every remount. A 'large' skip is bypassed when the user widens the
// gate later.
const SKIP_TTL_MS = 10 * 60 * 1000
const skippedUrls = new Map() // url -> { reason, at }

function isSkipped(url, includeLarge) {
  const skip = skippedUrls.get(url)
  if (!skip) return false
  if (Date.now() - skip.at > SKIP_TTL_MS) {
    skippedUrls.delete(url)
    return false
  }
  return !(skip.reason === 'large' && includeLarge)
}

function rememberSkip(url, reason) {
  skippedUrls.set(url, { reason, at: Date.now() })
  // Debug-level so it's invisible by default; flip the console filter to
  // see why a URL is staying static instead of converting.
  console.debug('[gif] skip', url, reason)
}

// Test seam: clear the session memo (also handy if a URL was fixed live).
export function resetGifConversionMemo() {
  skippedUrls.clear()
}

// Forget a single URL's skip memo and cached blob so the next mount runs
// the whole pipeline from scratch — the profile "retry avatar conversion"
// button, for when a transient failure or a bad encode left one avatar
// stuck on the static frame.
export async function forgetGifConversion(url) {
  skippedUrls.delete(url)
  await gifCacheDelete(url)
}

async function fetchGifBytes(url, instanceUrl, token) {
  const headers = {}
  // Only send the token toward our own instance — never to third-party
  // hosts. The dev proxy forwards this header upstream as-is.
  if (token && instanceUrl && url.startsWith(instanceUrl)) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(`/media-proxy?url=${encodeURIComponent(url)}`, {
      headers,
      signal: controller.signal,
    })
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    // Bail early on obviously non-GIF bodies (HTML prune/error pages are
    // the common case) before slurping the whole payload.
    if (contentType && !contentType.includes('gif') && !contentType.startsWith('application/octet-stream')) {
      return null
    }
    return await res.arrayBuffer()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// One conversion at a time: GIF decoding is memory-hungry, and a worker
// per timeline row would be worse than the GIFs themselves.
let conversionQueue = Promise.resolve()
function runExclusive(fn) {
  const run = conversionQueue.then(fn)
  conversionQueue = run.then(() => {}, () => {})
  return run
}

function spawnWorker() {
  return new Worker(new URL('./convert.worker.js', import.meta.url), { type: 'module' })
}

function runWorkerConversion(arrayBuffer, cacheKey) {
  return new Promise((resolve, reject) => {
    const worker = spawnWorker()
    const id = Math.random().toString(36).slice(2)
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('gif conversion timed out'))
    }, 120_000)
    worker.onmessage = (e) => {
      if (!e.data || e.data.id !== id) return
      clearTimeout(timer)
      worker.terminate()
      if (e.data.ok) resolve(e.data.result)
      else reject(new Error(e.data.error || 'gif conversion failed'))
    }
    worker.onerror = (e) => {
      clearTimeout(timer)
      worker.terminate()
      reject(e.error || new Error('gif conversion worker crashed'))
    }
    worker.postMessage({ id, arrayBuffer, cacheKey }, [arrayBuffer])
  })
}

// Runtime seams for tests (fake fetch, fake worker, fake capability
// check). Overrides merge over the defaults.
const impl = {
  available: videoEncodingAvailable,
  fetchBytes: fetchGifBytes,
  worker: runWorkerConversion,
}
export function setGifConversionDeps(overrides) {
  Object.assign(impl, overrides)
}

const inflight = new Map() // url -> Promise<result|null>

// Returns the converted WebM blob (plus metadata) for a GIF URL, or null
// when the conversion is skipped — feature gates are the caller's job.
export async function ensureGifConverted(url, { instanceUrl, token, includeLarge = false } = {}) {
  if (!url || !isGifUrl(url)) return null
  if (!impl.available()) return null
  if (isSkipped(url, includeLarge)) return null

  const cached = await gifCacheGet(url)
  if (cached) {
    return {
      blob: cached.blob,
      codec: cached.codec,
      width: cached.width,
      height: cached.height,
      frameCount: cached.frameCount,
      durationMs: cached.durationMs,
      sourceBytes: cached.sourceBytes,
      cached: true,
    }
  }

  let promise = inflight.get(url)
  if (!promise) {
    promise = (async () => {
      try {
        const bytes = await impl.fetchBytes(url, instanceUrl, token)
        if (!bytes) { rememberSkip(url, 'fetch'); return null }
        if (bytes.byteLength < GIF_MIN_BYTES) { rememberSkip(url, 'tiny'); return null }
        // Hard ceiling, applied even when includeLarge widened the "large"
        // gate — bounds main-thread transient RAM and CPU time (see core.js).
        if (bytes.byteLength > GIF_MAX_INPUT_BYTES) { rememberSkip(url, 'too-large'); return null }
        if (bytes.byteLength > GIF_LARGE_BYTES && !includeLarge) { rememberSkip(url, 'large'); return null }
        if (!detectGifBytes(bytes)) { rememberSkip(url, 'not-gif'); return null }

        // The worker streams the result either to OPFS (cacheKey = url) or
        // back as a blob; either way it reports the same metadata.
        const result = await runExclusive(() => impl.worker(bytes, url))
        if (!result?.codec) { rememberSkip(url, 'encode'); return null }
        await gifCachePut(url, result)
        // Re-read through the cache so both storage paths return a
        // blob-backed entry to the caller (OPFS entries resolve their
        // on-disk file here; in-memory entries return their stored blob).
        const stored = await gifCacheGet(url)
        if (!stored) { rememberSkip(url, 'encode'); return null }
        console.debug('[gif] converted', url, result.codec, stored.blob?.size ?? result.blobBytes, 'bytes')
        return { ...stored, cached: false }
      } catch (err) {
        // Errors carry a machine-readable code from the worker pipeline
        // (unsupported, too-large...); anything else is a generic failure.
        // Either way: static fallback, remembered briefly.
        rememberSkip(url, err?.code || 'error')
        return null
      } finally {
        inflight.delete(url)
      }
    })()
    inflight.set(url, promise)
  }
  return promise
}