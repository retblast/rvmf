// The app's shared language vocabulary and helpers for resolving BCP-47 /
// ISO 639-1 values (like a status's `language` field or `navigator.language`)
// to a canonical ISO 639-1 id.
//
// Translation no longer needs *source* language codes at all — both on-device
// translators are instruction models that read the source from the text and
// translate "into {target}". The canonical ids here define which *target*
// languages the app supports and how arbitrary tags (e.g. `en-US`, `he`,
// `fil`) map onto that vocabulary.

// Canonical ISO 639-1 id -> stable code label. The values are illustrative
// FLORES-style ids from the original NLLB provider; they're kept purely as
// plain identifiers now that both on-device translators take the target
// language by name. The keys are the single source of truth for which
// languages translation offers.
const CANONICAL_LANGUAGES = {
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

export const CANONICAL_LANGUAGE_IDS = Object.keys(CANONICAL_LANGUAGES).sort()

/**
 * Normalise an arbitrary BCP-47 / ISO 639-1 tag down to a canonical ISO 639-1
 * id when it's one of the supported languages, else null.
 *
 *   'ja'    -> 'ja'    'ja-JP' -> 'ja'    'jpn_Jpan' -> 'ja'
 *   'en-US' -> 'en'    'he'    -> 'he'    'fil'      -> 'fil'
 *   'xx'    -> null
 */
export function canonicalizeLanguage(tag) {
  if (!tag) return null
  const lower = String(tag).replace(/_/g, '-').toLowerCase()
  const [first] = lower.split('-')
  const alias = { iw: 'he', in: 'id', ji: 'yi' }
  const id = alias[first] || first
  return CANONICAL_LANGUAGES[id] ? id : null
}

/**
 * Public per-id human name, used by the UI ("Translated from Japanese") and by
 * the translation prompt ("Translate into Japanese").
 */
export function canonicalLangName(id) {
  return CANONICAL_NAMES[id] || id || 'unknown language'
}