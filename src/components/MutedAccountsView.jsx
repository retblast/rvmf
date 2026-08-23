import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { Avatar } from './Media.jsx'

// List of accounts you've muted, with one-click unmute. Mitra exposes
// GET /v1/mutes (paginated) and POST /accounts/:id/unmute.
export function MutedAccountsView({ instanceUrl, token, onOpenProfile }) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [unmutingId, setUnmutingId] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    mitra.fetchMutes(instanceUrl, token)
      .then((list) => {
        setAccounts(list)
        if (list.length < 40) setHasMore(false)
      })
      .catch((err) => setError(err.message || 'Failed to load mutes.'))
      .finally(() => setLoading(false))
  }, [])

  async function unmute(account) {
    if (unmutingId) return
    setUnmutingId(account.id)
    try {
      await mitra.unmuteAccount(instanceUrl, token, account.id)
      setAccounts((prev) => prev.filter((a) => a.id !== account.id))
    } catch (err) {
      setError(err.message || 'Unmute failed.')
    } finally {
      setUnmutingId(null)
    }
  }

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || accounts.length === 0) return
    setLoadingMore(true)
    try {
      const lastId = accounts[accounts.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchMutes(instanceUrl, token, { max_id: lastId })
      setAccounts((prev) => [...prev, ...more])
      if (more.length < 40) setHasMore(false)
    } catch {
      // silent
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, accounts])

  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore() }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  return (
    <div className="timeline-wrap">
      <div className="section-label">Muted accounts</div>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="empty-state">You haven&apos;t muted anyone.</div>
      ) : (
        <div className="timeline-list">
          {accounts.map((account) => (
            <div key={account.id} className="search-account-row">
              <Avatar name={account.display_name || account.username} src={account.avatar} onClick={() => onOpenProfile?.(account)} />
              <button
                type="button"
                className="search-account-names"
                style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
                onClick={() => onOpenProfile?.(account)}
              >
                <span className="post-name clickable">{account.display_name || account.username}</span>
                <span className="post-handle">@{account.acct || account.username}</span>
              </button>
              <button
                type="button"
                className="pill-btn muted-accounts-unmute"
                disabled={unmutingId === account.id}
                onClick={() => unmute(account)}
              >
                <Volume2 size={13} />
                {unmutingId === account.id ? '…' : 'Unmute'}
              </button>
            </div>
          ))}
        </div>
      )}
      {hasMore && accounts.length > 0 && <div ref={sentinelRef} className="scroll-sentinel" />}
      {loadingMore && <div className="empty-state">Loading…</div>}
    </div>
  )
}
