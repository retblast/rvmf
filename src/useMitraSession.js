import { useCallback, useEffect, useState } from 'react'
import * as mitra from './lib/mitra'
import { storageGet, storageSet, storageRemove } from './lib/storage.js'

const SESSION_KEY = 'session'

function loadSession() {
  const raw = storageGet(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    // A corrupt session (truncated write, tampering, crashed tab mid-save)
    // would otherwise throw from the useState initializer and white-screen
    // the whole app on boot. Degrade to logged-out and drop the bad value
    // so it doesn't keep failing on every reload.
    storageRemove(SESSION_KEY)
    return null
  }
}

function saveSession(session) {
  if (session) {
    storageSet(SESSION_KEY, JSON.stringify(session))
  } else {
    storageRemove(SESSION_KEY)
  }
}

export function useMitraSession() {
  const [session, setSession] = useState(loadSession)
  const [authError, setAuthError] = useState('')
  const [completingLogin, setCompletingLogin] = useState(false)

  function applySession(newSession) {
    setSession(newSession)
    saveSession(newSession)
  }

  // On mount: if the instance just redirected us back with ?code=... or
  // ?error=..., finish (or report) the login and scrub the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const oauthError = params.get('error')
    if (!code && !oauthError) return

    window.history.replaceState({}, '', window.location.pathname)

    if (oauthError) {
      setAuthError(`Login was not completed (${oauthError}).`)
      mitra.clearPendingLogin()
      return
    }

    setCompletingLogin(true)
    mitra
      .completeLogin(code)
      .then(applySession)
      .catch((err) => setAuthError(err.message || 'Login failed.'))
      .finally(() => setCompletingLogin(false))
  }, [])

  // If a restored session doesn't have maxCharacters yet (pre-existing
  // login), fetch it once so the compose char limit is accurate.
  useEffect(() => {
    if (!session || session.maxCharacters) return
    mitra
      .fetchInstance(session.instanceUrl)
      .then((instance) => {
        const maxCharacters = instance?.configuration?.statuses?.max_characters || 500
        setSession((prev) => {
          const next = { ...prev, maxCharacters }
          saveSession(next)
          return next
        })
      })
      .catch(() => {})
  }, [session?.instanceUrl])

  const beginLogin = useCallback((instanceUrl) => {
    setAuthError('')
    return mitra.beginLogin(instanceUrl)
  }, [])

  // Create the account, then immediately log in with the password grant —
  // no redirect round-trip, straight into the new timeline.
  const signup = useCallback(async (rawInstanceUrl, username, password, inviteCode) => {
    setAuthError('')
    setCompletingLogin(true)
    try {
      const instanceUrl = mitra.normalizeInstanceUrl(rawInstanceUrl)
      await mitra.registerAccount(instanceUrl, username, password, inviteCode)
      const newSession = await mitra.loginWithPassword(instanceUrl, username, password)
      applySession(newSession)
    } catch (err) {
      setAuthError(err.message || 'Sign-up failed.')
    } finally {
      setCompletingLogin(false)
    }
  }, [])

  const logout = useCallback(() => {
    // Invalidate the token server-side so the session can't be reused,
    // best-effort — logout proceeds even if the request fails. Read from
    // storage rather than state: state may already be stale here.
    try {
      const raw = storageGet(SESSION_KEY)
      const current = raw ? JSON.parse(raw) : null
      if (current?.instanceUrl && current?.token) {
        mitra.revokeToken(current.instanceUrl, current.token).catch(() => {})
      }
    } catch { /* persistence unavailable */ }
    setSession(null)
    saveSession(null)
  }, [])

  return { session, beginLogin, signup, logout, authError, completingLogin }
}
