import { describe, it, expect } from 'vitest'
import {
  resolveModelCode,
  resolveTargetLanguage,
  isForeignStatus,
  modelLangName,
  detectScriptLanguage,
  canonicalizeLanguage,
  canonicalLangName,
  canonicalLanguages,
  resolveLanguageCode,
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

describe('detectScriptLanguage', () => {
  it('detects single-script languages confidently', () => {
    expect(detectScriptLanguage('こんにちは、元気ですか')).toBe('ja') // kana -> Japanese
    expect(detectScriptLanguage('안녕하세요')).toBe('ko')          // Hangul -> Korean
    expect(detectScriptLanguage('你好世界')).toBe('zh')           // Han -> Chinese
    expect(detectScriptLanguage('مرحبا بالعالم')).toBe('ar')      // Arabic
    expect(detectScriptLanguage('שלום עולם')).toBe('he')          // Hebrew
    expect(detectScriptLanguage('नमस्ते दुनिया')).toBe('hi')      // Devanagari
    expect(detectScriptLanguage('สวัสดีชาวโลก')).toBe('th')       // Thai
    expect(detectScriptLanguage('வணக்கம் உலகம்')).toBe('ta')      // Tamil
    expect(detectScriptLanguage('Γεια σου κόσμε')).toBe('el')     // Greek
    expect(detectScriptLanguage('Привет мир')).toBe('ru')         // Cyrillic
  })

  it('prefers Japanese over Han characters when kana is present (shared script)', () => {
    expect(detectScriptLanguage('ボタンを押してください')).toBe('ja')
  })

  it('returns null for ambiguous Latin-script text and empty input', () => {
    expect(detectScriptLanguage('hello world')).toBeNull()
    expect(detectScriptLanguage('')).toBeNull()
    expect(detectScriptLanguage(null)).toBeNull()
    expect(detectScriptLanguage(undefined)).toBeNull()
  })
})

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

describe('canonicalLanguages / canonicalLangName', () => {
  it('offers a shared picker list with human names', () => {
    const list = canonicalLanguages()
    expect(list.some((l) => l.code === 'ja' && l.label === 'Japanese')).toBe(true)
    expect(list.some((l) => l.code === 'en' && l.label === 'English')).toBe(true)
  })

  it('falls back to the id for an unknown canonical language', () => {
    expect(canonicalLangName('zz')).toBe('zz')
  })
})

describe('resolveLanguageCode', () => {
  it('maps a canonical id to the NLLB FLORES code', () => {
    expect(resolveLanguageCode('ja', 'nllb-wasm')).toBe('jpn_Jpan')
    expect(resolveLanguageCode('en', 'nllb-wasm')).toBe('eng_Latn')
    expect(resolveLanguageCode('ko', 'nllb-wasm')).toBe('kor_Hang')
  })

  it('maps a canonical id to the TranslateGemma locale', () => {
    expect(resolveLanguageCode('ja', 'gemma-webgpu')).toBe('ja_JP')
    expect(resolveLanguageCode('en', 'gemma-webgpu')).toBe('en')
    expect(resolveLanguageCode('ko', 'gemma-webgpu')).toBe('ko_KR')
  })

  it('returns null for unsupported languages', () => {
    expect(resolveLanguageCode('xx', 'nllb-wasm')).toBeNull()
    expect(resolveLanguageCode('xx', 'gemma-webgpu')).toBeNull()
  })
})
