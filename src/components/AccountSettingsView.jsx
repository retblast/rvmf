import { useCallback, useEffect, useState } from 'react'
import * as mitra from '../lib/mitra'
import { formatRelativeTime } from '../lib/render.jsx'
import { Avatar } from './Media.jsx'

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  // Defer revocation a tick: revoking synchronously right after click()
  // can race the browser's download navigation and silently drop the save.
  // Same pattern as saveBlob in hooks.js.
  setTimeout(() => URL.revokeObjectURL(link.href), 0)
}

// Follows/followers export & import, aliases, account migration.
// All of it rides on Mitra's settings module; migration and deletion
// are irreversible and gated behind type-to-confirm inputs.
function PortabilityCard({ instanceUrl, token }) {
  const [message, setMessage] = useState(null)

  const [importCsv, setImportCsv] = useState('')
  const [importBusy, setImportBusy] = useState('')

  const [aliasAcct, setAliasAcct] = useState('')
  const [aliasRemoveAcct, setAliasRemoveAcct] = useState('')
  const [aliasBusy, setAliasBusy] = useState(false)

  const [moveTarget, setMoveTarget] = useState('')
  const [moveConfirmText, setMoveConfirmText] = useState('')
  const [moveBusy, setMoveBusy] = useState(false)

  function note(error, text) {
    setMessage({ error, text })
    if (text) setTimeout(() => setMessage((m) => (m?.text === text ? null : m)), 5000)
  }

  async function doExport(kind) {
    try {
      const csv = kind === 'follows'
        ? await mitra.exportFollowsCsv(instanceUrl, token)
        : await mitra.exportFollowersCsv(instanceUrl, token)
      downloadCsv(`${kind}.csv`, csv || '')
      note(false, `Exported ${kind} to CSV.`)
    } catch (err) {
      note(true, err.message || 'Export failed.')
    }
  }

  async function doImport(kind) {
    if (!importCsv.trim()) {
      note(true, 'Paste CSV content first.')
      return
    }
    setImportBusy(kind)
    try {
      if (kind === 'follows') await mitra.importFollowsCsv(instanceUrl, token, importCsv.trim())
      else await mitra.importFollowersCsv(instanceUrl, token, importCsv.trim())
      setImportCsv('')
      note(false, `${kind === 'follows' ? 'Follows' : 'Followers'} imported.`)
    } catch (err) {
      note(true, err.message || 'Import failed.')
    } finally {
      setImportBusy('')
    }
  }

  async function addAlias(e) {
    e.preventDefault()
    if (!aliasAcct.trim()) return
    setAliasBusy(true)
    try {
      await mitra.addAlias(instanceUrl, token, aliasAcct.trim())
      note(false, `Alias to ${aliasAcct.trim()} added. From now on you can move followers to it.`)
      setAliasAcct('')
    } catch (err) {
      note(true, err.message || 'Failed to add alias.')
    } finally {
      setAliasBusy(false)
    }
  }

  async function removeAlias(e) {
    e.preventDefault()
    const acct = aliasRemoveAcct.trim()
    if (!acct) return
    setAliasBusy(true)
    try {
      // The endpoint wants an actor ID, not an acct — resolve first.
      const resolved = await mitra.lookupAccount(instanceUrl, token, acct)
      await mitra.removeAlias(instanceUrl, token, resolved.url || resolved.id)
      note(false, `Alias to ${acct} removed.`)
      setAliasRemoveAcct('')
    } catch (err) {
      note(true, err.message || 'Failed to remove alias.')
    } finally {
      setAliasBusy(false)
    }
  }

  const moveConfirmed = moveConfirmText === 'MOVE'

  async function doMove() {
    if (!moveConfirmed || moveBusy) return
    setMoveBusy(true)
    try {
      await mitra.moveFollowers(instanceUrl, token, moveTarget.trim())
      note(false, `Move requested — your followers will be asked to re-follow ${moveTarget.trim()}.`)
      setMoveTarget('')
      setMoveConfirmText('')
    } catch (err) {
      note(true, err.message || 'Move failed.')
    } finally {
      setMoveBusy(false)
    }
  }

  return (
    <form className="account-card" onSubmit={(e) => e.preventDefault()}>
      <div className="account-card-heading">Portability</div>
      {message && <div className={`banner ${message.error ? 'banner-error' : ''}`}>{message.text}</div>}

      <div className="portability-row">
        <span className="poll-meta">Back up your network as CSV:</span>
        <div className="portability-actions">
          <button type="button" className="pill-btn" onClick={() => doExport('follows')}>Export follows</button>
          <button type="button" className="pill-btn" onClick={() => doExport('followers')}>Export followers</button>
        </div>
      </div>

      <textarea
        className="profile-edit-input"
        rows={3}
        placeholder="Paste CSV here to import…"
        value={importCsv}
        onChange={(e) => setImportCsv(e.target.value)}
      />
      <div className="portability-actions">
        <button type="button" className="pill-btn" disabled={Boolean(importBusy)} onClick={() => doImport('follows')}>
          {importBusy === 'follows' ? '…' : 'Import follows'}
        </button>
        <button type="button" className="pill-btn" disabled={Boolean(importBusy)} onClick={() => doImport('followers')}>
          {importBusy === 'followers' ? '…' : 'Import followers'}
        </button>
      </div>

      <div className="account-card-heading">Aliases</div>
      <div className="poll-meta">Point old accounts at this one so they can migrate their followers here.</div>
      <div className="portability-row">
        <input
          className="profile-edit-input"
          placeholder="user@old-instance"
          value={aliasAcct}
          onChange={(e) => setAliasAcct(e.target.value)}
        />
        <button type="button" className="pill-btn suggested" disabled={aliasBusy} onClick={addAlias}>Add alias</button>
      </div>
      <div className="portability-row">
        <input
          className="profile-edit-input"
          placeholder="user@old-instance (remove)"
          value={aliasRemoveAcct}
          onChange={(e) => setAliasRemoveAcct(e.target.value)}
        />
        <button type="button" className="pill-btn" disabled={aliasBusy} onClick={removeAlias}>Remove alias</button>
      </div>

      <div className="account-card-heading danger">Move followers</div>
      <div className="poll-meta">
        Ask everyone following this account to re-follow a new one. Requires an alias pointing back at this account
        from the target. Irreversible.
      </div>
      <input
        className="profile-edit-input"
        placeholder="user@new-instance"
        value={moveTarget}
        onChange={(e) => setMoveTarget(e.target.value)}
      />
      <input
        className="profile-edit-input"
        placeholder="Type MOVE to confirm"
        value={moveConfirmText}
        onChange={(e) => setMoveConfirmText(e.target.value)}
      />
      <button type="button" className="pill-btn destructive" disabled={!moveConfirmed || moveBusy} onClick={doMove}>
        {moveBusy ? 'Moving…' : 'Move followers'}
      </button>
    </form>
  )
}

// Follow requests you've sent that haven't been accepted yet. Display
// only — Mitra has no withdraw endpoint; unfollowing the account is the
// implicit cancel.
function OutgoingRequestsCard({ instanceUrl, token, onOpenProfile }) {
  const [requests, setRequests] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    mitra.fetchOutgoingFollowRequests(instanceUrl, token)
      .then((list) => { if (!cancelled) setRequests(list || []) })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load.') })
    return () => { cancelled = true }
  }, [instanceUrl, token])

  return (
    <div className="account-card">
      <div className="account-card-heading">Sent follow requests</div>
      {error && <div className="banner banner-error">{error}</div>}
      {!requests ? (
        <div className="empty-state">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="poll-meta">No pending requests.</div>
      ) : (
        <div className="session-list">
          {requests.map((account) => (
            <button
              type="button"
              key={account.id}
              className="search-account-row"
              onClick={() => onOpenProfile?.(account)}
            >
              <Avatar name={account.display_name || account.username} src={account.avatar} />
              <div className="search-account-names">
                <span className="post-name">{account.display_name || account.username}</span>
                <span className="post-handle">@{account.acct || account.username}</span>
              </div>
              <span className="post-time">{formatRelativeTime(account.created_at)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="poll-meta">
        Waiting on protected accounts to approve. Unfollowing withdraws a request.
      </div>
    </div>
  )
}

// Account deletion — the one action there's no coming back from. The
// server wipes the account and its posts (POST /settings/delete_account,
// 204). Type-to-confirm gates it; on success the app logs out since the
// token dies with the account.
function DeleteAccountCard({ instanceUrl, token, onDeleted }) {
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirmed = confirmText.trim() === 'DELETE'

  async function doDelete() {
    if (!confirmed || busy) return
    setBusy(true)
    setError('')
    try {
      await mitra.deleteAccount(instanceUrl, token)
      onDeleted()
    } catch (err) {
      setError(err.message || 'Delete failed.')
      setBusy(false)
    }
  }

  return (
    <form className="account-card" onSubmit={(e) => { e.preventDefault(); doDelete() }}>
      <div className="account-card-heading danger">Delete account</div>
      <div className="poll-meta">
        Wipes this account and all of its posts from the instance.
        Irreversible — there is no undo and no export happens automatically.
        Export your follows first if you plan to migrate elsewhere.
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      <input
        className="profile-edit-input"
        placeholder="Type DELETE to confirm"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        autoComplete="off"
        spellCheck="false"
      />
      <button type="submit" className="pill-btn destructive" disabled={!confirmed || busy}>
        {busy ? 'Deleting…' : 'Delete account'}
      </button>
    </form>
  )
}

// Account security: password change and active session management.
// Reached from the settings menu; Mitra's settings module backs both
// (/v1/settings/change_password, /v1/settings/sessions).
export function AccountSettingsView({ instanceUrl, token, onOpenProfile, onDeleted }) {
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

      <OutgoingRequestsCard instanceUrl={instanceUrl} token={token} onOpenProfile={onOpenProfile} />

      <PortabilityCard instanceUrl={instanceUrl} token={token} />

      <DeleteAccountCard instanceUrl={instanceUrl} token={token} onDeleted={onDeleted} />
    </div>
  )
}
