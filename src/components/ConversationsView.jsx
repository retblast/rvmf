import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { formatRelativeTime, htmlToPlainText } from '../lib/render.jsx'
import { Avatar } from './Media.jsx'
import { PostRow } from './Post.jsx'

// Direct messages: two views behind chips — the per-conversation inbox
// and a flat timeline of every direct post. Replies flow through the
// regular composer with direct visibility.
export function ConversationsView({
  instanceUrl,
  token,
  currentAccountId,
  onOpenThread,
  onComposeReply,
  onOpenLightbox,
  onOpenProfile,
  onUpdatePost,
  onQuote,
  onDelete,
  onEdit,
  onMute,
  onBlock,
}) {
  const [tab, setTab] = useState('inbox') // 'inbox' | 'timeline'

  // ---- inbox (per-conversation rows) ----
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
    if (tab !== 'inbox') return undefined
    const el = sentinelRef.current
    if (!el) return undefined
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore() }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [tab, loadMore, conversations.length])

  // ---- flat direct-post timeline ----
  const [dmPosts, setDmPosts] = useState([])
  const [dmLoading, setDmLoading] = useState(false)
  const [dmError, setDmError] = useState('')
  const [dmHasMore, setDmHasMore] = useState(true)
  const [dmLoadingMore, setDmLoadingMore] = useState(false)
  const dmSentinelRef = useRef(null)

  const loadDms = useCallback(() => {
    setDmLoading(true)
    setDmError('')
    setDmHasMore(true)
    mitra.fetchDirectTimeline(instanceUrl, token)
      .then((items) => {
        setDmPosts(items || [])
        if ((items || []).length < 20) setDmHasMore(false)
      })
      .catch((err) => setDmError(err.message || 'Failed to load direct posts.'))
      .finally(() => setDmLoading(false))
  }, [instanceUrl, token])

  useEffect(() => {
    if (tab === 'timeline' && dmPosts.length === 0 && !dmLoading && !dmError) loadDms()
  }, [tab])

  const loadMoreDms = useCallback(async () => {
    if (dmLoadingMore || !dmHasMore || dmPosts.length === 0) return
    setDmLoadingMore(true)
    try {
      const lastId = dmPosts[dmPosts.length - 1]?.id
      const more = await mitra.fetchDirectTimeline(instanceUrl, token, { max_id: lastId })
      setDmPosts((prev) => [...prev, ...more])
      if (more.length < 20) setDmHasMore(false)
    } catch {
      // silent
    } finally {
      setDmLoadingMore(false)
    }
  }, [instanceUrl, token, dmLoadingMore, dmHasMore, dmPosts])

  useEffect(() => {
    if (tab !== 'timeline') return undefined
    const el = dmSentinelRef.current
    if (!el) return undefined
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMoreDms() }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [tab, loadMoreDms, dmPosts.length])

  function snippet(conversation) {
    const text = htmlToPlainText(conversation.last_status.content || '')
    return text.replace(/\s+/g, ' ').trim().slice(0, 120) || '(attachment)'
  }

  return (
    <div className="timeline-wrap">
      <div className="explore-header">
        <div className="section-label" style={{ paddingBottom: 0 }}>Messages</div>
        <div className="notif-filters">
          <button
            type="button"
            className={`notif-filter-chip${tab === 'inbox' ? '' : ' off'}`}
            onClick={() => setTab('inbox')}
          >
            Conversations
          </button>
          <button
            type="button"
            className={`notif-filter-chip${tab === 'timeline' ? '' : ' off'}`}
            onClick={() => setTab('timeline')}
          >
            All DMs
          </button>
        </div>
      </div>

      {tab === 'inbox' ? (
        <>
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
        </>
      ) : (
        <>
          {dmError && (
            <>
              <div className="banner banner-error">{dmError}</div>
              <div className="empty-state"><button className="pill-btn" onClick={loadDms}>Retry</button></div>
            </>
          )}
          {dmLoading ? (
            <div className="empty-state">Loading…</div>
          ) : !dmError && dmPosts.length === 0 ? (
            <div className="empty-state">
              <MessageCircle size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
              <div>No direct posts.</div>
              <div className="poll-meta">Every direct-visibility post lands here, newest first.</div>
            </div>
          ) : (
            <div className="timeline-list">
              {dmPosts.map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  instanceUrl={instanceUrl}
                  token={token}
                  onUpdate={onUpdatePost}
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
              {dmHasMore && dmPosts.length > 0 && <div ref={dmSentinelRef} className="scroll-sentinel" />}
              {dmLoadingMore && <div className="empty-state">Loading…</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
