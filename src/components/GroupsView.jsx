import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Plus, Settings2, Trash2, Users } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { htmlToPlainText } from '../lib/render.jsx'
import { Avatar } from './Media.jsx'
import { PostRow } from './Post.jsx'

function GroupFeed({ group, instanceUrl, token, onClose, onPostToGroup, onManage, ...rowHandlers }) {
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
  }, [group.id, loadingMore, hasMore, posts])

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
          <button className="icon-btn" aria-label="Post to this group" title="Post to this group" onClick={() => onPostToGroup?.(group)}>
            <Plus size={16} />
          </button>
          <button className="icon-btn" aria-label="Manage group" title="Manage group" onClick={() => onManage?.(group)}>
            <Settings2 size={16} />
          </button>
        </div>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : posts.length === 0 ? (
        <div className="empty-state">
          Nothing posted to this group yet.
          <button className="pill-btn suggested" style={{ marginTop: 8 }} onClick={() => onPostToGroup?.(group)}>
            Post the first thing
          </button>
        </div>
      ) : (
        <div className="timeline-list">
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              instanceUrl={instanceUrl}
              token={token}
              onUpdate={(updated) => setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
              statusById={statusById}
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

// Description editing, members list with admin badges, and deletion.
// Deletion is type-to-confirm and orphans the group's posts server-side;
// there is no undo.
function GroupManagePanel({ group, instanceUrl, token, onOpenProfile, onDeleted, onClose }) {
  const [description, setDescription] = useState(null) // null until source loads
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [members, setMembers] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    mitra.fetchGroupSource(instanceUrl, token, group.id)
      .then((source) => { if (!cancelled) setDescription(source.description || '') })
      .catch(() => { if (!cancelled) setDescription('') })
    mitra.fetchGroupMembers(instanceUrl, token, group.id)
      .then((list) => { if (!cancelled) setMembers(list || []) })
      .catch(() => { if (!cancelled) setMembers([]) })
    return () => { cancelled = true }
  }, [group.id, instanceUrl, token])

  async function saveDescription() {
    if (saving || description === null) return
    setSaving(true)
    setError('')
    try {
      await mitra.updateGroupDescription(instanceUrl, token, group.id, description.trim() || undefined)
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt((at) => (at ? null : at)), 2500)
    } catch (err) {
      setError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const deleteConfirmed = confirmText.trim() === 'DELETE'

  async function doDelete() {
    if (!deleteConfirmed || deleting) return
    setDeleting(true)
    setError('')
    try {
      await mitra.deleteGroup(instanceUrl, token, group.id)
      onDeleted(group.id)
    } catch (err) {
      setError(err.message || 'Delete failed.')
      setDeleting(false)
    }
  }

  return (
    <div className="timeline-wrap">
      <div className="explore-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="icon-btn thread-back-btn" aria-label="Back to feed" onClick={onClose}>
            <ArrowLeft size={16} />
          </button>
          <span className="section-label" style={{ paddingBottom: 0 }}>
            Manage {group.display_name || group.username}
          </span>
        </div>
      </div>

      <div className="account-card">
        <div className="account-card-heading">Description</div>
        {description === null ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <>
            <textarea
              className="compose-textarea group-create-description"
              value={description}
              placeholder="What is this group about?"
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
            />
            <button type="button" className="pill-btn suggested" onClick={saveDescription} disabled={saving}>
              {saving ? 'Saving…' : savedAt ? 'Saved!' : 'Save description'}
            </button>
          </>
        )}
      </div>

      <div className="account-card">
        <div className="account-card-heading">Members</div>
        {!members ? (
          <div className="empty-state">Loading…</div>
        ) : members.length === 0 ? (
          <div className="poll-meta">No members yet.</div>
        ) : (
          <div className="session-list">
            {members.map(({ account, affiliation }) => (
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
                {affiliation === 'admin' && <span className="profile-badge mutual">admin</span>}
              </button>
            ))}
          </div>
        )}
        <div className="poll-meta">
          <Users size={11} style={{ marginRight: 4 }} />
          Members are accounts following this group.
        </div>
      </div>

      <div className="account-card">
        <div className="account-card-heading danger">Delete group</div>
        <div className="poll-meta">
          Removes the group. Irreversible — its address can&apos;t be reclaimed.
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
        <button type="button" className="pill-btn destructive" disabled={!deleteConfirmed || deleting} onClick={doDelete}>
          <Trash2 size={13} style={{ marginRight: 4 }} />
          {deleting ? 'Deleting…' : 'Delete group'}
        </button>
      </div>
    </div>
  )
}

// The user's groups on this instance (Mitra local groups): followed and
// moderated group timelines plus creation. Joining other groups is done
// by following the group's profile like any other account.
export function GroupsView({ instanceUrl, token, onOpenProfile, onPostToGroup, ...rowHandlers }) {
  const [groups, setGroups] = useState(null)
  const [filter, setFilter] = useState('following') // 'following' | 'moderating'
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [managing, setManaging] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')

  function reload(f = filter) {
    setGroups(null)
    mitra.fetchFollowedGroups(instanceUrl, token, { filter: f })
      .then(setGroups)
      .catch((err) => setError(err.message || 'Failed to load groups.'))
  }

  useEffect(() => {
    reload(filter)
  }, [filter])

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

  function handleGroupDeleted(_groupId) {
    setManaging(false)
    setSelected(null)
    reload()
  }

  if (selected && managing) {
    return (
      <GroupManagePanel
        group={selected}
        instanceUrl={instanceUrl}
        token={token}
        onOpenProfile={(account) => { setManaging(false); setSelected(null); onOpenProfile?.(account) }}
        onDeleted={handleGroupDeleted}
        onClose={() => setManaging(false)}
      />
    )
  }

  if (selected) {
    return (
      <GroupFeed
        group={selected}
        instanceUrl={instanceUrl}
        token={token}
        onClose={() => setSelected(null)}
        onPostToGroup={onPostToGroup}
        onManage={(group) => { setSelected(group); setManaging(true) }}
        {...rowHandlers}
      />
    )
  }

  return (
    <div className="timeline-wrap">
      <div className="explore-header">
        <div className="section-label" style={{ paddingBottom: 0 }}>Your groups</div>
        <div className="notif-filters">
          <button
            type="button"
            className={`notif-filter-chip${filter === 'following' ? '' : ' off'}`}
            onClick={() => setFilter('following')}
          >
            Following
          </button>
          <button
            type="button"
            className={`notif-filter-chip${filter === 'moderating' ? '' : ' off'}`}
            onClick={() => setFilter('moderating')}
          >
            Moderating
          </button>
        </div>
      </div>
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
        <div className="empty-state">
          {filter === 'moderating'
            ? 'You don\u2019t moderate any groups.'
            : 'You aren\u2019t in any groups yet. Follow a group\u2019s profile to join it.'}
        </div>
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
