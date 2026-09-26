import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as mitra from '../lib/mitra'
import { mergeStatusIntoRow } from '../lib/render.jsx'
import { PostRow } from './Post.jsx'

// Bookmarks view: owns its list, pagination, and infinite scroll. Mounted
// only while the bookmarks view is active, so it loads on mount; App
// signals manual refreshes by bumping `refreshTick`.
export function BookmarksView({
  session, refreshTick, editedStatus,
  onOpenThread, onComposeReply, onOpenLightbox, onOpenProfile, onQuote,
  currentAccountId, onDelete, onEdit, onMute, onBlock,
}) {
  const [bookmarks, setBookmarks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef(null)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError('')
    setHasMore(true)
    try {
      const items = await mitra.fetchBookmarks(session.instanceUrl, session.token)
      setBookmarks(items)
    } catch (err) {
      setError(err.message || 'Failed to load bookmarks.')
    } finally {
      setLoading(false)
    }
  }, [session])

  const loadMore = useCallback(async () => {
    if (!session || loadingMore || !hasMore) return
    if (bookmarks.length === 0) return
    setLoadingMore(true)
    try {
      const lastId = bookmarks[bookmarks.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchBookmarks(session.instanceUrl, session.token, { max_id: lastId })
      setBookmarks((prev) => [...prev, ...more])
      if (more.length < 20) setHasMore(false)
    } catch {
      // silently fail
    } finally {
      setLoadingMore(false)
    }
  }, [session, loadingMore, hasMore, bookmarks])

  useEffect(() => {
    load()
  }, [load, refreshTick])

  // Infinite scroll observer
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore()
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, bookmarks.length])

  function updatePost(updated) {
    // Unbookmarking removes the row — the natural expectation of a list
    // of things you saved.
    if (!updated.bookmarked) {
      setBookmarks((prev) => prev.filter((p) => p.id !== updated.id && p.reblog?.id !== updated.id))
      return
    }
    setBookmarks((prev) => prev.map((p) => mergeStatusIntoRow(p, updated)))
  }

  // Edits from the global EditDialog (owned by App) are swept in here.
  useEffect(() => {
    if (editedStatus) updatePost(editedStatus)
  }, [editedStatus])

  const statusById = useMemo(() => {
    const m = new Map()
    for (const p of bookmarks) { m.set(p.id, p); if (p.reblog) m.set(p.reblog.id, p.reblog) }
    return m
  }, [bookmarks])

  return (
    <>
      {error && (
        <>
          <div className="banner banner-error">{error}</div>
          <div className="empty-state">
            <button className="pill-btn suggested" onClick={load}>Retry</button>
          </div>
        </>
      )}
      <div className="section-label">Bookmarks</div>
      {loading && bookmarks.length === 0 ? (
        <div className="empty-state">Loading…</div>
      ) : bookmarks.length === 0 ? (
        <div className="empty-state">Nothing here yet.</div>
      ) : (
        <div className="timeline-list">
          {bookmarks.map((post) => (
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
      {hasMore && !loadingMore && bookmarks.length > 0 && (
        <div ref={sentinelRef} className="scroll-sentinel" />
      )}
    </>
  )
}
