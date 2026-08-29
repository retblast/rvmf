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
// Note: the `<select>` (and the source-language detection) work in *canonical*
// ISO 639-1 ids (`ja`, `ko`, `ru`…) that each provider maps to its own model
// code internally. See `canonicalLanguages`/`resolveLanguageCode` below.
export const SUPPORTED_LANGUAGES = SUPPORTED_CODES.map((code) => ({
  code,
  label: MODEL_LANG_NAMES[code],
}))

// ---------------------------------------------------------------------------
// Canonical languages + NLLB (wasm) provider
//
// The app works in *canonical* ISO 639-1 ids (e.g. `ja`, `en`, `ko`) as a
// neutral shared identifier. Each translation provider maps those ids to its
// own model code:
//   - TranslateGemma ("gemma-webgpu") mirrors a 2-char ISO code onto a locale
//     like `ja_JP` (via `resolveModelCode` above).
//   - NLLB ("nllb-wasm") uses FLORES-200 codes like `jpn_Jpan` (ISO 639-3
//     language + script), via the map below.
// ---------------------------------------------------------------------------

// Canonical ISO 639-1 id -> FLORES-200 language code for NLLB-200-distilled.
// This is also the single source of truth for which canonical languages are
// offered in the picker.
const NLLB_FLORES = {
  ar: 'arb_Arab', bg: 'bul_Cyrl', bn: 'ben_Beng', ca: 'cat_Latn',
  cs: 'ces_Latn', da: 'dan_Latn', de: 'deu_Latn', el: 'ell_Grek',
  en: 'eng_Latn', es: 'spa_Latn', et: 'est_Latn', fa: 'pes_Arab',
  fi: 'fin_Latn', fil: 'tgl_Latn', fr: 'fra_Latn', gu: 'guj_Gujr',
  he: 'heb_Hebr', hi: 'hin_Deva', hr: 'hrv_Latn', hu: 'hun_Latn',
  id: 'ind_Latn', is: 'isl_Latn', it: 'ita_Latn', ja: 'jpn_Jpan',
  kn: 'kan_Knda', ko: 'kor_Hang', lt: 'lit_Latn', lv: 'lvs_Latn',
  ml: 'mal_Mlym', mr: 'mar_Deva', nl: 'nld_Latn', no: 'nob_Latn',
  pa: 'pan_Guru', pl: 'pol_Latn', pt: 'por_Latn', ro: 'ron_Latn',
  ru: 'rus_Cyrl', sk: 'slk_Latn', sl: 'slv_Latn', sr: 'srp_Cyrl',
  sv: 'swe_Latn', sw: 'swh_Latn', ta: 'tam_Taml', te: 'tel_Telu',
  th: 'tha_Thai', tr: 'tur_Latn', uk: 'ukr_Cyrl', ur: 'urd_Arab',
  vi: 'vie_Latn', zh: 'zho_Hans', zu: 'zul_Latn',
}

// Human-readable name per canonical id (best-effort; falls back to the id).
const CANONICAL_NAMES = {
  ar: 'Arabic', bg: 'Bulgarian', bn: 'Bengali', ca: 'Catalan', cs: 'Czech',
  da: 'Danish', de: 'German', el: 'Greek', en: 'English', es: 'Spanish',
  et: 'Estonian', fa: 'Persian', fi: 'Finnish', fil: 'Filipino', fr: 'French',
  gu: 'Gujarati', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian', hu: 'Hungarian',
  id: 'Indonesian', is: 'Icelandic', it: 'Italian', ja: 'Japanese',
  kn: 'Kannada', ko: 'Korean', lt: 'Lithuanian', lv: 'Latvian', ml: 'Malayalam',
  mr: 'Marathi', nl: 'Dutch', no: 'Norwegian', pa: 'Punjabi', pl: 'Polish',
  pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sk: 'Slovak', sl: 'Slovenian',
  sr: 'Serbian', sv: 'Swedish', sw: 'Swahili', ta: 'Tamil', te: 'Telugu',
  th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', vi: 'Vietnamese',
  zh: 'Chinese', zu: 'Zulu',
}

// The canonical ids the app supports — shared by the picker, detection, and
// both providers.
export const CANONICAL_LANGUAGE_IDS = Object.keys(NLLB_FLORES).sort()

// `{ code, label }` for the source-language picker, keyed by canonical id.
export const canonicalLanguages = () =>
  CANONICAL_LANGUAGE_IDS.map((id) => ({ code: id, label: CANONICAL_NAMES[id] || id }))

export function canonicalLangName(id) {
  return CANONICAL_NAMES[id] || id || 'unknown language'
}

// Normalise an arbitrary BCP-47 / ISO 639-1 tag (or a provider code) down to a
// canonical ISO 639-1 id when it's one of the supported languages, else null.
//
//   'ja'    -> 'ja'    'ja-JP' -> 'ja'    'jpn_Jpan' -> 'ja'
//   'en-US' -> 'en'    'he'    -> 'he'    'fil'      -> 'fil'
//   'xx'    -> null
export function canonicalizeLanguage(tag) {
  if (!tag) return null
  const lower = String(tag).replace(/_/g, '-').toLowerCase()
  const [first] = lower.split('-')
  const alias = { iw: 'he', in: 'id', ji: 'yi' }
  const id = alias[first] || first
  return NLLB_FLORES[id] ? id : null
}

// Resolve a source/target (a raw BCP-47/ISO tag or canonical id) to the
// provider's model code, or null if unsupported by that provider.
export function resolveLanguageCode(tag, provider) {
  const id = canonicalizeLanguage(tag)
  if (!id) return null
  if (provider === 'nllb-wasm') return NLLB_FLORES[id]
  return resolveModelCode(id) // gemma-webgpu
}

// Best-effort script-based guess of a text's language as a *canonical* ISO
// 639-1 id, or null when the evidence isn't decisive.
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
  if (kana > 0) return 'ja'
  if (hangul > 0) return 'ko'
  if (han > 0) return 'zh' // Sim./Trad. Chinese both map to canonical 'zh'.
  if (arabic > 0) return 'ar'
  if (hebrew > 0) return 'he'
  if (devanagari > 0) return 'hi'
  if (thai > 0) return 'th'
  if (tamil > 0) return 'ta'
  if (greek > 0) return 'el'
  if (cyrillic > 0) return 'ru' // Cyrillic spans ru/uk/bg/mk/sr; default RU, correctable in UI.
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
