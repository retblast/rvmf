import { useCallback, useEffect, useState } from 'react'
import * as mitra from './lib/mitra'

const SESSION_KEY = 'mitra-session'

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSession(session) {
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } else {
    localStorage.removeItem(SESSION_KEY)
  }
}

export function useMitraSession() {
  const [session, setSession] = useState(loadSession)
  const [authError, setAuthError] = useState('')
  const [completingLogin, setCompletingLogin] = useState(false)

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
      .then((newSession) => {
        setSession(newSession)
        saveSession(newSession)
      })
      .catch((err) => setAuthError(err.message || 'Login failed.'))
      .finally(() => setCompletingLogin(false))
  }, [])

  const beginLogin = useCallback((instanceUrl) => {
    setAuthError('')
    return mitra.beginLogin(instanceUrl)
  }, [])

  const logout = useCallback(() => {
    setSession(null)
    saveSession(null)
  }, [])

  return { session, beginLogin, logout, authError, completingLogin }
}
