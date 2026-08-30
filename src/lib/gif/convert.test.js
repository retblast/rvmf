import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ensureGifConverted, setGifConversionDeps, resetGifConversionMemo, forgetGifConversion, GIF_LARGE_BYTES, GIF_MIN_BYTES } from './convert.js'
import { createMemoryDriver, setGifCacheDriver } from './cache.js'
import { makeTinyGif, makeLargeGifBytes } from './testHelpers.js'

const GIF_URL = 'https://x.example/a.gif'
const WORKER_RESULT = {
  blob: new Blob(['webm'], { type: 'video/webm' }),
  codec: 'av01.0.08M.08',
  width: 2,
  height: 2,
  frameCount: 1,
  durationMs: 100,
  sourceBytes: 200,
}

// A byte payload that passes the size gate (GIF_MIN_BYTES) and the magic
// check; the worker mock never decodes it.
function gifBytesAboveMin() {
  const gif = makeTinyGif([{ delay: 10, indexes: [0, 1, 2, 3] }])
  const bytes = new Uint8Array(GIF_MIN_BYTES)
  bytes.set(gif, 0)
  return bytes.buffer
}

function installFakes(overrides = {}) {
  const fakes = {
    fetchBytes: vi.fn(async () => gifBytesAboveMin()),
    worker: vi.fn(async () => WORKER_RESULT), // conversion fn: bytes -> result
    available: () => true,
    ...overrides,
  }
  setGifConversionDeps(fakes)
  return fakes
}

describe('ensureGifConverted', () => {
  beforeEach(() => {
    setGifCacheDriver(createMemoryDriver())
    resetGifConversionMemo()
    setGifConversionDeps({}) // defaults, then overridden per test
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('converts a GIF through the worker and caches the result', async () => {
    const fakes = installFakes()
    const result = await ensureGifConverted(GIF_URL, { instanceUrl: 'https://x.example', token: 'tok' })
    expect(result.blob).toBeInstanceOf(Blob)
    expect(fakes.fetchBytes).toHaveBeenCalledWith(GIF_URL, 'https://x.example', 'tok')
    expect(fakes.worker).toHaveBeenCalledTimes(1)

    // Second call comes from the cache — no refetch, no re-encode.
    const again = await ensureGifConverted(GIF_URL, { instanceUrl: 'https://x.example', token: 'tok' })
    expect(again).not.toBeNull()
    expect(again.cached).toBe(true)
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(1)
    expect(fakes.worker).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent conversions of the same URL', async () => {
    const fakes = installFakes()
    const [a, b] = await Promise.all([
      ensureGifConverted(GIF_URL, {}),
      ensureGifConverted(GIF_URL, {}),
    ])
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(1)
    expect(fakes.worker).toHaveBeenCalledTimes(1)
  })

  it('skips non-GIF URLs without fetching', async () => {
    const fakes = installFakes()
    expect(await ensureGifConverted('https://x.example/a.png', {})).toBeNull()
    expect(fakes.fetchBytes).not.toHaveBeenCalled()
  })

  it('remembers tiny/oversized/non-GIF skips briefly', async () => {
    const fakes = installFakes({
      fetchBytes: vi.fn(async () => {
        const bytes = new Uint8Array(10) // below GIF_MIN_BYTES
        bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0)
        return bytes.buffer
      }),
    })
    expect(await ensureGifConverted(GIF_URL, {})).toBeNull()
    expect(await ensureGifConverted(GIF_URL, {})).toBeNull()
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(1) // memoized, no refetch
  })

  it('leaves large GIFs alone unless includeLarge is on', async () => {
    const fakes = installFakes({
      fetchBytes: vi.fn(async () => makeLargeGifBytes(GIF_LARGE_BYTES + 1).buffer),
    })
    expect(await ensureGifConverted(GIF_URL, { includeLarge: false })).toBeNull()
    // The 'large' skip is bypassed once the gate widens.
    const result = await ensureGifConverted(GIF_URL, { includeLarge: true })
    expect(result).not.toBeNull()
    expect(fakes.worker).toHaveBeenCalledTimes(1)
  })

  it('returns null when the browser cannot encode', async () => {
    const fakes = installFakes({ available: () => false })
    expect(await ensureGifConverted(GIF_URL, {})).toBeNull()
    expect(fakes.fetchBytes).not.toHaveBeenCalled()
  })

  it('maps worker failures to a remembered static fallback', async () => {
    const fakes = installFakes({
      worker: vi.fn(async () => {
        const err = new Error('encode')
        err.code = 'encode'
        throw err
      }),
    })
    expect(await ensureGifConverted(GIF_URL, {})).toBeNull()
    // Second call hits the memo; the worker never runs again.
    expect(await ensureGifConverted(GIF_URL, {})).toBeNull()
    expect(fakes.worker).toHaveBeenCalledTimes(1)
  })

  it('falls back to null when the bytes are not a GIF', async () => {
    const fakes = installFakes({
      fetchBytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer),
    })
    expect(await ensureGifConverted(GIF_URL, {})).toBeNull()
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(1)
  })

  it('forgetGifConversion clears a remembered skip so the URL converts again', async () => {
    const fakes = installFakes({
      worker: vi.fn(async () => {
        const err = new Error('encode')
        err.code = 'encode'
        throw err
      }),
    })
    expect(await ensureGifConverted(GIF_URL, {})).toBeNull()
    expect(await ensureGifConverted(GIF_URL, {})).toBeNull()
    expect(fakes.worker).toHaveBeenCalledTimes(1) // memoized

    fakes.worker.mockResolvedValue(WORKER_RESULT)
    await forgetGifConversion(GIF_URL)
    const result = await ensureGifConverted(GIF_URL, {})
    expect(result).not.toBeNull()
    expect(fakes.worker).toHaveBeenCalledTimes(2) // re-encode attempted
  })

  it('forgetGifConversion drops the cached blob so a stale encode can be replaced', async () => {
    const fakes = installFakes()
    expect(await ensureGifConverted(GIF_URL, {})).not.toBeNull()
    expect(await ensureGifConverted(GIF_URL, {})).not.toBeNull()
    expect(fakes.worker).toHaveBeenCalledTimes(1) // served from cache after the first encode

    await forgetGifConversion(GIF_URL)
    expect(await ensureGifConverted(GIF_URL, {})).not.toBeNull()
    expect(fakes.worker).toHaveBeenCalledTimes(2) // re-encoded, not reused
  })
})