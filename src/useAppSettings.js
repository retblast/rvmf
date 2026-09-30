import { useCallback, useEffect, useRef, useState } from 'react'
import * as mitra from './lib/mitra'
import { storageGet, storageSet } from './lib/storage.js'
import { applyOsAccent } from './lib/osAccent'
import { PROVIDER_IDS, DEFAULT_PROVIDER, unloadProvider } from './lib/translate.js'
import { gifCacheClear, gifCacheSweep } from './lib/gif/cache.js'
import { installGifHoverAnimator } from './lib/gif/hoverAnimator.js'
import { SKINS, applySkin } from './lib/skins.js'
import { maskAccount } from './lib/privacy.js'

// All user-adjustable app settings in one hook: persisted to localStorage,
// synced to the account's client_config (local wins on conflict), and
// bundled into the value handed to AppSettingsContext.Provider. Settings
// owned elsewhere (e.g. the notification filter list) can join the
// client_config sync via `extraSynced: { key: [value, setter] }`.
// A boolean setting persisted to localStorage as 'true'/'false' — the
// plain persist-and-flip pattern that used to repeat once per setting.
// Toggles with side effects (accent application, GIF cache clearing)
// stay handwritten next to their state.
function usePersistedFlag(storageKey, initial) {
  const [value, setValue] = useState(initial)
  const toggle = useCallback(() => {
    setValue((prev) => {
      const next = !prev
      storageSet(storageKey, String(next))
      return next
    })
  }, [storageKey])
  return [value, toggle, setValue]
}

export function useAppSettings(session, { onClientNameChange, extraSynced = {} } = {}) {

  // Privacy mode: masks the user's own display name/handle/avatar/bio at
  // every identity surface. Deliberately NOT part of the client_config
  // sync — stealth state is per-device and shouldn't be announced to the
  // server on login.
  const [privacyMode, togglePrivacyMode] = usePersistedFlag('privacy-mode', storageGet('privacy-mode') === 'true')

  const [useOsAccent, setUseOsAccent] = useState(() => {
    return storageGet('use-os-accent') !== 'false'
  })

  function toggleUseOsAccent() {
    setUseOsAccent((prev) => {
      const next = !prev
      applyOsAccent(next)
      storageSet('use-os-accent', String(next))
      return next
    })
  }

  const [alwaysSensitive, toggleAlwaysSensitive, setAlwaysSensitive] = usePersistedFlag('always-sensitive', storageGet('always-sensitive') === 'true')

  // Only meaningful when strict sensitive mode hides everything: allow
  // hover previews to peek at unrevealed media.
  const [peekSpoilerMedia, togglePeekSpoilerMedia, setPeekSpoilerMedia] = usePersistedFlag('peek-spoiler', storageGet('peek-spoiler') === 'true')

  const [fetchClientMedia, toggleFetchClientMedia, setFetchClientMedia] = usePersistedFlag('fetch-client-media', storageGet('fetch-client-media') !== 'false')

  // On-device translation is off by default and opt-in behind a confirm:
  // the first use downloads a ~3 GB model, so we want the user's explicit
  // ok before flipping it on. Local-only (not synced) — whether to stash a
  // multi-GB model on a device is a per-machine decision.
  const [translationEnabled, setTranslationEnabled] = useState(() => {
    return storageGet('translation-enabled') === 'true'
  })
  const [confirmingTranslation, setConfirmingTranslation] = useState(false)
  // Which on-device translator to use: the lightweight CPU model (default) or
  // the larger GPU model. Local-only, persisted alongside the enable toggle.
  const [translationProvider, setTranslationProvider] = useState(() => {
    const stored = storageGet('translation-provider')
    return PROVIDER_IDS.includes(stored) ? stored : DEFAULT_PROVIDER
  })

  function handleToggleTranslation(next) {
    if (next && !translationEnabled) {
      setConfirmingTranslation(true)
      return
    }
    setTranslationEnabled(next)
    storageSet('translation-enabled', String(next))
    // Turning the feature off should stop pinning the loaded model in memory —
    // release whichever provider(s) were loaded so the freed memory returns to
    // the browser/GPU immediately.
    if (!next) PROVIDER_IDS.forEach(unloadProvider)
  }

  function confirmTranslation() {
    setConfirmingTranslation(false)
    setTranslationEnabled(true)
    storageSet('translation-enabled', 'true')
  }

  function handleTranslationProvider(provider) {
    // Switching providers should not keep the previous model resident (esp.
    // the ~3 GB WebGPU Gemma) — release the one we're leaving.
    if (provider !== translationProvider) unloadProvider(translationProvider)
    setTranslationProvider(provider)
    storageSet('translation-provider', provider)
  }

  // GIF -> AV1 power saver. Local-only (not synced), like translation:
  // whether this browser re-encodes GIFs is a per-device decision.
  const [gifConversionEnabled, setGifConversionEnabled] = useState(() => {
    return storageGet('gif-conversion-enabled') === 'true'
  })
  function toggleGifConversion() {
    setGifConversionEnabled((prev) => {
      const next = !prev
      storageSet('gif-conversion-enabled', String(next))
      // Stashed conversions are meaningless while the feature is off —
      // drop them so a re-enable starts clean (and frees the space).
      if (!next) gifCacheClear()
      return next
    })
  }

  const [gifIncludeLarge, toggleGifIncludeLarge] = usePersistedFlag('gif-conversion-large', storageGet('gif-conversion-large') === 'true')
  const [gifHoverAnimate, toggleGifHoverAnimate] = usePersistedFlag('gif-hover-animate', storageGet('gif-hover-animate') === 'true')

  // Cache housekeeping + the hover animator's document listeners. Installed
  // once; the animator only acts on videos that opted in via the
  // data-rvmf-animatable attribute, so it's inert while the feature is off.
  useEffect(() => {
    gifCacheSweep()
    const timer = setInterval(() => gifCacheSweep(), 60 * 60 * 1000)
    const uninstall = installGifHoverAnimator()
    return () => {
      clearInterval(timer)
      uninstall()
    }
  }, [])

  // Persist the posting default on the account (SharedClientConfig) so
  // it applies everywhere, not just this browser.
  const [defaultVisibility, setDefaultVisibility] = useState('public')
  function handleDefaultVisibilityChange(v) {
    const previous = defaultVisibility
    setDefaultVisibility(v)
    if (!session) return
    mitra.updateCredentials(session.instanceUrl, session.token, { source: { privacy: v } })
      .catch(() => setDefaultVisibility(previous))
  }

  // Server-side posting default: seeds the composer's visibility and
  // syncs across devices via SharedClientConfig.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    mitra.fetchPreferences(session.instanceUrl, session.token)
      .then((prefs) => {
        const v = prefs?.['posting:default:visibility']
        if (!cancelled && v) setDefaultVisibility(v)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [session])

  const [clientName, setClientName] = useState(() => mitra.getClientName())
  function handleClientNameChange(name) {
    setClientName(name)
    mitra.setClientName(name)
    if (session) {
      mitra.clearAppCredentials(session.instanceUrl)
      onClientNameChange?.()
    }
  }

  const [themeMode, setThemeMode] = useState(() => {
    return storageGet('theme-mode') || 'system'
  })

  // Skin (look-and-feel package): adwaita is the baseline; others are
  // token manifests from src/lib/skins.js.
  const [skinId, setSkinId] = useState(() => storageGet('skin') || 'adwaita')
  useEffect(() => {
    const skin = SKINS[skinId]
    if (!skin) return
    applySkin(skin)
    storageSet('skin', skinId)
    // Non-GNOME skins own their accent — the OS-accent feature yields.
    if (!skin.respectOsAccent) {
      document.documentElement.classList.remove('os-accent')
      document.documentElement.style.removeProperty('--os-accent')
    } else {
      applyOsAccent(useOsAccent)
    }
  }, [skinId, useOsAccent])

  useEffect(() => {
    const root = document.documentElement
    if (themeMode === 'system') {
      delete root.dataset.theme
    } else {
      root.dataset.theme = themeMode
    }
    storageSet('theme-mode', themeMode)
  }, [themeMode])

  // Server-backed settings sync. Fresh devices backfill missing values
  // from the account's client_config; a device that already has a value
  // locally is never overridden — local always wins. Changes push back
  // (debounced) so they follow you across devices.
  const [configSyncReady, setConfigSyncReady] = useState(false) // flips once the backfill attempt resolves; gates the push below
  const restoredConfigRef = useRef(null)
  useEffect(() => {
    if (!session || restoredConfigRef.current === session.account?.id) return
    restoredConfigRef.current = session.account?.id ?? 'anon'
    let cancelled = false
    mitra.fetchOwnAccount(session.instanceUrl, session.token)
      .then((acct) => {
        if (cancelled) return
        setConfigSyncReady(true)
        const cfg = acct?.client_config?.rvmf
        if (!cfg) return
        if (storageGet('theme-mode') === null && typeof cfg['theme-mode'] === 'string') {
          setThemeMode(cfg['theme-mode'])
        }
        if (storageGet('skin') === null && typeof cfg['skin'] === 'string' && SKINS[cfg['skin']]) {
          setSkinId(cfg['skin'])
          storageSet('skin', cfg['skin'])
        }
        if (storageGet('use-os-accent') === null && typeof cfg['use-os-accent'] === 'boolean') {
          const enabled = Boolean(cfg['use-os-accent'])
          setUseOsAccent(enabled)
          applyOsAccent(enabled)
          storageSet('use-os-accent', String(enabled))
        }
        for (const key of ['always-sensitive', 'peek-spoiler', 'fetch-client-media']) {
          if (storageGet(key) === null && typeof cfg[key] === 'boolean') {
            storageSet(key, String(cfg[key]))
            if (key === 'always-sensitive') setAlwaysSensitive(Boolean(cfg[key]))
            if (key === 'peek-spoiler') setPeekSpoilerMedia(Boolean(cfg[key]))
            if (key === 'fetch-client-media') setFetchClientMedia(Boolean(cfg[key]))
          }
        }
        // Keys owned by other modules but riding the same client_config sync
        // (array-typed only — matches the notif-excluded contract)
        for (const [key, [, setValue]] of Object.entries(extraSynced)) {
          if (storageGet(key) === null && Array.isArray(cfg[key])) {
            storageSet(key, JSON.stringify(cfg[key]))
            setValue(cfg[key])
          }
        }
      })
      .catch(() => {
        if (!cancelled) setConfigSyncReady(true)
      })
    return () => { cancelled = true }
  }, [session])

  useEffect(() => {
    // Hold pushes until the initial backfill attempt has resolved —
    // otherwise a fresh device would overwrite server config with its
    // local defaults before reading what's there.
    if (!session || !configSyncReady) return undefined
    const timer = setTimeout(() => {
      mitra.pushClientConfig(session.instanceUrl, session.token, {
        'theme-mode': themeMode,
        'skin': skinId,
        'use-os-accent': useOsAccent,
        'always-sensitive': alwaysSensitive,
        'peek-spoiler': peekSpoilerMedia,
        'fetch-client-media': fetchClientMedia,
        ...Object.fromEntries(Object.entries(extraSynced).map(([k, [v]]) => [k, v])),
      }).catch(() => {})
    }, 2000)
    return () => clearTimeout(timer)
  }, [session, themeMode, skinId, useOsAccent, alwaysSensitive, peekSpoilerMedia, fetchClientMedia, configSyncReady,
    ...Object.values(extraSynced).map(([v]) => v)])

  const selfId = session?.account?.id
  const mask = (account) => maskAccount(account, selfId, privacyMode)

  return {
    // Bundled for AppSettingsContext.Provider; re-created per render, same
    // as the previous inline object.
    contextValue: {
      fetchClientMedia, alwaysSensitive, peekSpoilerMedia,
      translationEnabled, translationProvider, defaultVisibility,
      gifConversionEnabled, gifIncludeLarge, gifHoverAnimate,
      privacyMode, mask, selfId,
      instanceUrl: session?.instanceUrl, token: session?.token,
    },
    privacyMode, togglePrivacyMode, mask,
    skin: SKINS[skinId] || null, skinId, setSkinId,
    themeMode, setThemeMode,
    useOsAccent, toggleUseOsAccent,
    fetchClientMedia, toggleFetchClientMedia,
    alwaysSensitive, toggleAlwaysSensitive,
    peekSpoilerMedia, togglePeekSpoilerMedia,
    translationEnabled, translationProvider,
    handleToggleTranslation, confirmingTranslation, setConfirmingTranslation,
    confirmTranslation, handleTranslationProvider,
    gifConversionEnabled, toggleGifConversion,
    gifIncludeLarge, toggleGifIncludeLarge,
    gifHoverAnimate, toggleGifHoverAnimate,
    defaultVisibility, handleDefaultVisibilityChange,
    clientName, handleClientNameChange,
  }
}
