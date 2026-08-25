import { describe, it, expect } from 'vitest'
import { filterEmoji } from './Emoji.jsx'

describe('filterEmoji', () => {
  const custom = [
    { shortcode: 'blobcat', url: 'u1', static_url: 's1' },
    { shortcode: 'ablobcatrainbow', url: 'u2', static_url: 's2' },
  ]

  it('matches unicode names by substring', () => {
    const out = filterEmoji('think', [])
    expect(out.some((s) => s.name === 'thinking')).toBe(true)
    expect(out.every((s) => s.type === 'unicode')).toBe(true)
  })

  it('matches custom shortcodes', () => {
    const out = filterEmoji('blobcat', custom)
    expect(out.filter((s) => s.type === 'custom').map((s) => s.name))
      .toEqual(['blobcat', 'ablobcatrainbow'])
  })

  it('mixes unicode and custom results', () => {
    const out = filterEmoji('fire', custom)
    expect(out.some((s) => s.name === 'fire' && s.type === 'unicode')).toBe(true)
  })

  it('caps the result lists (15 unicode / 10 custom)', () => {
    const out = filterEmoji('o', custom) // 'o' matches many unicode names
    const uni = out.filter((s) => s.type === 'unicode')
    const cust = out.filter((s) => s.type === 'custom')
    expect(uni.length).toBeLessThanOrEqual(15)
    expect(cust.length).toBeLessThanOrEqual(10)
  })
})
