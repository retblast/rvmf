// Cache for GIF->AV1 conversions. Entries carry a "balance" of days
// before eviction: displaying an entry restores the full timer, and each
// day of disuse costs one unit. The balance is derived from `updatedAt`
// lazily, so nothing needs a background timer to age — a read or the
// periodic sweep simply computes it. A swappable driver keeps jsdom tests
// deterministic without fake-indexeddb.
//
// Storage split: conversion *bytes* live in OPFS (an rvmf-gifs directory),
// so playback reads a disk-backed File instead of holding the whole WebM
// in RAM, and IndexedDB holds small metadata entries pointing at those
// files. Browsers without OPFS write support fall back to the legacy
// in-memory result stored whole in IDB (`storedIn: 'idb'`).
export const GIF_CACHE_FULL_TIMER_DAYS = 30
export const GIF_CACHE_DAILY_DECAY_DAYS = 1
export const GIF_CACHE_MAX_ENTRIES = 300
export const GIF_CACHE_MAX_TOTAL_BYTES = 512 * 1024 * 1024

const DAY_MS = 24 * 60 * 60 * 1000

const DB_NAME = 'rvmf-gif-cache'
const STORE_NAME = 'gifs'
const OPFS_DIR = 'rvmf-gifs'

// How much of the timer remains after `now` elapsed since updatedAt.
function effectiveBalance(entry, now) {
  const ageDays = Math.floor((now - entry.updatedAt) / DAY_MS)
  return entry.balanceDays - Math.max(0, ageDays) * GIF_CACHE_DAILY_DECAY_DAYS
}

// ---- OPFS helpers --------------------------------------------------------
// All best-effort: every helper fails closed (returns null/false) so a
// missing OPFS implementation or a cleared directory degrades to a cache
// miss instead of an exception.

async function withGifDir(fn, { create = false } = {}) {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return null
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create })
    return fn(dir)
  } catch {
    return null
  }
}

// The converted file for a key, as a disk-backed File. Never materializes
// the bytes in JS memory.
async function getOpfsGifFile(key) {
  return withGifDir(async (dir) => {
    const handle = await dir.getFileHandle(key)
    return handle.getFile()
  })
}

async function deleteOpfsGifFile(key) {
  await withGifDir(async (dir) => {
    await dir.removeEntry(key).catch(() => { /* already gone */ })
  })
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

async function idbGet(key) {
  return withDb((db) => idbRequest(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)))
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

const idbDriver = { getAll: idbGetAll, get: idbGet, put: idbPut, delete: idbDelete, clear: idbClearAll }

// In-memory driver: the default outside a browser (Node tests) and the
// deterministic stand-in for vitest.
export function createMemoryDriver() {
  const store = new Map()
  return {
    async getAll() {
      return [...store.values()]
    },
    async get(key) {
      return store.get(key) || null
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

// Bytes an entry accounts for against the byte cap: OPFS entries store the
// file size (metadata only), legacy IDB entries have the blob.
function entryBytes(entry) {
  return entry?.storedIn === 'opfs' ? (entry.blobBytes || 0) : (entry?.blob?.size || entry?.blobBytes || 0)
}

// Remove an entry everywhere it lives: the IDB metadata (and legacy blob)
// plus its OPFS file if any.
async function removeCachedEntry(key) {
  await getDriver().delete(key)
  await deleteOpfsGifFile(key)
}

// Enforce the entry/byte caps by evicting least-recently-displayed
// entries. Called after every put; the cache is small enough that a full
// scan per put is acceptable.
async function enforceCaps() {
  const entries = await getDriver().getAll()
  if (entries.length <= GIF_CACHE_MAX_ENTRIES) {
    const totalBytes = entries.reduce((sum, e) => sum + entryBytes(e), 0)
    if (totalBytes <= GIF_CACHE_MAX_TOTAL_BYTES) return
  }
  const sorted = [...entries].sort((a, b) => a.updatedAt - b.updatedAt)
  let count = entries.length
  let totalBytes = entries.reduce((sum, e) => sum + entryBytes(e), 0)
  const underEntryCount = () => count <= GIF_CACHE_MAX_ENTRIES
  const underByteCount = () => totalBytes <= GIF_CACHE_MAX_TOTAL_BYTES
  while (sorted.length > 0 && !(underEntryCount() && underByteCount())) {
    const oldest = sorted.shift()
    await removeCachedEntry(oldest.key)
    count -= 1
    totalBytes -= entryBytes(oldest)
  }
}

export async function gifCacheGet(key) {
  if (!key) return null
  // Direct key read — never a full-store scan, so a timeline full of
  // cached GIFs costs one small IDB get per row, not N full-store loads.
  const entry = await getDriver().get(key)
  if (!entry) return null
  const now = Date.now()
  const balance = effectiveBalance(entry, now)
  if (balance <= 0) {
    await removeCachedEntry(key)
    return null
  }
  // A display hit restores the full timer. When no aging has happened
  // yet (re-display within the same day) the stored anchor is already
  // "full", so skip the write.
  let fresh = entry
  if (balance < entry.balanceDays) {
    const restored = { ...entry, balanceDays: GIF_CACHE_FULL_TIMER_DAYS, updatedAt: now }
    await getDriver().put(restored)
    fresh = restored
  }
  if (fresh.storedIn === 'opfs') {
    // The bytes live on disk; hand back a File (a Blob) without loading
    // them into JS memory. A missing file (cleared externally) is a miss.
    const file = await getOpfsGifFile(key)
    if (!file) {
      await removeCachedEntry(key)
      return null
    }
    return { ...fresh, blob: file }
  }
  return fresh
}

// Cache an encoded conversion. `payload` is the worker result plus the
// bookkeeping fields (key, balanceDays, updatedAt). OPFS results carry no
// blob — only metadata (the file is already on disk); the in-memory
// fallback carries the blob.
export async function gifCachePut(key, payload) {
  const now = Date.now()
  const isOpfs = payload?.storedIn === 'opfs'
  const entry = {
    key,
    storedIn: isOpfs ? 'opfs' : 'idb',
    blob: isOpfs ? undefined : payload.blob,
    blobBytes: isOpfs ? (payload.blobBytes || 0) : (payload.blob?.size || 0),
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

// Drop one URL's cached conversion so the next request converts it fresh.
// Used by the profile "retry conversion" button when an avatar's encode landed
// in a bad state.
export async function gifCacheDelete(key) {
  if (!key) return
  await removeCachedEntry(key)
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
      await removeCachedEntry(entry.key)
      removed += 1
    } else if (balance !== entry.balanceDays) {
      await getDriver().put({ ...entry, balanceDays: balance, updatedAt: now })
    }
  }
  return removed
}

export async function gifCacheClear() {
  await getDriver().clear()
  // Drop the whole OPFS directory (recursive) so no orphaned files
  // survive a metadata wipe.
  if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') {
    try {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(OPFS_DIR, { recursive: true }).catch(() => { /* nothing to clear */ })
    } catch { /* no OPFS today */ }
  }
}

export async function gifCacheStats() {
  const entries = await getDriver().getAll()
  return {
    count: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + entryBytes(e), 0),
  }
}