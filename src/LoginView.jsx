import { useState } from 'react'
import { Rss } from 'lucide-react'

export default function LoginView({ onBeginLogin, error: externalError, completingLogin }) {
  const [instanceUrl, setInstanceUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!instanceUrl.trim()) {
      setError('Enter your instance address first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onBeginLogin(instanceUrl.trim())
      // On success the browser navigates away to the instance's login
      // page, so there's nothing further to do here.
    } catch (err) {
      setError(err.message || 'Something went wrong.')
      setBusy(false)
    }
  }

  const displayError = error || externalError

  return (
    <div className="login-screen">
      <header className="headerbar">
        <div className="headerbar-brand">
          <Rss size={18} />
          Mitra
        </div>
      </header>

      <div className="content-scroll scrollbar-thin">
        <div className="login-wrap">
          <div className="login-icon">
            <Rss size={32} />
          </div>
          <h1 className="login-title">Sign in to your instance</h1>
          <p className="login-subtitle">
            {completingLogin
              ? 'Finishing sign-in…'
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
              </div>

              <button className="pill-btn suggested full-width" type="submit" disabled={busy}>
                {busy ? 'Redirecting…' : 'Continue'}
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
