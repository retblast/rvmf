// Supported language codes for the on-device TranslateGemma model, and
// helpers for resolving BCP-47 / ISO 639-1 values (like a status's
// `language` field or `navigator.language`) to the exact model locale.
//
// The model is trained on a fixed set of locale codes (e.g. `ja_JP`,
// `de_DE`, `en`, `es`). Fediverse APIs tag posts with plain ISO 639-1
// (e.g. `ja`, `de`, `en`), and the browser advertises BCP-47 (e.g.
// `en-US`). Both need mapping onto the model's vocabulary, which is what
// the functions here do.

// Human-readable names keyed by model code — this is also the single source
// of truth for the model's supported locale vocabulary (each key is an exact
// code the model expects, e.g. `ja_JP`, `de_DE`, `en`, `es`). Falls back to
// the code itself.
const MODEL_LANG_NAMES = {
  'ar_EG': 'Arabic', 'ar_SA': 'Arabic (Saudi Arabia)', 'bg_BG': 'Bulgarian',
  'bn_IN': 'Bengali', 'ca_ES': 'Catalan', 'cs_CZ': 'Czech', 'da_DK': 'Danish',
  'de_DE': 'German', 'el_GR': 'Greek', 'en': 'English', 'es': 'Spanish',
  'et_EE': 'Estonian', 'fa_IR': 'Persian', 'fi_FI': 'Finnish',
  'fil_PH': 'Filipino', 'fr_CA': 'French (Canada)', 'fr_FR': 'French',
  'gu_IN': 'Gujarati', 'he_IL': 'Hebrew', 'hi_IN': 'Hindi', 'hr_HR': 'Croatian',
  'hu_HU': 'Hungarian', 'id_ID': 'Indonesian', 'is_IS': 'Icelandic',
  'it_IT': 'Italian', 'ja_JP': 'Japanese', 'kn_IN': 'Kannada', 'ko_KR': 'Korean',
  'lt_LT': 'Lithuanian', 'lv_LV': 'Latvian', 'ml_IN': 'Malayalam',
  'mr_IN': 'Marathi', 'nl_NL': 'Dutch', 'no_NO': 'Norwegian', 'pa_IN': 'Punjabi',
  'pl_PL': 'Polish', 'pt_BR': 'Portuguese (Brazil)', 'pt_PT': 'Portuguese (Portugal)',
  'ro_RO': 'Romanian', 'ru_RU': 'Russian', 'sk_SK': 'Slovak', 'sl_SI': 'Slovenian',
  'sr_RS': 'Serbian', 'sv_SE': 'Swedish', 'sw_KE': 'Swahili',
  'sw_TZ': 'Swahili (Tanzania)', 'ta_IN': 'Tamil', 'te_IN': 'Telugu',
  'th_TH': 'Thai', 'tr_TR': 'Turkish', 'uk_UA': 'Ukrainian', 'ur_PK': 'Urdu',
  'vi_VN': 'Vietnamese', 'zh_TW': 'Chinese (Traditional)', 'zu_ZA': 'Zulu',
}

export function modelLangName(code) {
  return MODEL_LANG_NAMES[code] || code
}

// Build a lookup from bare ISO language tag -> model codes. Several model
// codes share the same language but differ by region (pt_BR/pt_PT,
// sw_KE/sw_TZ, fr/ar), so each language maps to a short list, most
// specific (region tag) first.
const BY_LANG = new Map()
for (const code of Object.keys(MODEL_LANG_NAMES)) {
  const lang = code.split('_')[0]
  const list = BY_LANG.get(lang) || []
  list.push(code)
  BY_LANG.set(lang, list)
}

// A bare language tag with no region hint still needs a deterministic pick
// when the model offers several regions for it. These are the "default"
// regions, tuned for a fediverse audience (pt -> Brazil is by far the most
// common on social networks; fr -> France; ar -> Saudi Arabia).
const DEFAULT_REGION = {
  pt: 'BR', fr: 'FR', ar: 'SA', sw: 'KE', zh: 'TW',
}

// Resolve an arbitrary BCP-47 / ISO 639-1 style tag (lowercased already) to
// a model language code, or null if unsupported.
//
//   en-US      -> en
//   ja         -> ja_JP
//   ja-JP      -> ja_JP
//   pt         -> pt_BR
//   pt-PT      -> pt_PT
//   fil        -> fil_PH
//   he         -> he_IL
//   zh-Hans    -> zh_TW   (model only ships Traditional)
//   xx         -> null
function resolveModelCodeFromTag(lowerTag) {
  const cleaned = lowerTag.replace(/_/g, '-').toLowerCase()
  const [lang, region] = cleaned.split('-')
  const candidates = BY_LANG.get(lang)
  if (!candidates || candidates.length === 0) return null

  // 1. Exact full-code match (e.g. "ja-JP", "pt-PT").
  if (region) {
    const exact = candidates.find((c) => c.toLowerCase() === `${lang}_${region}`)
    if (exact) return exact
  }
  // The bare code "en"/"es" have no region suffix and match exactly.
  const bare = candidates.find((c) => !c.includes('_'))
  if (bare) return bare

  // 2. Prefer the configured default region, else the first variant.
  const preferredRegion = DEFAULT_REGION[lang]
  const preferred = candidates.find((c) => c.endsWith(`_${preferredRegion}`))
  return preferred || candidates[0]
}

// Public helper exposed for the app + tests: resolve a raw BCP-47 tag to a
// model language code (or null). Accepts mixed casing.
export function resolveModelCode(tag) {
  if (!tag) return null
  return resolveModelCodeFromTag(String(tag))
}

// All model language codes, alphabetized — powers the source-language picker
// shown when a post has no reliable language tag.
export const SUPPORTED_CODES = Object.keys(MODEL_LANG_NAMES).sort()

// `{ code, label }` pairs for populating a `<select>` of source languages.
export const SUPPORTED_LANGUAGES = SUPPORTED_CODES.map((code) => ({
  code,
  label: MODEL_LANG_NAMES[code],
}))

// Best-effort script-based guess of a text's language, resolved to a model
// code, or null when the evidence isn't decisive.
//
// This is only used as a fallback when the post has no usable language tag,
// and — because a wrong guess yields a garbage translation — we restrict it
// to scripts that are effectively single-language (kana = Japanese, Hangul =
// Korean, Devanagari = Hindi, Thai, Tamil, Greek, etc.). Ambiguous cases
// (Latin scripts, mixed-script text) return null so the caller asks the user.
// Even a confident guess is surfaced as a correctable choice in the UI,
// never as silently authoritative output.
export function detectScriptLanguage(text) {
  if (!text) return null
  let han = 0, kana = 0, hangul = 0, arabic = 0, hebrew = 0
  let cyrillic = 0, devanagari = 0, thai = 0, greek = 0, tamil = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)
    if (c >= 0x4E00 && c <= 0x9FFF) han++ // CJK unified ideographs
    else if ((c >= 0x3040 && c <= 0x309F) || (c >= 0x30A0 && c <= 0x30FF)) kana++
    else if (c >= 0xAC00 && c <= 0xD7AF) hangul++
    else if ((c >= 0x0600 && c <= 0x06FF) || (c >= 0x0750 && c <= 0x077F)) arabic++
    else if (c >= 0x0590 && c <= 0x05FF) hebrew++
    else if (c >= 0x0400 && c <= 0x04FF) cyrillic++
    else if (c >= 0x0900 && c <= 0x097F) devanagari++
    else if (c >= 0x0E00 && c <= 0x0E7F) thai++
    else if (c >= 0x0370 && c <= 0x03FF) greek++
    else if (c >= 0x0B80 && c <= 0x0BFF) tamil++
  }
  // Kana is uniquely Japanese; its presence outweighs any shared Han chars.
  if (kana > 0) return 'ja_JP'
  if (hangul > 0) return 'ko_KR'
  if (han > 0) return 'zh_TW' // Simplified Chinese; model only ships Traditional (zh_TW).
  if (arabic > 0) return 'ar_SA'
  if (hebrew > 0) return 'he_IL'
  if (devanagari > 0) return 'hi_IN'
  if (thai > 0) return 'th_TH'
  if (tamil > 0) return 'ta_IN'
  if (greek > 0) return 'el_GR'
  if (cyrillic > 0) return 'ru_RU' // Cyrillic spans ru/uk/bg/mk/sr; default RU, correctable in UI.
  return null
}

// Resolve the user's UI/browser language to a target model code. Prefers a
// non-English target so a Japanese-friendly visitor gets translations in
// their own language by default. Falls back to English.
export function resolveTargetLanguage(browserLanguage) {
  const code = resolveModelCode(browserLanguage)
  return code || 'en'
}

// True when a status tagged with the given ISO language is likely not in
// the user's own language (i.e. worth offering a translate button for).
export function isForeignStatus(statusLang, browserLanguage) {
  if (!statusLang) return false
  const source = resolveModelCode(statusLang)
  const target = resolveTargetLanguage(browserLanguage)
  if (!source) return false
  return source !== target && source.split('_')[0] !== target.split('_')[0]
}
