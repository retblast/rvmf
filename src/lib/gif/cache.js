// IndexedDB-backed cache for GIF->AV1 conversions. Entries carry a
// "balance" of days before eviction: displaying an entry restores the
// full timer, and each day of disuse costs one unit. The balance is
// derived from `updatedAt` lazily, so nothing needs a background timer
// to age — a read or the periodic sweep simply computes it. A swappable
// driver keeps jsdom tests deterministic without fake-indexeddb.
export const GIF_CACHE_FULL_TIMER_DAYS = 30
export const GIF_CACHE_DAILY_DECAY_DAYS = 1
export const GIF_CACHE_MAX_ENTRIES = 300
export const GIF_CACHE_MAX_TOTAL_BYTES = 512 * 1024 * 1024

const DAY_MS = 24 * 60 * 60 * 1000

const DB_NAME = 'rvmf-gif-cache'
const STORE_NAME = 'gifs'

// How much of the timer remains after `now` elapsed since updatedAt.
function effectiveBalance(entry, now) {
  const ageDays = Math.floor((now - entry.updatedAt) / DAY_MS)
  return entry.balanceDays - Math.max(0, ageDays) * GIF_CACHE_DAILY_DECAY_DAYS
}

// ---- IndexedDB driver ---------------------------------------------------
function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openGifCacheDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withDb(fn) {
  const db = await openGifCacheDb()
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

async function idbGetAll() {
  return withDb((db) => idbRequest(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()))
}

async function idbPut(entry) {
  await withDb((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

async function idbDelete(key) {
  await withDb((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

async function idbClearAll() {
  await withDb((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

const idbDriver = { getAll: idbGetAll, put: idbPut, delete: idbDelete, clear: idbClearAll }

// In-memory driver: the default outside a browser (Node tests) and the
// deterministic stand-in for vitest.
export function createMemoryDriver() {
  const store = new Map()
  return {
    async getAll() {
      return [...store.values()]
    },
    async put(entry) {
      store.set(entry.key, entry)
    },
    async delete(key) {
      store.delete(key)
    },
    async clear() {
      store.clear()
    },
    _store: store,
  }
}

const memoryDriver = createMemoryDriver()

// Resolved lazily so merely importing this module never touches IDB.
let driver = null
function getDriver() {
  if (driver) return driver
  driver = typeof indexedDB !== 'undefined' ? idbDriver : memoryDriver
  return driver
}

// Test seam: install a deterministic driver before touching the cache.
export function setGifCacheDriver(d) {
  driver = d
}

// Enforce the entry/byte caps by evicting least-recently-displayed
// entries. Called after every put; the cache is small enough that a full
// scan per put is acceptable.
async function enforceCaps() {
  const entries = await getDriver().getAll()
  if (entries.length <= GIF_CACHE_MAX_ENTRIES) {
    const totalBytes = entries.reduce((sum, e) => sum + (e.blob?.size || 0), 0)
    if (totalBytes <= GIF_CACHE_MAX_TOTAL_BYTES) return
  }
  const sorted = [...entries].sort((a, b) => a.updatedAt - b.updatedAt)
  let count = entries.length
  let totalBytes = entries.reduce((sum, e) => sum + (e.blob?.size || 0), 0)
  const underEntryCount = () => count <= GIF_CACHE_MAX_ENTRIES
  const underByteCount = () => totalBytes <= GIF_CACHE_MAX_TOTAL_BYTES
  while (sorted.length > 0 && !(underEntryCount() && underByteCount())) {
    const oldest = sorted.shift()
    await getDriver().delete(oldest.key)
    count -= 1
    totalBytes -= oldest.blob?.size || 0
  }
}

export async function gifCacheGet(key) {
  if (!key) return null
  const entries = await getDriver().getAll()
  const entry = entries.find((e) => e.key === key)
  if (!entry) return null
  const now = Date.now()
  const balance = effectiveBalance(entry, now)
  if (balance <= 0) {
    await getDriver().delete(key)
    return null
  }
  // A display hit restores the full timer. When no aging has happened
  // yet (re-display within the same day) the stored anchor is already
  // "full", so skip the write.
  if (balance < entry.balanceDays) {
    const restored = { ...entry, balanceDays: GIF_CACHE_FULL_TIMER_DAYS, updatedAt: now }
    await getDriver().put(restored)
    return restored
  }
  return entry
}

// Cache an encoded conversion. `payload` is the worker result plus the
// bookkeeping fields (key, balanceDays, updatedAt).
export async function gifCachePut(key, payload) {
  const now = Date.now()
  const entry = {
    key,
    blob: payload.blob,
    contentType: 'video/webm',
    codec: payload.codec,
    width: payload.width,
    height: payload.height,
    frameCount: payload.frameCount,
    durationMs: payload.durationMs,
    sourceBytes: payload.sourceBytes,
    balanceDays: GIF_CACHE_FULL_TIMER_DAYS,
    updatedAt: now,
  }
  await getDriver().put(entry)
  await enforceCaps()
  return entry
}

// Drop one URL's cached blob so the next request converts it fresh. Used
// by the profile "retry conversion" button when an avatar's encode landed
// in a bad state.
export async function gifCacheDelete(key) {
  if (!key) return
  await getDriver().delete(key)
}

// Decay every entry by the days elapsed since its last display and drop
// the exhausted ones. Cheap and idempotent — safe to call on an interval.
export async function gifCacheSweep() {
  let removed = 0
  const now = Date.now()
  const entries = await getDriver().getAll()
  for (const entry of entries) {
    const balance = effectiveBalance(entry, now)
    if (balance <= 0) {
      await getDriver().delete(entry.key)
      removed += 1
    } else if (balance !== entry.balanceDays) {
      await getDriver().put({ ...entry, balanceDays: balance, updatedAt: now })
    }
  }
  return removed
}

export async function gifCacheClear() {
  await getDriver().clear()
}

export async function gifCacheStats() {
  const entries = await getDriver().getAll()
  return {
    count: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + (e.blob?.size || 0), 0),
  }
}