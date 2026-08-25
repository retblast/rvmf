// App settings/session persistence. All keys live under an `rvmf-`
// prefix; a one-time migration renames anything left over from the old
// `mitra-` prefix so existing users keep their session, theme, filters
// and other preferences across the rebrand.
const PREFIX = 'rvmf-'
const LEGACY_PREFIX = 'mitra-'

function migrateScope(store) {
  try {
    const legacyKeys = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && k.startsWith(LEGACY_PREFIX)) legacyKeys.push(k)
    }
    for (const k of legacyKeys) {
      const newKey = PREFIX + k.slice(LEGACY_PREFIX.length)
      if (store.getItem(newKey) === null) {
        store.setItem(newKey, store.getItem(k))
      }
      store.removeItem(k)
    }
  } catch { /* storage unavailable — nothing to migrate */ }
}

// Guards keep this module importable outside a browser too (seed and
// test scripts run in bare Node).
if (typeof localStorage !== 'undefined') migrateScope(localStorage)
if (typeof sessionStorage !== 'undefined') migrateScope(sessionStorage)

export function storageGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw !== null ? raw : fallback
  } catch {
    return fallback
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch { /* persistence unavailable */ }
}

export function storageRemove(key) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch { /* persistence unavailable */ }
}

export function sessionGet(key, fallback = null) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    return raw !== null ? raw : fallback
  } catch {
    return fallback
  }
}

export function sessionSet(key, value) {
  try {
    sessionStorage.setItem(PREFIX + key, value)
  } catch { /* persistence unavailable */ }
}

export function sessionRemove(key) {
  try {
    sessionStorage.removeItem(PREFIX + key)
  } catch { /* persistence unavailable */ }
}
