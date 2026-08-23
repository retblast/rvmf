import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { formatRelativeTime, htmlToPlainText } from '../lib/render.jsx'
import { Avatar } from './Media.jsx'

// Direct-message inbox. Each row is a conversation: participant
// avatars/names plus a snippet of the latest post. Clicking opens the
// thread of that post — replies flow through the regular composer with
// direct visibility.
export function ConversationsView({ instanceUrl, token, currentAccountId, onOpenThread }) {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef(null)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    setHasMore(true)
    mitra.fetchConversations(instanceUrl, token)
      .then((items) => {
        setConversations(items || [])
        if ((items || []).length < 20) setHasMore(false)
      })
      .catch((err) => setError(err.message || 'Failed to load messages.'))
      .finally(() => setLoading(false))
  }, [instanceUrl, token])

  useEffect(() => { load() }, [load])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || conversations.length === 0) return
    setLoadingMore(true)
    try {
      const lastId = conversations[conversations.length - 1]?.id
      const more = await mitra.fetchConversations(instanceUrl, token, { max_id: lastId })
      setConversations((prev) => [...prev, ...more])
      if (more.length < 20) setHasMore(false)
    } catch {
      // silent
    } finally {
      setLoadingMore(false)
    }
  }, [instanceUrl, token, loadingMore, hasMore, conversations])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore() }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore, conversations.length])

  function snippet(conversation) {
    const text = htmlToPlainText(conversation.last_status.content || '')
    return text.replace(/\s+/g, ' ').trim().slice(0, 120) || '(attachment)'
  }

  return (
    <div className="timeline-wrap">
      <div className="section-label">Messages</div>
      {error && (
        <>
          <div className="banner banner-error">{error}</div>
          <div className="empty-state"><button className="pill-btn" onClick={load}>Retry</button></div>
        </>
      )}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : !error && conversations.length === 0 ? (
        <div className="empty-state">
          <MessageCircle size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No conversations yet.</div>
          <div className="poll-meta">Send someone a post with Direct visibility to start one.</div>
        </div>
      ) : (
        <div className="timeline-list">
          {conversations.map((conversation) => {
            const others = (conversation.accounts || []).filter((a) => a.id !== currentAccountId)
            const names = others.map((a) => a.display_name || a.username).join(', ') || 'You'
            const status = conversation.last_status
            return (
              <button key={conversation.id} type="button" className="dm-row" onClick={() => onOpenThread(status)}>
                <div className="dm-avatars">
                  {others.slice(0, 3).map((a) => (
                    <Avatar key={a.id} name={a.display_name || a.username} src={a.avatar} />
                  ))}
                </div>
                <div className="dm-main">
                  <div className="dm-topline">
                    <span className="dm-name">{names}</span>
                    <span className="post-time">{formatRelativeTime(status.created_at)}</span>
                  </div>
                  <div className="dm-snippet">{snippet(conversation)}</div>
                </div>
              </button>
            )
          })}
          {hasMore && conversations.length > 0 && <div ref={sentinelRef} className="scroll-sentinel" />}
          {loadingMore && <div className="empty-state">Loading…</div>}
        </div>
      )}
    </div>
  )
}
