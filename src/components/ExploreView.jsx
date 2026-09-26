import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe, Home, Users } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { mergeStatusIntoRow, htmlToPlainText as noteToPlainText } from '../lib/render.jsx'
import { PostRow } from './Post.jsx'
import { Avatar } from './Media.jsx'

// Explore: federated/local public timelines plus the people directory.
// Owns its data; mounted only while the explore view is active, so
// (re)entry loads on mount and App signals manual refreshes by bumping
// `refreshTick`.
export function ExploreView({
  session, refreshTick, editedStatus,
  onOpenThread, onComposeReply, onOpenLightbox, onOpenProfile, onQuote,
  currentAccountId, onDelete, onEdit, onMute, onBlock,
}) {
  const [feed, setFeed] = useState('federated') // 'federated' | 'local' | 'people'
  const [timelines, setTimelines] = useState({ federated: null, local: null })
  const [directoryAccounts, setDirectoryAccounts] = useState([])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryHasMore, setDirectoryHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState({ federated: true, local: true })
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef(null)

  const loadFeed = useCallback(
    async (whichFeed) => {
      if (!session) return
      setLoading(true)
      setError('')
      setHasMore((prev) => ({ ...prev, [whichFeed]: true }))
      try {
        const items = await mitra.fetchPublicTimeline(
          session.instanceUrl,
          session.token,
          whichFeed === 'local'
        )
        setTimelines((prev) => ({ ...prev, [whichFeed]: items }))
      } catch (err) {
        setError(err.message || 'Failed to load timeline.')
      } finally {
        setLoading(false)
      }
    },
    [session]
  )

  const loadMoreExplore = useCallback(async () => {
    if (!session || loadingMore || !hasMore[feed]) return
    const items = timelines[feed]
    if (!items || items.length === 0) return
    setLoadingMore(true)
    try {
      const lastId = items[items.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchPublicTimeline(
        session.instanceUrl,
        session.token,
        feed === 'local',
        { max_id: lastId }
      )
      setTimelines((prev) => ({
        ...prev,
        [feed]: [...(prev[feed] || []), ...more],
      }))
      if (more.length < 30) setHasMore((prev) => ({ ...prev, [feed]: false }))
    } catch {
      // silently fail
    } finally {
      setLoadingMore(false)
    }
  }, [session, loadingMore, hasMore, feed, timelines])

  useEffect(() => {
    if (feed !== 'people' && timelines[feed] === null) {
      loadFeed(feed)
    }
  }, [feed, timelines, loadFeed])

  // Manual refresh from the headerbar (App bumps the tick; feed switches
  // are covered by the load-on-change effect above).
  useEffect(() => {
    if (refreshTick > 0) loadFeed(feed)
  }, [refreshTick])

  const loadMoreDirectory = useCallback(async () => {
    if (!session || directoryLoading || !directoryHasMore) return
    setDirectoryLoading(true)
    try {
      const more = await mitra.fetchDirectory(
        session.instanceUrl,
        session.token,
        { offset: directoryAccounts.length }
      )
      setDirectoryAccounts((prev) => [...prev, ...more])
      if (more.length < 20) setDirectoryHasMore(false)
    } catch {
      // silent
    } finally {
      setDirectoryLoading(false)
    }
  }, [session, directoryLoading, directoryHasMore, directoryAccounts.length])

  useEffect(() => {
    if (feed === 'people' && directoryAccounts.length === 0 && !directoryLoading) {
      loadMoreDirectory()
    }
  }, [feed, directoryAccounts.length, directoryLoading, loadMoreDirectory])

  // Infinite scroll observer (both feeds share the sentinel)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          if (feed === 'people') loadMoreDirectory()
          else loadMoreExplore()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [feed, loadMoreExplore, loadMoreDirectory, timelines[feed]?.length])

  function updatePost(updated) {
    setTimelines((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        if (next[key]) next[key] = next[key].map((p) => mergeStatusIntoRow(p, updated))
      }
      return next
    })
  }

  // Edits from the global EditDialog (owned by App) are swept in here.
  useEffect(() => {
    if (editedStatus) updatePost(editedStatus)
  }, [editedStatus])

  const statusById = useMemo(() => {
    const m = new Map()
    for (const list of Object.values(timelines)) {
      if (!list) continue
      for (const p of list) { m.set(p.id, p); if (p.reblog) m.set(p.reblog.id, p.reblog) }
    }
    return m
  }, [timelines])

  return (
    <>
      {error && (
        <>
          <div className="banner banner-error">{error}</div>
          <div className="empty-state">
            <button className="pill-btn suggested" onClick={() => loadFeed(feed)}>Retry</button>
          </div>
        </>
      )}
      <div className="explore-header">
        <div className="section-label" style={{ paddingBottom: 0 }}>
          Explore
        </div>
        <div className="feed-toggle">
          <button
            className={`feed-toggle-btn${feed === 'federated' ? ' active' : ''}`}
            onClick={() => setFeed('federated')}
            type="button"
          >
            <Globe size={13} />
            Federated
          </button>
          <button
            className={`feed-toggle-btn${feed === 'local' ? ' active' : ''}`}
            onClick={() => setFeed('local')}
            type="button"
          >
            <Home size={13} />
            Local
          </button>
          <button
            className={`feed-toggle-btn${feed === 'people' ? ' active' : ''}`}
            onClick={() => setFeed('people')}
            type="button"
          >
            <Users size={13} />
            People
          </button>
        </div>
      </div>
      {feed === 'people' ? (
        directoryAccounts.length === 0 && directoryLoading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <>
            <div className="timeline-list">
              {directoryAccounts.map((account) => (
                <button
                  type="button"
                  key={account.id}
                  className="search-account-row directory-card"
                  onClick={() => onOpenProfile(account)}
                >
                  <Avatar name={account.display_name || account.username} src={account.avatar} />
                  <div className="search-account-names">
                    <span className="post-name">{account.display_name || account.username}</span>
                    <span className="post-handle">@{account.acct || account.username}</span>
                  </div>
                  <span className="directory-bio">{account.note ? noteToPlainText(account.note) : ''}</span>
                </button>
              ))}
            </div>
            {directoryHasMore && directoryAccounts.length > 0 && (
              <div ref={sentinelRef} className="scroll-sentinel" />
            )}
            {directoryLoading && <div className="empty-state">Loading…</div>}
          </>
        )
      ) : (
        <>
          {loading && !timelines[feed] ? (
            <div className="empty-state">Loading…</div>
          ) : !timelines[feed] || timelines[feed].length === 0 ? (
            <div className="empty-state">Nothing here yet.</div>
          ) : (
            <div className="timeline-list">
              {timelines[feed].map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  instanceUrl={session.instanceUrl}
                  token={session.token}
                  onUpdate={updatePost}
                  onOpenThread={onOpenThread}
                  onComposeReply={onComposeReply}
                  onOpenLightbox={onOpenLightbox}
                  onOpenProfile={onOpenProfile}
                  onQuote={onQuote}
                  statusById={statusById}
                  currentAccountId={currentAccountId}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onMute={onMute}
                  onBlock={onBlock}
                />
              ))}
            </div>
          )}
          {loadingMore && <div className="empty-state">Loading…</div>}
          {hasMore[feed] && !loadingMore && timelines[feed]?.length > 0 && (
            <div ref={sentinelRef} className="scroll-sentinel" />
          )}
        </>
      )}
    </>
  )
}
