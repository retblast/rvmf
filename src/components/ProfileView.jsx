import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ListPlus } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { processStatusContent } from '../lib/render.jsx'
import { Avatar, ProxiedImg } from './Media.jsx'
import { PostRow } from './Post.jsx'
import { ProfileEditDialog } from './ProfileEdit.jsx'

// Add/remove this profile to/from the user's lists. Membership state is
// resolved per list on open (Mitra has no bulk "lists for account"
// endpoint).
function ProfileListsMenu({ account, instanceUrl, token }) {
  const [open, setOpen] = useState(false)
  const [lists, setLists] = useState(null)
  const [member, setMember] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    mitra.fetchLists(instanceUrl, token)
      .then(async (userLists) => {
        if (cancelled) return
        setLists(userLists)
        const entries = await Promise.all(
          (userLists || []).map((list) =>
            mitra.fetchListAccounts(instanceUrl, token, list.id)
              .then((accounts) => [list.id, (accounts || []).some((a) => a.id === account.id)])
              .catch(() => [list.id, false])
          )
        )
        if (!cancelled) setMember(Object.fromEntries(entries))
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load lists.') })
    return () => { cancelled = true }
  }, [open, account.id])

  async function toggle(list) {
    if (busyId) return
    setBusyId(list.id)
    setError('')
    try {
      if (member[list.id]) {
        await mitra.removeAccountsFromList(instanceUrl, token, list.id, [account.id])
        setMember((prev) => ({ ...prev, [list.id]: false }))
      } else {
        await mitra.addAccountsToList(instanceUrl, token, list.id, [account.id])
        setMember((prev) => ({ ...prev, [list.id]: true }))
      }
    } catch (err) {
      setError(err.message || 'Update failed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="boost-dropdown-wrap">
      <button
        type="button"
        className={`pill-btn${open ? ' suggested' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Lists"
      >
        <ListPlus size={14} style={{ marginRight: 4 }} />
        Lists
      </button>
      {open && (
        <>
          <div className="boost-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="boost-dropdown profile-lists-dropdown">
            {!lists ? (
              <span className="poll-meta">Loading…</span>
            ) : lists.length === 0 ? (
              <span className="poll-meta">No lists yet — create one in Settings.</span>
            ) : (
              lists.map((list) => (
                <button
                  type="button"
                  key={list.id}
                  className="boost-dropdown-item profile-lists-item"
                  disabled={busyId === list.id}
                  onClick={() => toggle(list)}
                >
                  <input type="checkbox" checked={Boolean(member[list.id])} readOnly />
                  {list.title}
                </button>
              ))
            )}
            {error && <div className="banner banner-error">{error}</div>}
          </div>
        </>
      )}
    </div>
  )
}

export function ProfileView({ accountId, instanceUrl, token, onOpenThread, onComposeReply, onOpenLightbox, onOpenProfile, onUpdate, onQuote, currentAccountId, onDelete, onMute, onBlock, onEdit, onClose }) {
  const [account, setAccount] = useState(null)
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('posts')
  const [relationship, setRelationship] = useState(null)
  const [followBusy, setFollowBusy] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  function tabParams(t) {
    switch (t) {
      case 'posts': return { excludeReplies: true }
      case 'posts_and_replies': return {}
      case 'pinned': return { pinned: true }
      case 'media': return { onlyMedia: true }
      default: return {}
    }
  }

  useEffect(() => {
    setAccount(null)
    setStatuses([])
    setLoading(true)
    setError('')
    setTab('posts')
    setRelationship(null)
    setHasMore(true)

    mitra.fetchAccount(instanceUrl, accountId)
      .then((acct) => {
        setAccount(acct)
        return mitra.fetchAccountStatuses(instanceUrl, token, acct.id, tabParams('posts'))
      })
      .then((list) => {
        setStatuses(list)
        if (list.length < 20) setHasMore(false)
      })
      .catch((err) => setError(err.message || 'Failed to load profile.'))
      .finally(() => setLoading(false))
  }, [accountId, instanceUrl, token])

  useEffect(() => {
    if (!account || account.id === currentAccountId) return
    mitra.fetchRelationships(instanceUrl, token, [account.id])
      .then((rels) => setRelationship(rels?.[0] || null))
      .catch(() => {})
  }, [account, instanceUrl, token, currentAccountId])

  const isOwn = account?.id === currentAccountId
  const [editingProfile, setEditingProfile] = useState(false)

  async function toggleFollow() {
    if (!account || followBusy) return
    setFollowBusy(true)
    try {
      const result = relationship?.following
        ? await mitra.unfollowAccount(instanceUrl, token, account.id)
        : await mitra.followAccount(instanceUrl, token, account.id)
      setRelationship(result)
    } catch (err) {
      console.error(err)
    } finally {
      setFollowBusy(false)
    }
  }

  async function loadMore() {
    if (!account || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const lastId = statuses[statuses.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchAccountStatuses(instanceUrl, token, account.id, { ...tabParams(tab), max_id: lastId })
      setStatuses((prev) => [...prev, ...more])
      if (more.length < 20) setHasMore(false)
    } catch {
      // silent
    } finally {
      setLoadingMore(false)
    }
  }

  function switchTab(newTab) {
    if (newTab === tab) return
    setTab(newTab)
    setStatuses([])
    setHasMore(true)
    setLoading(true)
    mitra.fetchAccountStatuses(instanceUrl, token, accountId, tabParams(newTab))
      .then((list) => { setStatuses(list); if (list.length < 20) setHasMore(false) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore() }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [account, tab, statuses.length, loadingMore, hasMore])

  if (loading && !account) {
    return (
      <div className="timeline-wrap">
        <div className="empty-state">Loading…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="timeline-wrap">
        <button className="icon-btn profile-back" onClick={onClose}><ArrowLeft size={16} /></button>
        <div className="banner banner-error">{error}</div>
      </div>
    )
  }

  if (!account) return null

  const displayName = account.display_name || account.username || 'Unknown'
  const bio = account.note ? processStatusContent({ content: account.note }, instanceUrl).textNodes : null

  return (
    <div className="timeline-wrap">
      <div className="profile-view">
        <div className="profile-header-wrap">
          {account.header && account.header !== '' && (
            <ProxiedImg className="profile-header-img" src={account.header} alt="" />
          )}
          <button className="icon-btn profile-back-btn" onClick={onClose}><ArrowLeft size={16} /></button>
        </div>
        <div className="profile-info">
          <Avatar name={displayName} src={account.avatar} large />
          <div className="profile-names">
            <span className="profile-display-name">{displayName}</span>
            <span className="profile-handle">@{account.acct || account.username}</span>
            {!isOwn && relationship?.following && relationship?.followed_by && (
              <span className="profile-badge mutual">Mutual</span>
            )}
            {!isOwn && !relationship?.following && relationship?.followed_by && (
              <span className="profile-badge follows-you">Follows you</span>
            )}
          </div>
          {!isOwn && (
            <>
              <button
                className={`pill-btn ${relationship?.following ? '' : 'suggested'}`}
                onClick={toggleFollow}
                disabled={followBusy}
              >
                {followBusy ? '…' : relationship?.following ? 'Following' : 'Follow'}
              </button>
              <ProfileListsMenu account={account} instanceUrl={instanceUrl} token={token} />
            </>
          )}
          {isOwn && (
            <button className="pill-btn suggested" onClick={() => setEditingProfile(true)}>
              Edit profile
            </button>
          )}
        </div>
        {bio && <div className="profile-bio">{bio}</div>}
        <div className="profile-stats">
          <span><strong>{account.statuses_count}</strong> posts</span>
          <span><strong>{account.following_count}</strong> following</span>
          <span><strong>{account.followers_count}</strong> followers</span>
        </div>
        <div className="profile-tabs">
          <button className={`profile-tab${tab === 'posts' ? ' active' : ''}`} onClick={() => switchTab('posts')}>Posts</button>
          <button className={`profile-tab${tab === 'posts_and_replies' ? ' active' : ''}`} onClick={() => switchTab('posts_and_replies')}>Posts & Replies</button>
          <button className={`profile-tab${tab === 'pinned' ? ' active' : ''}`} onClick={() => switchTab('pinned')}>Pinned</button>
          <button className={`profile-tab${tab === 'media' ? ' active' : ''}`} onClick={() => switchTab('media')}>Media</button>
        </div>
        {loading && statuses.length === 0 ? (
          <div className="empty-state">Loading…</div>
        ) : statuses.length === 0 ? (
          <div className="empty-state">No posts yet.</div>
        ) : (
          <div className="timeline-list">
            {statuses.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                instanceUrl={instanceUrl}
                token={token}
                onUpdate={onUpdate}
                onOpenThread={onOpenThread}
                onComposeReply={onComposeReply}
                onOpenLightbox={onOpenLightbox}
                onOpenProfile={onOpenProfile}
                onQuote={onQuote}
                currentAccountId={currentAccountId}
                onDelete={onDelete}
                onMute={onMute}
                onBlock={onBlock}
                onEdit={onEdit}
              />
            ))}
          </div>
        )}
        {hasMore && statuses.length > 0 && <div ref={sentinelRef} className="scroll-sentinel" />}
        {loadingMore && <div className="empty-state">Loading…</div>}
      </div>
      {editingProfile && (
        <ProfileEditDialog
          account={account}
          instanceUrl={instanceUrl}
          token={token}
          onClose={() => setEditingProfile(false)}
          onSaved={(updated) => {
            setAccount(updated)
            setEditingProfile(false)
          }}
        />
      )}
    </div>
  )
}
