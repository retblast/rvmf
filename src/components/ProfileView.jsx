import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ListPlus, LoaderCircle, Settings2 } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { formatRelativeTime, processStatusContent } from '../lib/render.jsx'
import { Avatar, ProxiedImg } from './Media.jsx'
import { PostRow } from './Post.jsx'
import { ProfileEditDialog } from './ProfileEdit.jsx'

// Which of the user's lists contain this account. Membership comes from
// one /accounts/:id/lists call; the full list collection is fetched once
// so non-member lists can be offered too.
function ProfileListsMenu({ account, instanceUrl, token }) {
  const [open, setOpen] = useState(false)
  const [lists, setLists] = useState(null)
  const [memberIds, setMemberIds] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    Promise.all([
      mitra.fetchLists(instanceUrl, token),
      mitra.fetchAccountLists(instanceUrl, token, account.id).catch(() => []),
    ])
      .then(([userLists, memberLists]) => {
        if (cancelled) return
        setLists(userLists)
        setMemberIds(new Set((memberLists || []).map((l) => l.id)))
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load lists.') })
    return () => { cancelled = true }
  }, [open, account.id])

  async function toggle(list) {
    if (busyId) return
    setBusyId(list.id)
    setError('')
    const isMember = memberIds?.has(list.id)
    try {
      if (isMember) {
        await mitra.removeAccountsFromList(instanceUrl, token, list.id, [account.id])
        setMemberIds((prev) => { const next = new Set(prev); next.delete(list.id); return next })
      } else {
        await mitra.addAccountsToList(instanceUrl, token, list.id, [account.id])
        setMemberIds((prev) => new Set(prev).add(list.id))
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
            {!lists || !memberIds ? (
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
                  <input type="checkbox" checked={memberIds.has(list.id)} readOnly />
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

// Follow tuning: whether this account's reposts/replies appear in your
// home timeline. Re-POSTs /follow with the changed flag.
function FollowOptions({ account, instanceUrl, token, relationship, onUpdate }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function setOption(key, value) {
    try {
      const updated = await mitra.followAccount(instanceUrl, token, account.id, { [key]: value })
      onUpdate(updated)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="boost-dropdown-wrap" ref={ref}>
      <button
        type="button"
        className={`icon-btn${open ? ' active' : ''}`}
        aria-label="Follow options"
        title="Timeline options"
        onClick={() => setOpen((v) => !v)}
      >
        <Settings2 size={14} />
      </button>
      {open && (
        <>
          <div className="boost-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="boost-dropdown follow-options-dropdown">
            <label className="profile-edit-toggles-row">
              <input
                type="checkbox"
                checked={relationship?.reblogs !== false}
                onChange={(e) => setOption('reblogs', e.target.checked)}
              />
              Show reposts in home timeline
            </label>
            <label className="profile-edit-toggles-row">
              <input
                type="checkbox"
                checked={relationship?.replies !== false}
                onChange={(e) => setOption('replies', e.target.checked)}
              />
              Show replies in home timeline
            </label>
          </div>
        </>
      )}
    </div>
  )
}

const PEOPLE_PAGE_SIZE = 40

// Followers / following / subscribers listing opened from the profile
// stats row. Subscribers rows carry an expiry instead of a bio; your own
// followers can be removed.
function PeopleListPanel({ kind, account, isOwn, instanceUrl, token, onOpenProfile, onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [removingId, setRemovingId] = useState(null)
  const sentinelRef = useRef(null)

  useEffect(() => {
    setItems([])
    setLoading(true)
    setError('')
    setHasMore(true)
    load()
  }, [kind, account.id])

  function fetchPage(maxId) {
    if (kind === 'followers') return mitra.fetchFollowers(instanceUrl, token, account.id, { max_id: maxId })
    if (kind === 'following') return mitra.fetchFollowing(instanceUrl, token, account.id, { max_id: maxId })
    return mitra.fetchSubscribers(instanceUrl, token, account.id, { max_id: maxId })
  }

  async function load() {
    try {
      const page = await fetchPage()
      setItems(page || [])
      if ((page || []).length < PEOPLE_PAGE_SIZE) setHasMore(false)
    } catch (err) {
      setError(err.message || 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore || items.length === 0) return
    setLoadingMore(true)
    try {
      const lastId = items[items.length - 1]?.id
      const more = lastId ? await fetchPage(lastId) : []
      setItems((prev) => [...prev, ...more])
      if (more.length < PEOPLE_PAGE_SIZE) setHasMore(false)
    } catch {
      // silent
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return undefined
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore() }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [items.length, loadingMore, hasMore])

  // Only works on your own followers; the person isn't notified.
  async function removeFollower(item) {
    if (!isOwn || removingId) return
    setRemovingId(item.id)
    try {
      await mitra.removeFromFollowers(instanceUrl, token, item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
    } catch (err) {
      setError(err.message || 'Remove failed.')
    } finally {
      setRemovingId(null)
    }
  }

  const heading = kind === 'followers' ? 'Followers' : kind === 'following' ? 'Following' : 'Subscribers'

  return (
    <div className="people-panel">
      <div className="explore-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="icon-btn thread-back-btn" aria-label="Back" onClick={onClose}>
            <ArrowLeft size={16} />
          </button>
          <span className="section-label" style={{ paddingBottom: 0 }}>{heading}</span>
        </div>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty-state">Nobody here yet.</div>
      ) : (
        <div className="timeline-list">
          {items.map((item) => {
            const person = kind === 'subscribers' ? (item.sender || {}) : item
            return (
              <div key={item.id} className="search-account-row">
                <Avatar name={person.display_name || person.username} src={person.avatar} onClick={() => onOpenProfile?.(person)} />
                <button
                  type="button"
                  className="search-account-names"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
                  onClick={() => onOpenProfile?.(person)}
                >
                  <span className="post-name clickable">{person.display_name || person.username}</span>
                  <span className="post-handle">@{person.acct || person.username}</span>
                </button>
                {kind === 'subscribers' && item.expires_at && (
                  <span className="post-time">until {formatRelativeTime(item.expires_at)}</span>
                )}
                {kind === 'followers' && isOwn && (
                  <button
                    type="button"
                    className="pill-btn muted-accounts-unmute"
                    disabled={removingId === item.id}
                    onClick={() => removeFollower(item)}
                  >
                    {removingId === item.id ? '…' : 'Remove'}
                  </button>
                )}
              </div>
            )
          })}
          {hasMore && items.length > 0 && <div ref={sentinelRef} className="scroll-sentinel" />}
          {loadingMore && <div className="empty-state">Loading…</div>}
        </div>
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
  const [peopleList, setPeopleList] = useState(null)
  const [backfilling, setBackfilling] = useState(false)

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
    setPeopleList(null)

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
      // A pending (requested) follow is cancelled by the same unfollow
      // endpoint on Mitra — it withdraws the outstanding request.
      const result = (relationship?.following || relationship?.requested)
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

  // Remote profiles only arrive with whatever the instance has cached;
  // this asks the origin server for the rest, then reloads the current
  // tab so newly-fetched posts appear immediately.
  async function backfillFromOrigin() {
    if (!account || backfilling) return
    setBackfilling(true)
    try {
      await mitra.loadRemoteActivities(instanceUrl, token, account.id)
      const list = await mitra.fetchAccountStatuses(instanceUrl, token, account.id, tabParams(tab))
      setStatuses(list)
      if (list.length < 20) setHasMore(false)
    } catch (err) {
      console.error(err)
    } finally {
      setBackfilling(false)
    }
  }

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
  const isRemote = Boolean(account.acct?.includes('@'))

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
            {!isOwn && relationship?.requested && (
              <span className="profile-badge requested">Request pending</span>
            )}
          </div>
          {!isOwn && (
            <>
              <button
                className={`pill-btn ${relationship?.following || relationship?.requested ? '' : 'suggested'}`}
                onClick={toggleFollow}
                disabled={followBusy}
              >
                {followBusy
                  ? '…'
                  : relationship?.following
                    ? 'Following'
                    : relationship?.requested
                      ? 'Requested'
                      : 'Follow'}
              </button>
              {relationship?.following && (
                <FollowOptions
                  account={account}
                  instanceUrl={instanceUrl}
                  token={token}
                  relationship={relationship}
                  onUpdate={setRelationship}
                />
              )}
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
          <button
            type="button"
            className={`profile-stat-link${peopleList === 'following' ? ' active' : ''}`}
            onClick={() => setPeopleList(peopleList === 'following' ? null : 'following')}
          >
            <strong>{account.following_count}</strong> following
          </button>
          <button
            type="button"
            className={`profile-stat-link${peopleList === 'followers' ? ' active' : ''}`}
            onClick={() => setPeopleList(peopleList === 'followers' ? null : 'followers')}
          >
            <strong>{account.followers_count}</strong> followers
          </button>
          {(isOwn || account.subscribers_count > 0) && (
            <button
              type="button"
              className={`profile-stat-link${peopleList === 'subscribers' ? ' active' : ''}`}
              onClick={() => setPeopleList(peopleList === 'subscribers' ? null : 'subscribers')}
            >
              <strong>{account.subscribers_count ?? 0}</strong> subscribers
            </button>
          )}
        </div>
        {peopleList && (
          <PeopleListPanel
            kind={peopleList}
            account={account}
            isOwn={isOwn}
            instanceUrl={instanceUrl}
            token={token}
            onOpenProfile={(person) => { setPeopleList(null); onOpenProfile(person) }}
            onClose={() => setPeopleList(null)}
          />
        )}
        {!peopleList && (
          <>
            {isRemote && (
              <button
                type="button"
                className="pill-btn backfill-btn"
                onClick={backfillFromOrigin}
                disabled={backfilling}
              >
                <LoaderCircle size={13} className={backfilling ? 'spin' : undefined} style={{ marginRight: 4 }} />
                {backfilling ? 'Fetching from origin…' : 'Load older posts from origin'}
              </button>
            )}
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
          </>
        )}
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
