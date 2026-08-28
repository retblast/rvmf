import { describe, it, expect } from 'vitest'
import {
  resolveModelCode,
  resolveTargetLanguage,
  isForeignStatus,
  modelLangName,
} from './languages.js'

describe('resolveModelCode', () => {
  it('maps bare ISO 639-1 codes to a model locale', () => {
    expect(resolveModelCode('ja')).toBe('ja_JP')
    expect(resolveModelCode('de')).toBe('de_DE')
    expect(resolveModelCode('en')).toBe('en')
    expect(resolveModelCode('es')).toBe('es')
  })

  it('maps full BCP-47 tags to the exact region variant', () => {
    expect(resolveModelCode('ja-JP')).toBe('ja_JP')
    expect(resolveModelCode('pt-PT')).toBe('pt_PT')
    expect(resolveModelCode('pt-BR')).toBe('pt_BR')
    expect(resolveModelCode('fr-CA')).toBe('fr_CA')
    expect(resolveModelCode('de-AT')).toBe('de_DE') // region no model variant -> default
  })

  it('defaults ambiguous languages to a sensible region', () => {
    expect(resolveModelCode('pt')).toBe('pt_BR')
    expect(resolveModelCode('fr')).toBe('fr_FR')
    expect(resolveModelCode('ar')).toBe('ar_SA')
  })

  it('handles special-case codes', () => {
    expect(resolveModelCode('fil')).toBe('fil_PH')
    expect(resolveModelCode('he')).toBe('he_IL')
    // The model only ships Traditional Chinese.
    expect(resolveModelCode('zh')).toBe('zh_TW')
    expect(resolveModelCode('zh-Hans')).toBe('zh_TW')
  })

  it('is case-insensitive and tolerates underscores', () => {
    expect(resolveModelCode('JA')).toBe('ja_JP')
    expect(resolveModelCode('pt_br')).toBe('pt_BR')
  })

  it('returns null for unsupported languages and empty input', () => {
    expect(resolveModelCode('xx')).toBeNull()
    expect(resolveModelCode('')).toBeNull()
    expect(resolveModelCode(null)).toBeNull()
    expect(resolveModelCode(undefined)).toBeNull()
  })
})

describe('resolveTargetLanguage', () => {
  it('resolves the browser language to a model code', () => {
    expect(resolveTargetLanguage('en-US')).toBe('en')
    expect(resolveTargetLanguage('ja')).toBe('ja_JP')
    expect(resolveTargetLanguage('pt-BR')).toBe('pt_BR')
  })

  it('falls back to English for unsupported browser languages', () => {
    expect(resolveTargetLanguage('xx-XX')).toBe('en')
    expect(resolveTargetLanguage('')).toBe('en')
  })
})

describe('isForeignStatus', () => {
  it('is true when the post language differs from the user language', () => {
    expect(isForeignStatus('ja', 'en-US')).toBe(true)
    expect(isForeignStatus('de', 'en')).toBe(true)
  })

  it('is false when languages match (same pan-language)', () => {
    expect(isForeignStatus('en', 'en-US')).toBe(false)
    expect(isForeignStatus('pt-BR', 'pt-PT')).toBe(false) // same base language
  })

  it('is false for missing or unsupported status language', () => {
    expect(isForeignStatus('', 'en-US')).toBe(false)
    expect(isForeignStatus(null, 'en-US')).toBe(false)
    expect(isForeignStatus('xx', 'en-US')).toBe(false)
  })
})

describe('modelLangName', () => {
  it('returns a human-readable name for known codes', () => {
    expect(modelLangName('ja_JP')).toBe('Japanese')
    expect(modelLangName('en')).toBe('English')
  })

  it('falls back to the code itself', () => {
    expect(modelLangName('zz_ZZ')).toBe('zz_ZZ')
  })
})
