import { useCallback, useEffect, useState } from 'react'
import * as mitra from '../lib/mitra'
import { formatRelativeTime } from '../lib/render.jsx'

// Account security: password change and active session management.
// Reached from the settings menu; Mitra's settings module backs both
// (/v1/settings/change_password, /v1/settings/sessions).
export function AccountSettingsView({ instanceUrl, token }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMessage, setPwMessage] = useState(null)

  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [revokingId, setRevokingId] = useState(null)
  const [sessionsError, setSessionsError] = useState('')

  const loadSessions = useCallback(() => {
    setSessionsLoading(true)
    setSessionsError('')
    mitra.fetchSessions(instanceUrl, token)
      .then((items) => {
        // Newest first, current pinned on top.
        const sorted = [...(items || [])].sort((a, b) => (
          (b.is_current - a.is_current) || (new Date(b.created_at) - new Date(a.created_at))
        ))
        setSessions(sorted)
      })
      .catch((err) => setSessionsError(err.message || 'Failed to load sessions.'))
      .finally(() => setSessionsLoading(false))
  }, [instanceUrl, token])

  useEffect(() => { loadSessions() }, [loadSessions])

  async function submitPassword(e) {
    e.preventDefault()
    if (pwBusy) return
    if (password.length < 8) {
      setPwMessage({ error: true, text: 'Password must be at least 8 characters.' })
      return
    }
    if (password !== confirm) {
      setPwMessage({ error: true, text: 'Passwords don\u2019t match.' })
      return
    }
    setPwBusy(true)
    setPwMessage(null)
    try {
      await mitra.changePassword(instanceUrl, token, password)
      setPassword('')
      setConfirm('')
      setPwMessage({ error: false, text: 'Password changed.' })
    } catch (err) {
      setPwMessage({ error: true, text: err.message || 'Failed to change password.' })
    } finally {
      setPwBusy(false)
    }
  }

  async function revoke(session) {
    if (revokingId) return
    const isCurrent = session.is_current
    if (!window.confirm(
      isCurrent
        ? 'Revoke this session? It\u2019s the one you\u2019re using \u2014 you\u2019ll be logged out.'
        : `Revoke session from ${session.client_name || 'unknown client'}?`
    )) return
    setRevokingId(session.id)
    try {
      await mitra.revokeSession(instanceUrl, token, session.id)
      loadSessions()
    } catch (err) {
      setSessionsError(err.message || 'Failed to revoke session.')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <div className="timeline-wrap">
      <div className="section-label">Account</div>

      <form className="account-card" onSubmit={submitPassword}>
        <div className="account-card-heading">Change password</div>
        {pwMessage && (
          <div className={`banner ${pwMessage.error ? 'banner-error' : ''}`}>{pwMessage.text}</div>
        )}
        <input
          type="password"
          className="profile-edit-input"
          placeholder="New password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          className="profile-edit-input"
          placeholder="Repeat new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button className="pill-btn suggested" type="submit" disabled={pwBusy}>
          {pwBusy ? 'Saving…' : 'Change password'}
        </button>
      </form>

      <form className="account-card" onSubmit={(e) => { e.preventDefault(); loadSessions() }}>
        <div className="account-card-heading">Active sessions</div>
        {sessionsError && <div className="banner banner-error">{sessionsError}</div>}
        {sessionsLoading ? (
          <div className="empty-state">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="poll-meta">No other sessions.</div>
        ) : (
          <div className="session-list">
            {sessions.map((s) => (
              <div key={s.id} className="session-row">
                <div className="session-info">
                  <span className="session-client">
                    {s.client_name || 'Unknown client'}
                    {s.is_current && <span className="profile-badge mutual">This device</span>}
                  </span>
                  <span className="post-time">{formatRelativeTime(s.created_at)}</span>
                </div>
                <button
                  type="button"
                  className="pill-btn"
                  onClick={() => revoke(s)}
                  disabled={revokingId === s.id}
                >
                  {revokingId === s.id ? '…' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="poll-meta">
          Sessions are login tokens — apps you&rsquo;ve signed in with. Revoking one signs that app out.
        </div>
      </form>
    </div>
  )
}
