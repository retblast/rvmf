import { useEffect, useState } from 'react'
import { Rss } from 'lucide-react'
import { normalizeInstanceUrl } from './lib/mitra'

export default function LoginView({ onBeginLogin, onCreateAccount, error: externalError, completingLogin }) {
  const [instanceUrl, setInstanceUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 'login' redirects to the instance's own page; 'signup' creates the
  // account via API and logs straight in.
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  // Normalized origin once the typed domain answers as an instance —
  // drives the favicon swap in both brand spots.
  const [recognized, setRecognized] = useState(null)

  useEffect(() => {
    const raw = instanceUrl.trim()
    if (!raw) {
      setRecognized(null)
      return undefined
    }
    const timer = setTimeout(async () => {
      const normalized = normalizeInstanceUrl(raw)
      try {
        const res = await fetch(`${normalized}/api/v1/instance`)
        if (!res.ok) throw new Error('not an instance')
        const data = await res.json()
        // Instance entities carry their address under `uri` (v1) or
        // `domain` (v2) — anything else isn't something we can log into.
        if (data && (data.uri || data.domain)) setRecognized(normalized)
        else setRecognized(null)
      } catch {
        setRecognized(null)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [instanceUrl])

  async function submit(e) {
    e.preventDefault()
    if (!instanceUrl.trim()) {
      setError('Enter your instance address first.')
      return
    }
    setError('')

    if (mode === 'login') {
      setBusy(true)
      try {
        await onBeginLogin(instanceUrl.trim())
        // On success the browser navigates away to the instance's login
        // page, so there's nothing further to do here.
      } catch (err) {
        setError(err.message || 'Something went wrong.')
        setBusy(false)
      }
      return
    }

    if (!username.trim() || !password) {
      setError('Username and password are required.')
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setBusy(true)
    try {
      await onCreateAccount(instanceUrl.trim(), username.trim(), password, inviteCode.trim() || undefined)
      // Success flips straight into the session; nothing further here.
    } finally {
      setBusy(false)
    }
  }

  const displayError = error || externalError

  function Favicon({ size }) {
    if (!recognized) return <Rss size={size} />
    return (
      <img
        className="headerbar-instance-icon login-favicon"
        src={`${recognized}/favicon.ico`}
        alt=""
        width={size}
        height={size}
      />
    )
  }

  return (
    <div className="login-screen">
      <header className="headerbar">
        <div className="headerbar-brand">
          <Favicon size={18} />
          rvmf
        </div>
      </header>

      <div className="content-scroll scrollbar-thin">
        <div className="login-wrap">
          <div className={`login-icon${recognized ? ' recognized' : ''}`}>
            <Favicon size={32} />
          </div>
          {recognized && (
            <div className="login-recognized">
              ✓ {recognized.replace(/^https?:\/\//, '')}
            </div>
          )}
          <h1 className="login-title">{mode === 'login' ? 'Sign in to your instance' : 'Create your account'}</h1>
          <p className="login-subtitle">
            {completingLogin
              ? 'Finishing sign-in…'
              : mode === 'signup'
                ? "The account is created on the instance, and you'll be signed in right away."
                : "Enter your server address. You'll log in on the instance's own page — your password never touches this app."}
          </p>

          {!completingLogin && (
            <form onSubmit={submit}>
              {displayError && <div className="banner banner-error">{displayError}</div>}

              <div className="timeline-list entry-list">
                <label className="entry-row">
                  <span className="entry-label">Instance</span>
                  <input
                    type="text"
                    placeholder="mitra.example.social"
                    value={instanceUrl}
                    onChange={(e) => setInstanceUrl(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                </label>
                {mode === 'signup' && (
                  <>
                    <label className="entry-row">
                      <span className="entry-label">Username</span>
                      <input
                        type="text"
                        placeholder="lowercase_name"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck="false"
                      />
                    </label>
                    <label className="entry-row">
                      <span className="entry-label">Password</span>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="entry-row">
                      <span className="entry-label">Repeat</span>
                      <input
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="entry-row">
                      <span className="entry-label">Invite</span>
                      <input
                        type="text"
                        placeholder="Invite code (if required)"
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck="false"
                      />
                    </label>
                  </>
                )}
              </div>

              <button className="pill-btn suggested full-width" type="submit" disabled={busy}>
                {busy
                  ? (mode === 'login' ? 'Redirecting…' : 'Creating account…')
                  : (mode === 'login' ? 'Continue' : 'Create account')}
              </button>
              <button
                type="button"
                className="login-mode-toggle"
                onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}
              >
                {mode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in instead'}
              </button>
            </form>
          )}

          <p className="login-hint">
            This registers as an OAuth app with your instance, then sends
            you to <code>/oauth/authorize</code> there to log in — the same
            flow apps like Phanpy use. If it fails immediately with a
            network error, your instance may need CORS enabled for this
            origin (<code>http_cors_allow_all</code> in{' '}
            <code>config.yaml</code>, default since Mitra 5.0).
          </p>
        </div>
      </div>
    </div>
  )
}
