import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Plus, Users } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { htmlToPlainText } from '../lib/render.jsx'
import { Avatar } from './Media.jsx'
import { PostRow } from './Post.jsx'

function GroupFeed({ group, instanceUrl, token, onClose, ...rowHandlers }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    setPosts([])
    setLoading(true)
    setError('')
    setHasMore(true)
    mitra.fetchGroupTimeline(instanceUrl, token, group.id)
      .then((list) => {
        setPosts(list)
        if (list.length < 20) setHasMore(false)
      })
      .catch((err) => setError(err.message || 'Failed to load this group.'))
      .finally(() => setLoading(false))
  }, [group.id])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || posts.length === 0) return
    setLoadingMore(true)
    try {
      const lastId = posts[posts.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchGroupTimeline(instanceUrl, token, group.id, { max_id: lastId })
      setPosts((prev) => [...prev, ...more])
      if (more.length < 20) setHasMore(false)
    } catch {
      // silent
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, posts])

  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore() }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  return (
    <>
      <div className="explore-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="icon-btn thread-back-btn" aria-label="Back" onClick={onClose}>
            <ArrowLeft size={16} />
          </button>
          <span className="section-label" style={{ paddingBottom: 0 }}>{group.display_name || group.username}</span>
        </div>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : posts.length === 0 ? (
        <div className="empty-state">Nothing posted to this group yet.</div>
      ) : (
        <div className="timeline-list">
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              instanceUrl={instanceUrl}
              token={token}
              onUpdate={(updated) => setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
              {...rowHandlers}
            />
          ))}
        </div>
      )}
      {hasMore && posts.length > 0 && <div ref={sentinelRef} className="scroll-sentinel" />}
      {loadingMore && <div className="empty-state">Loading…</div>}
    </>
  )
}

// The user's groups on this instance (Mitra local groups): followed
// group timelines plus creation. Joining other groups is done by
// following the group's profile like any other account.
export function GroupsView({ instanceUrl, token, onOpenProfile, ...rowHandlers }) {
  const [groups, setGroups] = useState(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')

  function reload() {
    mitra.fetchFollowedGroups(instanceUrl, token)
      .then(setGroups)
      .catch((err) => setError(err.message || 'Failed to load groups.'))
  }

  useEffect(reload, [])

  async function handleCreate() {
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      await mitra.createGroup(instanceUrl, token, name, newDescription.trim() || undefined)
      setCreating(false)
      setNewName('')
      setNewDescription('')
      reload()
    } catch (err) {
      setError(err.message || 'Could not create the group.')
      setCreating(false)
    }
  }

  if (selected) {
    return (
      <div className="timeline-wrap">
        <GroupFeed group={selected} instanceUrl={instanceUrl} token={token} onClose={() => setSelected(null)} {...rowHandlers} />
      </div>
    )
  }

  return (
    <div className="timeline-wrap">
      <div className="section-label">Your groups</div>
      {error && <div className="banner banner-error">{error}</div>}
      <details className="group-create">
        <summary><Plus size={14} /> Create a group</summary>
        <input
          type="text"
          className="search-input lists-create-input"
          value={newName}
          placeholder="Group name (lowercase)"
          onChange={(e) => setNewName(e.target.value)}
        />
        <textarea
          className="compose-textarea group-create-description"
          value={newDescription}
          placeholder="Description (optional)"
          rows={2}
          onChange={(e) => setNewDescription(e.target.value)}
        />
        <button
          type="button"
          className="pill-btn suggested"
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
        >
          {creating ? 'Creating…' : 'Create group'}
        </button>
      </details>
      {!groups ? (
        <div className="empty-state">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="empty-state">You aren&apos;t in any groups yet. Follow a group&apos;s profile to join it.</div>
      ) : (
        <div className="timeline-list">
          {groups.map((group) => (
            <button
              type="button"
              key={group.id}
              className="search-account-row directory-card"
              onClick={() => setSelected(group)}
            >
              <Avatar name={group.display_name || group.username} src={group.avatar} />
              <div className="search-account-names">
                <span className="post-name">{group.display_name || group.username}</span>
                <span className="post-handle">@{group.acct || group.username}</span>
              </div>
              {group.note && (
                <span className="directory-bio">
                  <Users size={11} style={{ marginRight: 4 }} />
                  {htmlToPlainText(group.note)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
