import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Pencil, Trash2, X } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { PostRow } from './Post.jsx'

// Posts from accounts in one of the user's lists
// (Mitra custom feeds, Mastodon-shaped /v1/timelines/list/:id).
function ListFeed({ list, instanceUrl, token, onClose, ...rowHandlers }) {
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
    mitra.fetchListTimeline(instanceUrl, token, list.id)
      .then((list2) => {
        setPosts(list2)
        if (list2.length < 20) setHasMore(false)
      })
      .catch((err) => setError(err.message || 'Failed to load this list.'))
      .finally(() => setLoading(false))
  }, [list.id])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || posts.length === 0) return
    setLoadingMore(true)
    try {
      const lastId = posts[posts.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchListTimeline(instanceUrl, token, list.id, { max_id: lastId })
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
          <span className="section-label" style={{ paddingBottom: 0 }}>{list.title}</span>
        </div>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : posts.length === 0 ? (
        <div className="empty-state">Nothing here yet. Add people to this list from their profiles.</div>
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

export function ListsView({ instanceUrl, token, ...rowHandlers }) {
  const [lists, setLists] = useState(null)
  const [error, setError] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [selected, setSelected] = useState(null)

  function reload() {
    mitra.fetchLists(instanceUrl, token)
      .then(setLists)
      .catch((err) => setError(err.message || 'Failed to load lists.'))
  }

  useEffect(reload, [])

  async function handleCreate() {
    const title = newTitle.trim()
    if (!title || creating) return
    setCreating(true)
    try {
      const list = await mitra.createList(instanceUrl, token, title)
      setLists((prev) => [...(prev || []), list])
      setNewTitle('')
    } catch (err) {
      setError(err.message || 'Could not create the list.')
    } finally {
      setCreating(false)
    }
  }

  async function handleRename(list) {
    const title = renameTitle.trim()
    if (!title) return
    try {
      const updated = await mitra.updateList(instanceUrl, token, list.id, title)
      setLists((prev) => prev.map((l) => (l.id === list.id ? updated : l)))
      if (selected?.id === list.id) setSelected(updated)
      setRenamingId(null)
    } catch (err) {
      setError(err.message || 'Rename failed.')
    }
  }

  async function handleDelete(list) {
    try {
      await mitra.deleteList(instanceUrl, token, list.id)
      setLists((prev) => prev.filter((l) => l.id !== list.id))
      if (selected?.id === list.id) setSelected(null)
    } catch (err) {
      setError(err.message || 'Delete failed.')
    }
  }

  if (selected) {
    return (
      <div className="timeline-wrap">
        <ListFeed list={selected} instanceUrl={instanceUrl} token={token} onClose={() => setSelected(null)} {...rowHandlers} />
      </div>
    )
  }

  return (
    <div className="timeline-wrap">
      <div className="section-label">Lists</div>
      {error && <div className="banner banner-error">{error}</div>}
      <div className="lists-create-row">
        <input
          type="text"
          className="search-input lists-create-input"
          value={newTitle}
          placeholder="New list name…"
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
        />
        <button type="button" className="pill-btn suggested" onClick={handleCreate} disabled={creating || !newTitle.trim()}>
          Create
        </button>
      </div>
      {!lists ? (
        <div className="empty-state">Loading…</div>
      ) : lists.length === 0 ? (
        <div className="empty-state">No lists yet.</div>
      ) : (
        <div className="timeline-list">
          {lists.map((list) => (
            <div key={list.id} className="list-row">
              {renamingId === list.id ? (
                <>
                  <input
                    type="text"
                    className="search-input lists-create-input"
                    value={renameTitle}
                    autoFocus
                    onChange={(e) => setRenameTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(list)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                  <button type="button" className="icon-btn" aria-label="Save name" onClick={() => handleRename(list)}>
                    <Check size={14} />
                  </button>
                  <button type="button" className="icon-btn" aria-label="Cancel rename" onClick={() => setRenamingId(null)}>
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="list-row-title clickable" onClick={() => setSelected(list)}>
                    {list.title}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Rename ${list.title}`}
                    onClick={() => { setRenamingId(list.id); setRenameTitle(list.title) }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Delete ${list.title}`} onClick={() => handleDelete(list)}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
