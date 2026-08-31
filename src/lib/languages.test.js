import { describe, it, expect } from 'vitest'
import { canonicalizeLanguage, canonicalLangName, CANONICAL_LANGUAGE_IDS } from './languages.js'

describe('canonicalizeLanguage', () => {
  it('normalises tags and BCP-47 values to a canonical ISO id', () => {
    expect(canonicalizeLanguage('ja')).toBe('ja')
    expect(canonicalizeLanguage('ja-JP')).toBe('ja')
    expect(canonicalizeLanguage('en-US')).toBe('en')
    expect(canonicalizeLanguage('zh-Hans')).toBe('zh')
    expect(canonicalizeLanguage('HE')).toBe('he')
    expect(canonicalizeLanguage('iw')).toBe('he') // deprecated alias
  })

  it('returns null for unsupported or empty input', () => {
    expect(canonicalizeLanguage('xx')).toBeNull()
    expect(canonicalizeLanguage('')).toBeNull()
    expect(canonicalizeLanguage(null)).toBeNull()
  })
})

describe('canonicalLangName', () => {
  it('returns the human name for a canonical id', () => {
    expect(canonicalLangName('ja')).toBe('Japanese')
    expect(canonicalLangName('en')).toBe('English')
  })

  it('falls back to the id for an unknown canonical language', () => {
    expect(canonicalLangName('zz')).toBe('zz')
    expect(canonicalLangName('')).toBe('unknown language')
  })
})

describe('CANONICAL_LANGUAGE_IDS', () => {
  it('lists every supported language deterministically', () => {
    expect(CANONICAL_LANGUAGE_IDS).toContain('ja')
    expect(CANONICAL_LANGUAGE_IDS).toContain('en')
    expect(CANONICAL_LANGUAGE_IDS).toContain('fil')
    expect(CANONICAL_LANGUAGE_IDS).toContain('zh')
    // Sorted, unique.
    expect(CANONICAL_LANGUAGE_IDS).toEqual([...CANONICAL_LANGUAGE_IDS].sort())
    expect(new Set(CANONICAL_LANGUAGE_IDS).size).toBe(CANONICAL_LANGUAGE_IDS.length)
  })
})