import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createMemoryDriver,
  setGifCacheDriver,
  GIF_CACHE_FULL_TIMER_DAYS,
  GIF_CACHE_MAX_ENTRIES,
  gifCacheGet,
  gifCachePut,
  gifCacheDelete,
  gifCacheSweep,
  gifCacheClear,
  gifCacheStats,
} from './cache.js'

function entryBlob(size = 64) {
  return new Blob([new Uint8Array(size)], { type: 'video/webm' })
}

function payload(overrides = {}) {
  return {
    blob: entryBlob(),
    codec: 'av01.0.08M.08',
    width: 2,
    height: 2,
    frameCount: 1,
    durationMs: 100,
    sourceBytes: 100,
    ...overrides,
  }
}

describe('gif cache', () => {
  beforeEach(() => {
    setGifCacheDriver(createMemoryDriver())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores and retrieves an entry', async () => {
    await gifCachePut('https://x.example/a.gif', payload())
    const entry = await gifCacheGet('https://x.example/a.gif')
    expect(entry).not.toBeNull()
    expect(entry.blob).toBeInstanceOf(Blob)
    expect(entry.codec).toBe('av01.0.08M.08')
  })

  it('returns null for an unknown key', async () => {
    expect(await gifCacheGet('https://x.example/missing.gif')).toBeNull()
  })

  it('a display hit restores the full timer', async () => {
    await gifCachePut('https://x.example/a.gif', payload())
    // Age the entry 29 days: 1 unit decays, 29 remain.
    vi.setSystemTime(new Date('2026-01-30T00:00:00Z'))
    const aged = await gifCacheGet('https://x.example/a.gif')
    expect(aged).not.toBeNull()
    // Displaying restores the full timer anchored at now.
    vi.setSystemTime(new Date('2026-01-31T00:00:00Z'))
    expect(await gifCacheGet('https://x.example/a.gif')).not.toBeNull()
    expect((await gifCacheGet('https://x.example/a.gif')).balanceDays).toBe(GIF_CACHE_FULL_TIMER_DAYS)
  })

  it('evicts an entry once the timer runs out', async () => {
    await gifCachePut('https://x.example/a.gif', payload())
    vi.setSystemTime(new Date('2026-01-31T00:00:00Z')) // 30 days later
    expect(await gifCacheGet('https://x.example/a.gif')).toBeNull()
  })

  it('sweep decays balances eagerly and drops exhausted entries', async () => {
    await gifCachePut('https://x.example/a.gif', payload())
    vi.setSystemTime(new Date('2026-01-30T00:00:00Z'))
    const removed = await gifCacheSweep()
    expect(removed).toBe(0)
    // The sweep anchored the decayed balance so future decays don't
    // double-count: 30 days minus 29 elapsed = 1 remaining.
    expect((await gifCacheGet('https://x.example/a.gif')).balanceDays).toBe(1)
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'))
    expect(await gifCacheSweep()).toBe(1)
    expect(await gifCacheGet('https://x.example/a.gif')).toBeNull()
  })

  it('caps the entry count by evicting least-recently-displayed first', async () => {
    for (let i = 0; i < GIF_CACHE_MAX_ENTRIES + 20; i++) {
      await gifCachePut(`https://x.example/${i}.gif`, payload())
      vi.setSystemTime(new Date(Date.now() + 1000))
    }
    const stats = await gifCacheStats()
    expect(stats.count).toBe(GIF_CACHE_MAX_ENTRIES)
    expect(await gifCacheGet('https://x.example/0.gif')).toBeNull()
    expect(await gifCacheGet(`https://x.example/${GIF_CACHE_MAX_ENTRIES}.gif`)).not.toBeNull()
  })

  it('clear drops everything', async () => {
    await gifCachePut('https://x.example/a.gif', payload())
    await gifCachePut('https://x.example/b.gif', payload())
    await gifCacheClear()
    expect(await gifCacheStats()).toEqual({ count: 0, totalBytes: 0 })
  })

  it('delete removes a single entry', async () => {
    await gifCachePut('https://x.example/a.gif', payload())
    await gifCachePut('https://x.example/b.gif', payload())
    await gifCacheDelete('https://x.example/a.gif')
    expect(await gifCacheGet('https://x.example/a.gif')).toBeNull()
    expect(await gifCacheGet('https://x.example/b.gif')).not.toBeNull()
    await gifCacheDelete(null)
    expect(await gifCacheStats()).toEqual({ count: 1, totalBytes: 64 })
  })
})