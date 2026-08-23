import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Rss,
  Home,
  Bell,
  Compass,
  Bookmark,
  Search,
  Plus,
  RotateCw,
  LogOut,
  Globe,
  Settings,
} from 'lucide-react'
import { useMitraSession } from './useMitraSession'
import * as mitra from './lib/mitra'
import { buildReplyTree, findNode, insertIntoTree, updateTreeNode } from './lib/render.jsx'
import { AppSettingsContext, PickerContext, useLayoutTier } from './hooks'
import LoginView from './LoginView'
import { Avatar, MediaLightbox } from './components/Media.jsx'
import { NotificationRow, PostRow } from './components/Post.jsx'
import { ComposeDialog, EditDialog } from './components/Compose.jsx'
import { ThreadPanel, ThreadPanelContent } from './components/ThreadPanel.jsx'
import { ProfileView } from './components/ProfileView.jsx'
import { SearchView } from './components/SearchView.jsx'
import { HashtagFeed } from './components/HashtagFeed.jsx'

export default function App() {
  const { session, beginLogin, logout, authError, completingLogin } = useMitraSession()
  const tier = useLayoutTier()
  const [view, setView] = useState('home')
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [composing, setComposing] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState(null)
  const [editing, setEditing] = useState(null)
  const [openPickerId, setOpenPickerId] = useState(null)
  const [replyStates, setReplyStates] = useState({})
  const replyStatesRef = useRef(replyStates)
  replyStatesRef.current = replyStates
  const [sidePanel, setSidePanel] = useState(null)
  const sidePanelRef = useRef(sidePanel)
  sidePanelRef.current = sidePanel
  const [profileAccountId, setProfileAccountId] = useState(null)
  const [hashtagTag, setHashtagTag] = useState(null)
  const [focusedReplyId, setFocusedReplyId] = useState(null)
  const [lightboxAttachment, setLightboxAttachment] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState('')
  const [exploreFeed, setExploreFeed] = useState('federated') // 'federated' | 'local'
  const [exploreTimelines, setExploreTimelines] = useState({ federated: null, local: null })
  const [exploreLoading, setExploreLoading] = useState(false)
  const [exploreError, setExploreError] = useState('')
  const [exploreHasMore, setExploreHasMore] = useState({ federated: true, local: true })
  const [exploreLoadingMore, setExploreLoadingMore] = useState(false)
  const exploreSentinelRef = useRef(null)
  const [bookmarks, setBookmarks] = useState([])
  const [bookmarksLoading, setBookmarksLoading] = useState(false)
  const [bookmarksError, setBookmarksError] = useState('')
  const [bookmarksHasMore, setBookmarksHasMore] = useState(true)
  const [bookmarksLoadingMore, setBookmarksLoadingMore] = useState(false)
  const bookmarksSentinelRef = useRef(null)
  const [hoverPreviewsEnabled, setHoverPreviewsEnabled] = useState(() => {
    try {
      return localStorage.getItem('mitra-hover-previews') !== 'false'
    } catch {
      return true
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [clientName, setClientNameState] = useState(() => mitra.getClientName())
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  function toggleHoverPreviews() {
    setHoverPreviewsEnabled((prev) => {
      const next = !prev
      try {
        localStorage.setItem('mitra-hover-previews', String(next))
      } catch {
        // localStorage unavailable — setting just won't persist across reloads
      }
      return next
    })
  }

  const [fetchClientMedia, setFetchClientMedia] = useState(() => {
    try {
      return localStorage.getItem('mitra-fetch-client-media') !== 'false'
    } catch {
      return true
    }
  })

  function toggleFetchClientMedia() {
    setFetchClientMedia((prev) => {
      const next = !prev
      try {
        localStorage.setItem('mitra-fetch-client-media', String(next))
      } catch {}
      return next
    })
  }

  function handleClientNameChange(name) {
    setClientNameState(name)
    mitra.setClientName(name)
    if (session) {
      mitra.clearAppCredentials(session.instanceUrl)
      logout()
    }
  }

  const [themeMode, setThemeMode] = useState(() => {
    try {
      return localStorage.getItem('mitra-theme-mode') || 'system'
    } catch {
      return 'system'
    }
  })

  useEffect(() => {
    const root = document.documentElement
    if (themeMode === 'system') {
      delete root.dataset.theme
    } else {
      root.dataset.theme = themeMode
    }
    try {
      localStorage.setItem('mitra-theme-mode', themeMode)
    } catch {}
  }, [themeMode])

  const loadTimeline = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError('')
    setHasMore(true)
    try {
      const statuses = await mitra.fetchHomeTimeline(session.instanceUrl, session.token)
      setTimeline(statuses)
    } catch (err) {
      setError(err.message || 'Failed to load timeline.')
    } finally {
      setLoading(false)
    }
  }, [session])

  const loadMoreTimeline = useCallback(async () => {
    if (!session || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const lastId = timeline[timeline.length - 1]?.id
      if (!lastId) return
      const statuses = await mitra.fetchHomeTimeline(session.instanceUrl, session.token, { max_id: lastId })
      setTimeline((prev) => [...prev, ...statuses])
      if (statuses.length < 10) setHasMore(false)
    } catch {
      // silently fail — user can scroll again to retry
    } finally {
      setLoadingMore(false)
    }
  }, [session, loadingMore, hasMore, timeline])

  useEffect(() => {
    loadTimeline()
  }, [loadTimeline])

  useEffect(() => {
    if (view !== 'home') return
    const sentinel = document.querySelector('.scroll-sentinel')
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreTimeline()
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [view, loadMoreTimeline, timeline.length])

  const loadNotifications = useCallback(async () => {
    if (!session) return
    setNotificationsLoading(true)
    setNotificationsError('')
    try {
      const items = await mitra.fetchNotifications(session.instanceUrl, session.token)
      setNotifications(items)
    } catch (err) {
      setNotificationsError(err.message || 'Failed to load notifications.')
    } finally {
      setNotificationsLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (view === 'notifications' || tier === 'wide') {
      loadNotifications()
    }
  }, [view, tier, loadNotifications])

  // Wide tier shows notifications as a permanent column, not a tab — if
  // the window shrinks below wide while "Notifications" is the active
  // tab-view, there'd be nothing in the main content area. Fall back to
  // Home.
  useEffect(() => {
    if (tier === 'wide' && view === 'notifications') {
      setView('home')
    }
  }, [tier, view])

  const loadExplore = useCallback(
    async (feed) => {
      if (!session) return
      setExploreLoading(true)
      setExploreError('')
      setExploreHasMore((prev) => ({ ...prev, [feed]: true }))
      try {
        const items = await mitra.fetchPublicTimeline(
          session.instanceUrl,
          session.token,
          feed === 'local'
        )
        setExploreTimelines((prev) => ({ ...prev, [feed]: items }))
      } catch (err) {
        setExploreError(err.message || 'Failed to load timeline.')
      } finally {
        setExploreLoading(false)
      }
    },
    [session]
  )

  const loadMoreExplore = useCallback(async () => {
    if (!session || exploreLoadingMore || !exploreHasMore[exploreFeed]) return
    const items = exploreTimelines[exploreFeed]
    if (!items || items.length === 0) return
    setExploreLoadingMore(true)
    try {
      const lastId = items[items.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchPublicTimeline(
        session.instanceUrl,
        session.token,
        exploreFeed === 'local',
        { max_id: lastId }
      )
      setExploreTimelines((prev) => ({
        ...prev,
        [exploreFeed]: [...(prev[exploreFeed] || []), ...more],
      }))
      if (more.length < 30) setExploreHasMore((prev) => ({ ...prev, [exploreFeed]: false }))
    } catch {
      // silently fail
    } finally {
      setExploreLoadingMore(false)
    }
  }, [session, exploreLoadingMore, exploreHasMore, exploreFeed, exploreTimelines])

  useEffect(() => {
    if (view === 'explore' && exploreTimelines[exploreFeed] === null) {
      loadExplore(exploreFeed)
    }
  }, [view, exploreFeed, exploreTimelines, loadExplore])

  const loadBookmarks = useCallback(async () => {
    if (!session) return
    setBookmarksLoading(true)
    setBookmarksError('')
    setBookmarksHasMore(true)
    try {
      const items = await mitra.fetchBookmarks(session.instanceUrl, session.token)
      setBookmarks(items)
    } catch (err) {
      setBookmarksError(err.message || 'Failed to load bookmarks.')
    } finally {
      setBookmarksLoading(false)
    }
  }, [session])

  const loadMoreBookmarks = useCallback(async () => {
    if (!session || bookmarksLoadingMore || !bookmarksHasMore) return
    if (bookmarks.length === 0) return
    setBookmarksLoadingMore(true)
    try {
      const lastId = bookmarks[bookmarks.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchBookmarks(session.instanceUrl, session.token, { max_id: lastId })
      setBookmarks((prev) => [...prev, ...more])
      if (more.length < 20) setBookmarksHasMore(false)
    } catch {
      // silently fail
    } finally {
      setBookmarksLoadingMore(false)
    }
  }, [session, bookmarksLoadingMore, bookmarksHasMore, bookmarks])

  useEffect(() => {
    if (view === 'bookmarks') {
      loadBookmarks()
    }
  }, [view, loadBookmarks])

  // Bookmarks infinite scroll observer
  useEffect(() => {
    if (view !== 'bookmarks') return
    const sentinel = bookmarksSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreBookmarks()
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [view, loadMoreBookmarks, bookmarks.length])

  // Explore infinite scroll observer
  useEffect(() => {
    if (view !== 'explore') return
    const sentinel = exploreSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreExplore()
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [view, loadMoreExplore, exploreTimelines[exploreFeed]?.length])

  function updateExplorePost(updated) {
    setExploreTimelines((prev) => ({
      ...prev,
      [exploreFeed]: prev[exploreFeed]?.map((p) => (p.id === updated.id ? updated : p)) ?? null,
    }))
  }

  async function respondFollowRequest(accountId, action) {
    await mitra.respondFollowRequest(session.instanceUrl, session.token, accountId, action)
  }

  async function handleDeleteStatus(statusId) {
    try {
      await mitra.deleteStatus(session.instanceUrl, session.token, statusId)
      setTimeline((prev) => prev.filter((p) => p.id !== statusId))
      if (sidePanel?.status?.id === statusId) setSidePanel(null)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleMuteAccount(accountId) {
    try {
      await mitra.muteAccount(session.instanceUrl, session.token, accountId)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleBlockAccount(accountId) {
    try {
      await mitra.blockAccount(session.instanceUrl, session.token, accountId)
    } catch (err) {
      console.error(err)
    }
  }

  function handleRefresh() {
    if (view === 'notifications') {
      loadNotifications()
    } else if (view === 'explore') {
      setExploreHasMore((prev) => ({ ...prev, [exploreFeed]: true }))
      loadExplore(exploreFeed)
    } else if (view === 'bookmarks') {
      loadBookmarks()
    } else {
      loadTimeline()
    }
  }

  function updatePost(updated) {
    setTimeline((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  function handleEditStatus(status) {
    setEditing(status)
  }

  // After an edit saves, sweep the updated status through every surface
  // it might appear on — the helpers no-op when the id isn't found.
  function handleEditSaved(updated) {
    setEditing(null)
    updatePost(updated)
    updateExplorePost(updated)
    updateBookmarkedPost(updated)
    updateNotificationStatus(updated)
    if (sidePanel?.status) updateReplyInPanel(updated)
  }

  // In the bookmarks list, unbookmarking removes the row — that's the
  // natural expectation of a list of things you saved.
  function updateBookmarkedPost(updated) {
    if (!updated.bookmarked) {
      setBookmarks((prev) => prev.filter((p) => p.id !== updated.id))
      return
    }
    setBookmarks((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  function prependPost(post) {
    setTimeline((prev) => [post, ...prev])
  }

  // Fetches the ENTIRE descendant tree for `status` (not just its direct
  // children — /context returns every depth in one call) plus its
  // ancestors, and always refetches on open rather than relying on a
  // stale cache, so what's shown is actually current. Every thread opens
  // through this, unconditionally — the OP, a notification's status, a
  // reply, a reply to a reply, all the same path, all the same panel.
  const ensureRepliesLoaded = useCallback(
    (status) => {
      setReplyStates((prev) => {
        if (prev[status.id]?.items) return prev
        return { ...prev, [status.id]: { ...(prev[status.id] || {}), loading: true, error: '' } }
      })

      if (replyStatesRef.current[status.id]?.items) return

      mitra
        .fetchContext(session.instanceUrl, session.token, status.id)
        .then((context) => {
          const tree = buildReplyTree(context.descendants, status.id)
          setReplyStates((prev) => ({
            ...prev,
            [status.id]: { loading: false, error: '', items: tree, ancestors: context.ancestors },
          }))
        })
        .catch((err) => {
          setReplyStates((prev) => ({
            ...prev,
            [status.id]: {
              ...(prev[status.id] || {}),
              loading: false,
              error: err.message || 'Failed to load replies.',
            },
          }))
        })
    },
    [session]
  )

  // Opens the side panel for `status` — ancestors and the full reply tree —
  // or closes it if that same status is already showing. This is the only
  // way threads open anywhere in the app now: always the slide-out panel,
  // never inline in the timeline.
  function handleOpenThread(status) {
    setSidePanel((prev) =>
      prev?.mode === 'thread' && prev.status.id === status.id ? prev : { mode: 'thread', status }
    )
    ensureRepliesLoaded(status)
  }

  // Opens the reply-compose slide-out for `status`.
  function handleComposeReply(status) {
    setSidePanel((prev) => {
      if (prev?.mode === 'thread') {
        return { ...prev, composingStatusId: status.id }
      }
      return { mode: 'compose', status, threadRoot: null }
    })
  }

  function handleCancelCompose() {
    setSidePanel((prev) => {
      if (!prev || !prev.composingStatusId) return prev
      const { composingStatusId, ...rest } = prev
      return rest
    })
  }

  // Opens the profile view for an account.
  function handleOpenProfile(account) {
    if (!account?.id) return
    setSidePanel(null)
    setHashtagTag(null)
    setProfileAccountId(account.id)
    setView('home')
  }

  // Opens a hashtag's public feed. Hashtag links inside post text reach
  // here via document-level click delegation (see the effect below).
  function handleOpenHashtag(tag) {
    if (!tag) return
    setSidePanel(null)
    setProfileAccountId(null)
    setHashtagTag(tag)
    setView('home')
  }

  // Delegated handler for hashtag links rendered deep inside post content,
  // where passing callbacks down would mean threading yet another prop
  // through every row.
  useEffect(() => {
    function onClick(e) {
      const el = e.target.closest?.('.hashtag-link')
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      handleOpenHashtag(el.dataset.hashtag)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  function handleQuote(status) {
    setQuoteStatus(status)
    setComposing(true)
  }

  // Auto-refresh the thread panel every 5 seconds (silent, no loading flash)
  useEffect(() => {
    if (sidePanel?.mode !== 'thread' || !sidePanel.status) return
    const statusId = sidePanel.status.id
    const interval = setInterval(() => {
      mitra
        .fetchContext(session.instanceUrl, session.token, statusId)
        .then((context) => {
          const tree = buildReplyTree(context.descendants, statusId)
          setReplyStates((prev) => ({
            ...prev,
            [statusId]: { loading: false, error: '', items: tree, ancestors: context.ancestors },
          }))
        })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [sidePanel, session])

  // Auto-refresh notifications every 5 seconds (silent)
  useEffect(() => {
    if (view !== 'notifications' && tier !== 'wide') return
    if (!session) return
    const interval = setInterval(() => {
      mitra
        .fetchNotifications(session.instanceUrl, session.token)
        .then((items) => setNotifications(items))
        .catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [view, tier, session])

  // After a reply posts successfully, insert it into the correct position in
  // the already-loaded tree so it shows up immediately, then swap the panel
  // back to thread view and trigger an immediate refresh.
  function handleReplyPosted(parentId, reply) {
    const newReply = { status: reply, children: [] }
    setReplyStates((prev) => {
      // Find which root key contains parentId in its tree
      let rootKey = prev[parentId] ? parentId : null
      if (!rootKey) {
        for (const key of Object.keys(prev)) {
          if (findNode(prev[key].items, parentId)) { rootKey = key; break }
        }
      }
      if (!rootKey || !prev[rootKey]?.items) return prev
      const updated = insertIntoTree(prev[rootKey].items, parentId, newReply)
      return { ...prev, [rootKey]: { ...prev[rootKey], items: updated } }
    })
    setSidePanel((prev) => {
      if (prev?.mode === 'thread' && prev.status) {
        return { mode: 'thread', status: prev.status }
      }
      return null
    })
    setFocusedReplyId(reply.id)
    setTimeout(() => setFocusedReplyId(null), 2000)
    // Trigger an immediate context refresh so nested replies appear quickly.
    // Read the panel through the ref — the closure above captured a stale
    // `sidePanel` by the time this fires.
    setTimeout(() => {
      const panel = sidePanelRef.current
      const rootId = panel?.threadRoot?.id || panel?.status?.id
      if (rootId && session) {
        mitra.fetchContext(session.instanceUrl, session.token, rootId)
          .then((context) => {
            const tree = buildReplyTree(context.descendants, rootId)
            setReplyStates((prev2) => ({
              ...prev2,
              [rootId]: { loading: false, error: '', items: tree, ancestors: context.ancestors },
            }))
          })
          .catch(() => {})
      }
    }, 1500)
  }

  function closeSidePanel() {
    setSidePanel(null)
  }

  // Favouriting/boosting a reply needs to update that exact node wherever
  // it lives — inside the tree of whichever thread is currently open in
  // the panel, or (for a notification's own status) the notifications
  // list directly. Two different data shapes, so two small helpers rather
  // than one that tries to cover both.
  function updateReplyInPanel(updated) {
    if (!sidePanel?.status) return
    const rootId = sidePanel.status.id
    if (updated.id === rootId) {
      setSidePanel((prev) => (prev ? { ...prev, status: updated } : prev))
    }
    setReplyStates((prev) => {
      const current = prev[rootId]
      if (!current) return prev
      const items = current.items ? updateTreeNode(current.items, updated) : current.items
      const ancestors = current.ancestors
        ? current.ancestors.map((a) => (a.id === updated.id ? updated : a))
        : current.ancestors
      return { ...prev, [rootId]: { ...current, items, ancestors } }
    })
  }

  function updateNotificationStatus(updated) {
    setNotifications((prev) =>
      prev.map((n) => (n.status && n.status.id === updated.id ? { ...n, status: updated } : n))
    )
  }

  if (!session) {
    return (
      <LoginView onBeginLogin={beginLogin} error={authError} completingLogin={completingLogin} />
    )
  }

  const notificationsBody = (
    <>
      {notificationsError && <div className="banner banner-error">{notificationsError}</div>}
      {notificationsLoading && notifications.length === 0 ? (
        <div className="empty-state">Loading…</div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">Nothing here yet.</div>
      ) : (
        <div className="timeline-list">
          {notifications.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              instanceUrl={session.instanceUrl}
              token={session.token}
              onUpdateStatus={updateNotificationStatus}
              onOpenThread={handleOpenThread}
              onComposeReply={handleComposeReply}
              onOpenLightbox={setLightboxAttachment}
              onOpenProfile={handleOpenProfile}
              onRespondFollowRequest={respondFollowRequest}
              currentAccountId={session.account?.id}
              onDelete={handleDeleteStatus}
              onEdit={handleEditStatus}
              onMute={handleMuteAccount}
              onBlock={handleBlockAccount}
            />
          ))}
        </div>
      )}
    </>
  )

  const timelineContent = hashtagTag ? (
    <HashtagFeed
      hashtag={hashtagTag}
      instanceUrl={session.instanceUrl}
      token={session.token}
      onOpenThread={handleOpenThread}
      onComposeReply={handleComposeReply}
      onOpenLightbox={setLightboxAttachment}
      onOpenProfile={(account) => { setHashtagTag(null); handleOpenProfile(account) }}
      onUpdate={updatePost}
      onQuote={handleQuote}
      currentAccountId={session.account?.id}
      onDelete={handleDeleteStatus}
      onMute={handleMuteAccount}
      onBlock={handleBlockAccount}
      onEdit={handleEditStatus}
      onClose={() => setHashtagTag(null)}
    />
  ) : profileAccountId ? (
    <ProfileView
      accountId={profileAccountId}
      instanceUrl={session.instanceUrl}
      token={session.token}
      onOpenThread={handleOpenThread}
      onComposeReply={handleComposeReply}
      onOpenLightbox={setLightboxAttachment}
      onOpenProfile={handleOpenProfile}
      onUpdate={updatePost}
      onQuote={handleQuote}
      currentAccountId={session.account?.id}
      onDelete={handleDeleteStatus}
      onEdit={handleEditStatus}
      onMute={handleMuteAccount}
      onBlock={handleBlockAccount}
      onClose={() => setProfileAccountId(null)}
    />
  ) : (
    <div className="timeline-wrap">
      {view === 'home' && (
        <>
          {error && <div className="banner banner-error">{error}</div>}
          <div className="section-label">Home timeline</div>
          {loading && timeline.length === 0 ? (
            <div className="empty-state">Loading…</div>
          ) : timeline.length === 0 ? (
            <div className="empty-state">
              No posts yet. Follow someone to see their posts here.
            </div>
          ) : (
            <div className="timeline-list">
              {timeline.map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  instanceUrl={session.instanceUrl}
                  token={session.token}
                  onUpdate={updatePost}
                  onOpenThread={handleOpenThread}
                  onComposeReply={handleComposeReply}
                  onOpenLightbox={setLightboxAttachment}
                  onOpenProfile={handleOpenProfile}
                  onQuote={handleQuote}
                  currentAccountId={session.account?.id}
                  onDelete={handleDeleteStatus}
                  onEdit={handleEditStatus}
                  onMute={handleMuteAccount}
                  onBlock={handleBlockAccount}
                />
              ))}
            </div>
          )}
          {loadingMore && <div className="empty-state">Loading…</div>}
          {hasMore && !loadingMore && timeline.length > 0 && (
            <div className="scroll-sentinel" />
          )}
        </>
      )}

      {view === 'explore' && (
        <>
          {exploreError && <div className="banner banner-error">{exploreError}</div>}
          <div className="explore-header">
            <div className="section-label" style={{ paddingBottom: 0 }}>
              Explore
            </div>
            <div className="feed-toggle">
              <button
                className={`feed-toggle-btn${exploreFeed === 'federated' ? ' active' : ''}`}
                onClick={() => setExploreFeed('federated')}
                type="button"
              >
                <Globe size={13} />
                Federated
              </button>
              <button
                className={`feed-toggle-btn${exploreFeed === 'local' ? ' active' : ''}`}
                onClick={() => setExploreFeed('local')}
                type="button"
              >
                <Home size={13} />
                Local
              </button>
            </div>
          </div>
          {exploreLoading && !exploreTimelines[exploreFeed] ? (
            <div className="empty-state">Loading…</div>
          ) : !exploreTimelines[exploreFeed] || exploreTimelines[exploreFeed].length === 0 ? (
            <div className="empty-state">Nothing here yet.</div>
          ) : (
            <div className="timeline-list">
              {exploreTimelines[exploreFeed].map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  instanceUrl={session.instanceUrl}
                  token={session.token}
                  onUpdate={updateExplorePost}
                  onOpenThread={handleOpenThread}
                  onComposeReply={handleComposeReply}
                  onOpenLightbox={setLightboxAttachment}
                  onOpenProfile={handleOpenProfile}
                  onQuote={handleQuote}
                  currentAccountId={session.account?.id}
                  onDelete={handleDeleteStatus}
                  onEdit={handleEditStatus}
                  onMute={handleMuteAccount}
                  onBlock={handleBlockAccount}
                />
              ))}
            </div>
          )}
          {exploreLoadingMore && <div className="empty-state">Loading…</div>}
          {exploreHasMore[exploreFeed] && !exploreLoadingMore && exploreTimelines[exploreFeed]?.length > 0 && (
            <div ref={exploreSentinelRef} className="scroll-sentinel" />
          )}
        </>
      )}

      {view === 'search' && (
        <SearchView
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenThread={handleOpenThread}
          onComposeReply={handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onUpdatePost={updatePost}
          onQuote={handleQuote}
          currentAccountId={session.account?.id}
          onDelete={handleDeleteStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
          onEdit={handleEditStatus}
          onOpenHashtag={handleOpenHashtag}
        />
      )}

      {view === 'bookmarks' && (
        <>
          {bookmarksError && <div className="banner banner-error">{bookmarksError}</div>}
          <div className="section-label">Bookmarks</div>
          {bookmarksLoading && bookmarks.length === 0 ? (
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
                  onUpdate={updateBookmarkedPost}
                  onOpenThread={handleOpenThread}
                  onComposeReply={handleComposeReply}
                  onOpenLightbox={setLightboxAttachment}
                  onOpenProfile={handleOpenProfile}
                  onQuote={handleQuote}
                  currentAccountId={session.account?.id}
                  onDelete={handleDeleteStatus}
                  onEdit={handleEditStatus}
                  onMute={handleMuteAccount}
                  onBlock={handleBlockAccount}
                />
              ))}
            </div>
          )}
          {bookmarksLoadingMore && <div className="empty-state">Loading…</div>}
          {bookmarksHasMore && !bookmarksLoadingMore && bookmarks.length > 0 && (
            <div ref={bookmarksSentinelRef} className="scroll-sentinel" />
          )}
        </>
      )}

      {tier !== 'wide' && view === 'notifications' && (
        <>
          <div className="section-label">Notifications</div>
          {notificationsBody}
        </>
      )}
    </div>
  )

  const threadPanelProps = {
    panel: sidePanel,
    replyStates,
    onOpenThread: handleOpenThread,
    onComposeReply: handleComposeReply,
    onOpenLightbox: setLightboxAttachment,
    onOpenProfile: handleOpenProfile,
    onUpdateReply: updateReplyInPanel,
    onClose: closeSidePanel,
    instanceUrl: session.instanceUrl,
    token: session.token,
    onReplyPosted: handleReplyPosted,
    onCancelCompose: handleCancelCompose,
    onQuote: handleQuote,
    currentAccountId: session.account?.id,
    onDelete: handleDeleteStatus,
    onMute: handleMuteAccount,
    onBlock: handleBlockAccount,
    onEdit: handleEditStatus,
    maxCharacters: session.maxCharacters || 500,
    focusedReplyId,
  }

  return (
    <AppSettingsContext.Provider value={{ hoverPreviewsEnabled, fetchClientMedia, instanceUrl: session.instanceUrl, token: session.token }}>
    <PickerContext.Provider value={{ openPickerId, setOpenPickerId }}>
      <header className="headerbar">
        <div className="headerbar-brand">
          <Rss size={18} />
          <div>
            Mitra
            <div className="headerbar-subtitle">
              {session.instanceUrl.replace(/^https?:\/\//, '')}
            </div>
          </div>
        </div>

        <div className="view-switcher">
          <button
            className={`view-switcher-btn${view === 'home' ? ' active' : ''}`}
            onClick={() => setView('home')}
          >
            <Home size={14} />
            Home
          </button>
          {tier !== 'wide' && (
            <button
              className={`view-switcher-btn${view === 'notifications' ? ' active' : ''}`}
              onClick={() => setView('notifications')}
            >
              <Bell size={14} />
              Notifications
            </button>
          )}
          <button
            className={`view-switcher-btn${view === 'explore' ? ' active' : ''}`}
            onClick={() => setView('explore')}
          >
            <Compass size={14} />
            Explore
          </button>
          <button
            className={`view-switcher-btn${view === 'bookmarks' ? ' active' : ''}`}
            onClick={() => setView('bookmarks')}
          >
            <Bookmark size={14} />
            Bookmarks
          </button>
          <button
            className={`view-switcher-btn${view === 'search' ? ' active' : ''}`}
            onClick={() => setView('search')}
          >
            <Search size={14} />
            Search
          </button>
        </div>

        <div className="headerbar-actions">
          <button className="icon-btn" aria-label="Refresh" onClick={handleRefresh}>
            <RotateCw size={16} />
          </button>
          <div className="settings-menu-wrap">
            <button
              className="icon-btn"
              aria-label="Settings"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings size={16} />
            </button>
            {settingsOpen && (
              <>
                <div className="settings-menu-backdrop" onClick={() => setSettingsOpen(false)} />
                <div className="settings-menu">
                  <label className="settings-menu-row">
                    <span>Media hover previews</span>
                    <input
                      type="checkbox"
                      checked={hoverPreviewsEnabled}
                      onChange={toggleHoverPreviews}
                    />
                  </label>
                  <label className="settings-menu-row">
                    <span>Fetch media directly</span>
                    <input
                      type="checkbox"
                      checked={fetchClientMedia}
                      onChange={toggleFetchClientMedia}
                    />
                  </label>
                  <div className="settings-menu-row">
                    <span>Theme</span>
                    <div className="theme-toggle">
                      <button
                        className={`theme-toggle-btn${themeMode === 'system' ? ' active' : ''}`}
                        onClick={() => setThemeMode('system')}
                      >
                        System
                      </button>
                      <button
                        className={`theme-toggle-btn${themeMode === 'light' ? ' active' : ''}`}
                        onClick={() => setThemeMode('light')}
                      >
                        Light
                      </button>
                      <button
                        className={`theme-toggle-btn${themeMode === 'dark' ? ' active' : ''}`}
                        onClick={() => setThemeMode('dark')}
                      >
                        Dark
                      </button>
                    </div>
                  </div>
                  <div className="settings-menu-row">
                    <span>Sent from</span>
                    <input
                      type="text"
                      className="settings-text-input"
                      value={clientName}
                      onChange={(e) => handleClientNameChange(e.target.value)}
                      maxLength={32}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <button className="suggested-btn" onClick={() => setComposing(true)}>
            <Plus size={15} />
            New post
          </button>
          <button className="icon-btn" aria-label="Log out" onClick={logout}>
            <LogOut size={16} />
          </button>
          <Avatar
            name={session.account.display_name || session.account.username}
            src={session.account.avatar}
          />
        </div>
      </header>

      {tier === 'wide' ? (
        <div className="app-shell">
          <aside className="notif-column scrollbar-thin">
            <div className="section-label">Notifications</div>
            {notificationsBody}
          </aside>
          <div className="content-scroll scrollbar-thin">{timelineContent}</div>
          <aside className="thread-column scrollbar-thin">
            {sidePanel ? (
              <ThreadPanelContent {...threadPanelProps} />
            ) : (
              <div className="thread-column-empty">Select a post to view its replies.</div>
            )}
          </aside>
        </div>
      ) : tier === 'medium' ? (
        <div className={`main-layout${sidePanel ? ' panel-open' : ''}`}>
          <div className="content-scroll scrollbar-thin">{timelineContent}</div>
          <ThreadPanel {...threadPanelProps} />
        </div>
      ) : (
        <div className="main-layout">
          <div className="content-scroll scrollbar-thin">
            {sidePanel ? (
              <div className="timeline-wrap">
                <ThreadPanelContent {...threadPanelProps} backLabel="Back to timeline" />
              </div>
            ) : (
              timelineContent
            )}
          </div>
        </div>
      )}

      <MediaLightbox
        lightboxState={lightboxAttachment ? { ...lightboxAttachment, onNavigate: setLightboxAttachment } : null}
        onClose={() => setLightboxAttachment(null)}
      />

      {composing && (
        <ComposeDialog
          instanceUrl={session.instanceUrl}
          token={session.token}
          onClose={() => { setComposing(false); setQuoteStatus(null) }}
          onPosted={prependPost}
          quoteStatus={quoteStatus}
          maxCharacters={session.maxCharacters || 500}
        />
      )}

      {editing && (
        <EditDialog
          status={editing}
          instanceUrl={session.instanceUrl}
          token={session.token}
          onClose={() => setEditing(null)}
          onSaved={handleEditSaved}
        />
      )}
    </PickerContext.Provider>
    </AppSettingsContext.Provider>
  )
}
