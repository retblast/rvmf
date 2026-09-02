import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { PostRow } from './Post.jsx'

// Public timeline for a single hashtag. Same shape as the profile view:
// back button, header, post list, infinite scroll.
export function HashtagFeed({ hashtag, instanceUrl, token, onOpenThread, onComposeReply, onOpenLightbox, onOpenProfile, onUpdate, onQuote, currentAccountId, onDelete, onMute, onBlock, onEdit, onClose }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const statusById = useMemo(() => {
    const m = new Map()
    for (const p of posts) { m.set(p.id, p); if (p.reblog) m.set(p.reblog.id, p.reblog) }
    return m
  }, [posts])

  useEffect(() => {
    setPosts([])
    setLoading(true)
    setError('')
    setHasMore(true)
    mitra.fetchHashtagTimeline(instanceUrl, token, hashtag)
      .then((list) => {
        setPosts(list)
        if (list.length < 20) setHasMore(false)
      })
      .catch((err) => setError(err.message || 'Failed to load this hashtag.'))
      .finally(() => setLoading(false))
  }, [hashtag])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || posts.length === 0) return
    setLoadingMore(true)
    try {
      const lastId = posts[posts.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchHashtagTimeline(instanceUrl, token, hashtag, { max_id: lastId })
      setPosts((prev) => [...prev, ...more])
      if (more.length < 20) setHasMore(false)
    } catch {
      // silent — retry on next intersection
    } finally {
      setLoadingMore(false)
    }
  }, [hashtag, loadingMore, hasMore, posts])

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
      <div className="explore-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="icon-btn thread-back-btn" aria-label="Back" onClick={onClose}>
            <ArrowLeft size={16} />
          </button>
          <span className="section-label" style={{ paddingBottom: 0 }}>#{hashtag}</span>
        </div>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : posts.length === 0 ? (
        <div className="empty-state">Nothing here yet.</div>
      ) : (
        <div className="timeline-list">
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              instanceUrl={instanceUrl}
              token={token}
              onUpdate={(updated) => setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
              onOpenThread={onOpenThread}
              onComposeReply={onComposeReply}
              onOpenLightbox={onOpenLightbox}
              onOpenProfile={onOpenProfile}
              onQuote={onQuote}
              statusById={statusById}
              currentAccountId={currentAccountId}
              onDelete={onDelete}
              onMute={onMute}
              onBlock={onBlock}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
      {hasMore && posts.length > 0 && <div ref={sentinelRef} className="scroll-sentinel" />}
      {loadingMore && <div className="empty-state">Loading…</div>}
    </div>
  )
}
