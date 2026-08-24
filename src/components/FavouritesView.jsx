import { useCallback, useEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { PostRow } from './Post.jsx'

// Posts you've favourited, newest first. Un-favouriting a post removes
// it from the list — same semantics as Bookmarks. Self-contained like
// ConversationsView: owns its data; App remounts it to refresh.
export function FavouritesView({
  instanceUrl,
  token,
  onOpenThread,
  onComposeReply,
  onOpenLightbox,
  onOpenProfile,
  onQuote,
  currentAccountId,
  onDelete,
  onMute,
  onBlock,
  onEdit,
}) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef(null)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    setHasMore(true)
    mitra.fetchFavourites(instanceUrl, token)
      .then((items) => {
        setPosts(items || [])
        if ((items || []).length < 20) setHasMore(false)
      })
      .catch((err) => setError(err.message || 'Failed to load favourites.'))
      .finally(() => setLoading(false))
  }, [instanceUrl, token])

  useEffect(() => { load() }, [load])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || posts.length === 0) return
    setLoadingMore(true)
    try {
      const lastId = posts[posts.length - 1]?.id
      const more = await mitra.fetchFavourites(instanceUrl, token, { max_id: lastId })
      setPosts((prev) => [...prev, ...more])
      if (more.length < 20) setHasMore(false)
    } catch {
      // silent
    } finally {
      setLoadingMore(false)
    }
  }, [instanceUrl, token, loadingMore, hasMore, posts])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore() }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore, posts.length])

  // Un-favouriting is the natural way out of this list — mirror the
  // bookmarks behavior where the action removes the row.
  function handleUpdate(updated) {
    setPosts((prev) => (
      updated.favourited
        ? prev.map((p) => (p.id === updated.id ? updated : p))
        : prev.filter((p) => p.id !== updated.id)
    ))
  }

  return (
    <div className="timeline-wrap">
      <div className="section-label">Favourites</div>
      {error && (
        <>
          <div className="banner banner-error">{error}</div>
          <div className="empty-state"><button className="pill-btn" onClick={load}>Retry</button></div>
        </>
      )}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : !error && posts.length === 0 ? (
        <div className="empty-state">
          <Star size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>Nothing here yet.</div>
          <div className="poll-meta">Posts you favourite will show up here.</div>
        </div>
      ) : (
        <div className="timeline-list">
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              instanceUrl={instanceUrl}
              token={token}
              onUpdate={handleUpdate}
              onOpenThread={onOpenThread}
              onComposeReply={onComposeReply}
              onOpenLightbox={onOpenLightbox}
              onOpenProfile={onOpenProfile}
              onQuote={onQuote}
              currentAccountId={currentAccountId}
              onDelete={onDelete}
              onEdit={onEdit}
              onMute={onMute}
              onBlock={onBlock}
            />
          ))}
          {hasMore && posts.length > 0 && <div ref={sentinelRef} className="scroll-sentinel" />}
          {loadingMore && <div className="empty-state">Loading…</div>}
        </div>
      )}
    </div>
  )
}
