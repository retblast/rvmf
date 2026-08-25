import { describe, it, expect } from 'vitest'
import { decodeBlurhash } from './blurhash.js'

// A widely-used sample hash (blue gradient) — decoders across languages
// are usually validated against it.
const SAMPLE = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'

describe('decodeBlurhash', () => {
  it('decodes a valid hash into a full RGBA buffer', () => {
    const out = decodeBlurhash(SAMPLE, 8, 8)
    expect(out).not.toBe(null)
    expect(out.width).toBe(8)
    expect(out.height).toBe(8)
    expect(out.rgba).toHaveLength(8 * 8 * 4)
  })

  it('produces fully opaque pixels', () => {
    const { rgba } = decodeBlurhash(SAMPLE, 4, 4)
    for (let i = 3; i < rgba.length; i += 4) {
      expect(rgba[i]).toBe(255)
    }
  })

  it('returns null for malformed input', () => {
    expect(decodeBlurhash(null)).toBe(null)
    expect(decodeBlurhash('')).toBe(null)
    expect(decodeBlurhash('abc')).toBe(null)
    expect(decodeBlurhash(42)).toBe(null)
  })
})
