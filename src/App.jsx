import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Home,
  Bell,
  Compass,
  Bookmark,
  Search,
  Users,
  List,
  MessageCircle,
  Plus,
  RotateCw,
  ArrowUpToLine,
  LogOut,
  Globe,
  Settings,
  Trash2,
} from 'lucide-react'
import { useMitraSession } from './useMitraSession'
import { useAppSettings } from './useAppSettings'
import * as mitra from './lib/mitra'
import { blipFavicon } from './lib/favicon-blip.js'
import { buildReplyTree, findNode, insertIntoTree, updateTreeNode, mergeStatusIntoRow, htmlToPlainText as noteToPlainText } from './lib/render.jsx'
import { AppSettingsContext, PickerContext, GhostContext, useLayoutTier, usePullToRefresh, useSwipeBack } from './hooks'

// Server-side notification filters (exclude_types[]). A group counts as
import LoginView from './LoginView'
import { Avatar, MediaLightbox } from './components/Media.jsx'
import { NotificationRow, PostRow } from './components/Post.jsx'
import { ComposeDialog, EditDialog } from './components/Compose.jsx'
import { ThreadPanel, ThreadPanelContent, ThreadPanelHeader } from './components/ThreadPanel.jsx'
import { ProfileView } from './components/ProfileView.jsx'
import { SearchView } from './components/SearchView.jsx'
import { HashtagFeed } from './components/HashtagFeed.jsx'
import { MutedAccountsView } from './components/MutedAccountsView.jsx'
import InstanceIcon from './components/InstanceIcon.jsx'
import { ScrollTopButton } from './components/ScrollTopButton.jsx'
import { SettingsMenu } from './components/SettingsMenu.jsx'
import { ServerInfoPopover } from './components/ServerInfoPopover.jsx'
import { ToastStack } from './components/ToastStack.jsx'
import { storageGet, storageSet } from './lib/storage.js'
import { ListsView } from './components/ListsView.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { GroupsView } from './components/GroupsView.jsx'
import { ConversationsView } from './components/ConversationsView.jsx'
import { AccountSettingsView } from './components/AccountSettingsView.jsx'
import { FavouritesView } from './components/FavouritesView.jsx'
import { StatusPage } from './components/StatusPage.jsx'
import { UIContext } from './ui/index.jsx'

// Server-side notification filters (exclude_types[]). A group counts as
// "off" when any of its types is excluded; groups never overlap.
const NOTIF_FILTERS = [
  ['Mentions', ['mention']],
  ['Boosts', ['reblog']],
  ['Quotes', ['quote']],
  ['Favourites', ['favourite']],
  ['Reactions', ['pleroma:emoji_reaction']],
  ['Follows', ['follow', 'follow_request']],
  ['Polls', ['poll']],
  ['Edits', ['update']],
]

// Hard cap on in-memory timeline rows. The server paginates the home feed
// forever, and an unbounded array would quietly grow this session's heap
// the whole time the tab is open. ~400 rows is well past any realistic
// scrolling session (infinite scroll fetches older pages on demand), so
// the array is trimmed to the newest TIMELINE_MAX_ROWS whenever it grows.
const TIMELINE_MAX_ROWS = 400

export default function App() {
  const { session, beginLogin, signup, logout, authError, completingLogin } = useMitraSession()
  const tier = useLayoutTier()
  const [scrollEl, setScrollEl] = useState(null)
  const refreshRef = useRef(() => {})
  const [view, setView] = useState('home')
  const [timeline, setTimeline] = useState([])
  // Pagination cursor for the home feed, tracked separately from the array:
  // with TIMELINE_MAX_ROWS trimming scroll-spam rows, the array's tail is
  // "the oldest row still in memory", not the true fetch boundary — reading
  // the cursor from the array would re-request the same page forever.
  const lastStatusIdRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [composing, setComposing] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState(null)
  // Group the open composer is addressing, when "Post to this group" was
  // used — cleared with the dialog.
  const [composerGroup, setComposerGroup] = useState(null)
  // Post being replied to in the main composer (context preview + target)
  const [replyContext, setReplyContext] = useState(null)
  const [editing, setEditing] = useState(null)
  const [openPickerId, setOpenPickerId] = useState(null)
  const [replyStates, setReplyStates] = useState({})
  const replyStatesRef = useRef(replyStates)
  replyStatesRef.current = replyStates
  const [sidePanel, setSidePanel] = useState(null)
  const sidePanelRef = useRef(sidePanel)
  sidePanelRef.current = sidePanel
  // The timeline row the user clicked outside the panel — drives the
  // ghost placeholder ("Viewing in thread").  Anchors independently of
  // sidePanel.status, which may be the thread root for mid-thread
  // replies or refreshed by the poll interval.
  const [ghostStatusId, setGhostStatusId] = useState(null)
  // Guards async thread-open fetches: remembers which status started the
  // in-flight load so a stale resolve can't clobber a newer open (or an
  // explicit close).
  const lastThreadOpenRef = useRef(null)
  const [profileAccountId, setProfileAccountId] = useState(null)
  const [hashtagTag, setHashtagTag] = useState(null)
  const [focusedReplyId, setFocusedReplyId] = useState(null)
  const [lightboxAttachment, setLightboxAttachment] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState('')
  // Server-side notification filtering (exclude_types[]) — persisted so
  // the mute choices survive reloads.
  const [notifExcluded, setNotifExcluded] = useState(() => {
    try {
      const raw = JSON.parse(storageGet('notif-excluded'))
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  })
  const [notificationsHasMore, setNotificationsHasMore] = useState(true)
  const [notificationsLoadingMore, setNotificationsLoadingMore] = useState(false)
  const notifSentinelRef = useRef(null)
  // Server-synced read position for notifications (markers API). Compared
  // against notification created_at timestamps — reliable regardless of
  // how the server assigns ids.
  const [notifMarkerAt, setNotifMarkerAt] = useState(null)
  const [notifUnread, setNotifUnread] = useState(0)
  const notifMarkerSyncingRef = useRef(false)
  const [exploreFeed, setExploreFeed] = useState('federated') // 'federated' | 'local' | 'people'
  const [exploreTimelines, setExploreTimelines] = useState({ federated: null, local: null })
  const [directoryAccounts, setDirectoryAccounts] = useState([])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryHasMore, setDirectoryHasMore] = useState(true)
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
  const [messagesRefreshTick, setMessagesRefreshTick] = useState(0)
  const [favouritesRefreshTick, setFavouritesRefreshTick] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [serverInfoOpen, setServerInfoOpen] = useState(false)
  // Where the settings panel was opened from (null = centered)
  const [settingsAnchor, setSettingsAnchor] = useState(null)

  // Build id→status maps so PostRow can look up parent statuses for
  // "in reply to" links.  Each feed gets its own map so updates stay
  // scoped — a boost in the timeline shouldn't leak into bookmarks.
  const timelineStatusById = useMemo(() => {
    const m = new Map()
    for (const p of timeline) {
      m.set(p.id, p)
      if (p.reblog) m.set(p.reblog.id, p.reblog)
    }
    return m
  }, [timeline])
  const exploreStatusById = useMemo(() => {
    const m = new Map()
    for (const feed of Object.values(exploreTimelines)) {
      if (!feed) continue
      for (const p of feed) { m.set(p.id, p); if (p.reblog) m.set(p.reblog.id, p.reblog) }
    }
    return m
  }, [exploreTimelines])
  const bookmarksStatusById = useMemo(() => {
    const m = new Map()
    for (const p of bookmarks) { m.set(p.id, p); if (p.reblog) m.set(p.reblog.id, p.reblog) }
    return m
  }, [bookmarks])
  const notifStatusById = useMemo(() => {
    const m = new Map()
    for (const n of notifications) {
      if (n.status) { m.set(n.status.id, n.status); if (n.status.reblog) m.set(n.status.reblog.id, n.status.reblog) }
    }
    return m
  }, [notifications])

  function openSettingsFrom(e) {
    const rect = e?.currentTarget?.getBoundingClientRect()
    setSettingsAnchor(rect ? { top: rect.top, bottom: rect.bottom, left: rect.left } : null)
    setSettingsOpen(true)
  }

  // Account ids with pending incoming follow requests (null = unknown yet)
  const [pendingFollowIds, setPendingFollowIds] = useState(null)
  const [clearingNotifications, setClearingNotifications] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // Home timeline's own infinite-scroll sentinel — see the observer
  // effect below for why it can't be looked up by class name.
  const homeSentinelRef = useRef(null)
  const narrowThreadRef = useRef(null)

  // All user settings (appearance/content/GIF/translation/account) live in
  // this hook, bundled with the client_config server sync. notif-excluded
  // is owned by the notifications code below but rides the same sync.
  const appSettings = useAppSettings(session, {
    onClientNameChange: logout,
    extraSynced: { 'notif-excluded': [notifExcluded, setNotifExcluded] },
  })

  async function handleClearNotifications() {
    if (!session || clearingNotifications) return
    if (!window.confirm('Clear all notifications? This cannot be undone.')) return
    setClearingNotifications(true)
    try {
      await mitra.clearNotifications(session.instanceUrl, session.token)
      setNotifications([])
      setNotifUnread(0)
    } catch (err) {
      console.error(err)
    } finally {
      setClearingNotifications(false)
    }
  }

  // Browser tab follows the instance: favicon and a "rvmf on <host>"
  // title; both restored to plain "rvmf" when logged out.
  // When notifUnread > 0, a small red dot is overlaid on the favicon.
  const defaultFaviconRef = useRef(null)
  useEffect(() => {
    let link = document.querySelector("link[rel~='icon']")
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    if (!defaultFaviconRef.current) defaultFaviconRef.current = link.href
    const baseUrl = session
      ? `${session.instanceUrl}/favicon.ico`
      : defaultFaviconRef.current
    link.href = baseUrl
    let cancelled = false
    if (notifUnread > 0 && session) {
      blipFavicon(baseUrl, { unread: notifUnread })
        .then((dataUrl) => { if (!cancelled) link.href = dataUrl })
        .catch(() => {})
    }
    document.title = session
      ? `rvmf on ${session.instanceUrl.replace(/^https?:\/\//, '')}`
      : 'rvmf'
    return () => { cancelled = true }
  }, [session, notifUnread])

  const loadTimeline = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError('')
    setHasMore(true)
    try {
      const statuses = await mitra.fetchHomeTimeline(session.instanceUrl, session.token)
      setTimeline(statuses.slice(0, TIMELINE_MAX_ROWS))
      lastStatusIdRef.current = statuses[statuses.length - 1]?.id || null
      // Sync the home read marker to the newest post so other clients
      // (and future sessions) can resume from here.
      if (statuses[0]?.id) {
        mitra.updateMarker(session.instanceUrl, session.token, {
          home: { last_read_id: String(statuses[0].id) },
        }).catch(() => {})
      }
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
      const lastId = lastStatusIdRef.current
      if (!lastId) return
      const statuses = await mitra.fetchHomeTimeline(session.instanceUrl, session.token, { max_id: lastId })
      setTimeline((prev) => [...prev, ...statuses].slice(0, TIMELINE_MAX_ROWS))
      if (statuses.length > 0) lastStatusIdRef.current = statuses[statuses.length - 1].id || null
      if (statuses.length < 10) setHasMore(false)
    } catch {
      // silently fail — user can scroll again to retry
    } finally {
      setLoadingMore(false)
    }
  }, [session, loadingMore, hasMore])

  useEffect(() => {
    loadTimeline()
  }, [loadTimeline])

  useEffect(() => {
    if (view !== 'home') return
    // Own ref, not document.querySelector: on the wide tier the
    // notifications column renders before this view and carries a
    // sentinel of its own — a class-based lookup would grab that one
    // and home's infinite scroll would watch the wrong element.
    const sentinel = homeSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreTimeline()
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [view, tier, loadMoreTimeline, timeline.length])

  function toggleNotifFilter(types) {
    setNotifExcluded((prev) => {
      const isOn = !types.some((t) => prev.includes(t))
      const next = isOn
        ? [...prev, ...types.filter((t) => !prev.includes(t))]
        : prev.filter((t) => !types.includes(t))
      storageSet('notif-excluded', JSON.stringify(next))
      return next
    })
  }

  const loadNotifications = useCallback(async () => {
    if (!session) return
    setNotificationsLoading(true)
    setNotificationsError('')
    setNotificationsHasMore(true)
    try {
      const [items, pending] = await Promise.all([
        mitra.fetchNotifications(session.instanceUrl, session.token),
        // Which requests are still awaiting action — old follow_request
        // notifications for handled accounts must not offer buttons.
        // Fetched in full (paginated) so no pending request gets treated
        // as already-handled just because it fell off the first page.
        mitra.fetchAllPendingFollowAccountIds(session.instanceUrl, session.token)
          .catch(() => null),
      ])
      setNotifications(items)
      if (pending) setPendingFollowIds(pending)
    } catch (err) {
      setNotificationsError(err.message || 'Failed to load notifications.')
    } finally {
      setNotificationsLoading(false)
    }
  }, [session])

  const loadMoreNotifications = useCallback(async () => {
    if (!session || notificationsLoadingMore || !notificationsHasMore) return
    if (notifications.length === 0) return
    setNotificationsLoadingMore(true)
    try {
      const lastId = notifications[notifications.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchNotifications(session.instanceUrl, session.token, { max_id: lastId })
      setNotifications((prev) => [...prev, ...more])
      if (more.length < 30) setNotificationsHasMore(false)
    } catch {
      // silently fail — user can scroll again to retry
    } finally {
      setNotificationsLoadingMore(false)
    }
  }, [session, notificationsLoadingMore, notificationsHasMore, notifications])

  // Notifications infinite scroll observer (active in the tab view and
  // in the wide tier's permanent column — same sentinel either way).
  useEffect(() => {
    const sentinel = notifSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreNotifications()
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMoreNotifications, notifications.length])

  // Flaky-connection awareness: while the browser reports itself offline,
  // all polling pauses and an amber banner explains why; coming back
  // online refreshes the current view and notifications immediately.
  const [online, setOnline] = useState(() => navigator.onLine)

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey)) return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return
      if (e.key.toLowerCase() === 'n' && session) {
        e.preventDefault()
        setComposing(true)
      } else if (e.key === ',') {
        e.preventDefault()
        setSettingsAnchor(null) // no trigger element — centered
        setSettingsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])
  useEffect(() => {
    function goOffline() { setOnline(false) }
    function goOnline() {
      setOnline(true)
      if (!session) return
      refreshRef.current()
      if (view === 'notifications' || tier === 'wide') loadNotifications()
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [session, view, tier, loadNotifications])

  // Restore the notifications read marker once per session so the unread
  // count on the tab is accurate.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    mitra.fetchMarkers(session.instanceUrl, session.token, ['notifications'])
      .then((markers) => {
        if (cancelled || !markers?.notifications?.updated_at) return
        setNotifMarkerAt(new Date(markers.notifications.updated_at))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [session])

  // Recompute the unread badge whenever the list or the marker changes.
  useEffect(() => {
    if (!notifMarkerAt) {
      setNotifUnread(0)
      return
    }
    const count = notifications.filter((n) => new Date(n.created_at) > notifMarkerAt).length
    setNotifUnread(count)
  }, [notifications, notifMarkerAt])

  // While the user can see notifications, keep the marker pinned to the
  // newest item — that's what "read" means here. Throttled so the 5s
  // poll doesn't hammer the endpoint.
  const notificationsVisible = view === 'notifications' || tier === 'wide'
  useEffect(() => {
    if (!session || !notificationsVisible || notifications.length === 0) return
    if (notifMarkerSyncingRef.current) return
    const newest = notifications[0]
    if (!newest) return
    notifMarkerSyncingRef.current = true
    mitra.updateMarker(session.instanceUrl, session.token, {
      notifications: { last_read_id: String(newest.id) },
    })
      .then((markers) => {
        if (markers?.notifications?.updated_at) {
          setNotifMarkerAt(new Date(markers.notifications.updated_at))
        }
      })
      .catch(() => {})
      .finally(() => {
        setTimeout(() => { notifMarkerSyncingRef.current = false }, 5000)
      })
  }, [notificationsVisible, notifications, session])

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

  const loadMoreDirectory = useCallback(async () => {
    if (!session || directoryLoading || !directoryHasMore) return
    setDirectoryLoading(true)
    try {
      const more = await mitra.fetchDirectory(
        session.instanceUrl,
        session.token,
        { offset: directoryAccounts.length }
      )
      setDirectoryAccounts((prev) => [...prev, ...more])
      if (more.length < 20) setDirectoryHasMore(false)
    } catch {
      // silent
    } finally {
      setDirectoryLoading(false)
    }
  }, [session, directoryLoading, directoryHasMore, directoryAccounts.length])

  useEffect(() => {
    if (view === 'explore' && exploreFeed === 'people' && directoryAccounts.length === 0 && !directoryLoading) {
      loadMoreDirectory()
    }
  }, [view, exploreFeed, directoryAccounts.length, directoryLoading, loadMoreDirectory])

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
        if (entries[0].isIntersecting) {
          if (exploreFeed === 'people') loadMoreDirectory()
          else loadMoreExplore()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [view, exploreFeed, loadMoreExplore, loadMoreDirectory, exploreTimelines[exploreFeed]?.length])

  function updateExplorePost(updated) {
    setExploreTimelines((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        if (next[key]) next[key] = next[key].map((p) => mergeStatusIntoRow(p, updated))
      }
      return next
    })
  }

  async function respondFollowRequest(accountId, action) {
    try {
      await mitra.respondFollowRequest(session.instanceUrl, session.token, accountId, action)
      // A handled request must stop offering Accept/Reject immediately — the
      // next 5s notification poll would also refresh this, but the action
      // should take effect now rather than waiting for the next tick.
      mitra
        .fetchAllPendingFollowAccountIds(session.instanceUrl, session.token)
        .then((pending) => setPendingFollowIds(pending))
        .catch(() => {})
    } catch {
      // Silently ignore — follow request actions are best-effort
    }
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
    // Refreshing means "show me the newest" — jump to the top instantly
    // (not smooth: prepended items would fight an animated scroll).
    scrollEl?.scrollTo({ top: 0 })
    if (view === 'notifications') {
      loadNotifications()
    } else if (view === 'explore') {
      setExploreHasMore((prev) => ({ ...prev, [exploreFeed]: true }))
      loadExplore(exploreFeed)
    } else if (view === 'bookmarks') {
      loadBookmarks()
    } else if (view === 'messages') {
      // ConversationsView owns its data; bumping the key remounts it.
      setMessagesRefreshTick((t) => t + 1)
    } else if (view === 'favourites') {
      // Same pattern as messages: FavouritesView owns its data.
      setFavouritesRefreshTick((t) => t + 1)
    } else {
      loadTimeline()
    }
  }
  refreshRef.current = handleRefresh

  // Scroll-down-to-refresh on whichever timeline is showing
  const { pull, refreshing } = usePullToRefresh(scrollEl, () => refreshRef.current())
  const showPullIndicator = refreshing || pull > 10

  // Escape closes the topmost popup. Per-row dropdowns and the lightbox
  // register their own handlers (and consume the event); this chain
  // covers the app-level surfaces, innermost first. defaultPrevented
  // events are left alone so text-area affordances (emoji autocomplete)
  // can consume Escape without tearing down the whole dialog.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (composing) {
        e.preventDefault()
        setComposing(false)
        setQuoteStatus(null)
        setReplyContext(null)
      } else if (editing) {
        e.preventDefault()
        setEditing(null)
      } else if (openPickerId) {
        e.preventDefault()
        setOpenPickerId(null)
      } else if (settingsOpen && !appSettings.confirmingTranslation) {
        // While the translation confirm dialog is up, Escape is owned by the
        // dialog (it cancels it and keeps the settings menu open).
        e.preventDefault()
        setSettingsOpen(false)
      } else if (sidePanel) {
        e.preventDefault()
        closeSidePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [composing, editing, openPickerId, settingsOpen, appSettings.confirmingTranslation, sidePanel])

  function updatePost(updated) {
    setTimeline((prev) => prev.map((p) => mergeStatusIntoRow(p, updated)))
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
      setBookmarks((prev) => prev.filter((p) => p.id !== updated.id && p.reblog?.id !== updated.id))
      return
    }
    setBookmarks((prev) => prev.map((p) => mergeStatusIntoRow(p, updated)))
  }

  function prependPost(post) {
    setTimeline((prev) => [post, ...prev].slice(0, TIMELINE_MAX_ROWS))
  }

  // Fetches the ENTIRE descendant tree for `status` (not just its direct
  // children — /context returns every depth in one call) plus its
  // ancestors, and always refetches on open rather than relying on a
  // stale cache, so what's shown is actually current. Every thread opens
  // through this, unconditionally — the OP, a notification's status, a
  // reply, a reply to a reply, all the same path, all the same panel.
  // Force-refetch the reply tree for a thread root. Shared by the
  // auto-refresh interval, the post-reply refresh, and the "load missing
  // replies from origin" backfill button.
  const refreshContext = useCallback((rootId) => {
    if (!session || !rootId) return
    mitra.fetchContext(session.instanceUrl, session.token, rootId)
      .then((context) => {
        const tree = buildReplyTree(context.descendants, rootId)
        setReplyStates((prev) => ({
          ...prev,
          [rootId]: { loading: false, error: '', items: tree, ancestors: context.ancestors },
        }))
      })
      .catch(() => {})
  }, [session])

  // Resolves the thread root for `status`.  If the post is a mid-thread
  // reply (has ancestors), we re-fetch from the root so the full thread
  // — including sibling branches — is shown.  Returns { root, clickedId }
  // so the caller can point the panel at the root and highlight the
  // originally-clicked post.
  const ensureRepliesLoaded = useCallback(
    (status) => {
      setReplyStates((prev) => {
        if (prev[status.id]?.items) return prev
        return { ...prev, [status.id]: { ...(prev[status.id] || {}), loading: true, error: '' } }
      })

      if (replyStatesRef.current[status.id]?.items) {
        return Promise.resolve({ root: status, clickedId: status.id })
      }

      return mitra
        .fetchContext(session.instanceUrl, session.token, status.id)
        .then((context) => {
          // Mid-thread post: ancestors[0] is the thread root.  Re-fetch
          // from the root so the full conversation tree is loaded.
          if (context.ancestors.length > 0) {
            const root = context.ancestors[0]
            // Already loaded — just return the root.
            if (replyStatesRef.current[root.id]?.items) {
              return { root, clickedId: status.id }
            }
            setReplyStates((prev) => ({
              ...prev,
              [root.id]: { ...(prev[root.id] || {}), loading: true, error: '' },
            }))
            return mitra
              .fetchContext(session.instanceUrl, session.token, root.id)
              .then((rootContext) => {
                const tree = buildReplyTree(rootContext.descendants, root.id)
                setReplyStates((prev) => ({
                  ...prev,
                  [root.id]: { loading: false, error: '', items: tree, ancestors: rootContext.ancestors },
                }))
                return { root, clickedId: status.id }
              })
          }

          // Top-level post or root of its thread — use as-is.
          const tree = buildReplyTree(context.descendants, status.id)
          setReplyStates((prev) => ({
            ...prev,
            [status.id]: { loading: false, error: '', items: tree, ancestors: context.ancestors },
          }))
          return { root: status, clickedId: status.id }
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
          return { root: status, clickedId: status.id }
        })
    },
    [session]
  )

  // Opens the side panel for `status` — ancestors and the full reply tree —
  // or closes it if that same status is already showing.  This is the only
  // way threads open anywhere in the app now: always the slide-out panel,
  // never inline in the timeline.
  //
  // { fromPanel } — set when the click originates from inside the thread
  // panel (e.g. a reply's own onOpenThread).  Panel-internal navigation
  // never changes the ghost anchor — the marker stays on the row the user
  // clicked *outside* the panel.
  function handleOpenThread(status, { fromPanel = false } = {}) {
    // If already showing this exact post, re-anchor the ghost and bail.
    if (sidePanelRef.current?.mode === 'thread' && sidePanelRef.current.status.id === status.id) {
      if (!fromPanel) setGhostStatusId(status.id)
      return
    }

    // Ghost the clicked row immediately so the banner appears without
    // waiting for the async thread resolve.  For mid-thread replies the
    // panel may briefly still show the previous thread — the ghost is
    // anchored to the row the user actually clicked.
    if (!fromPanel) setGhostStatusId(status.id)

    // Mid-thread reply: resolve the thread root first so the panel opens
    // directly in the full-thread view — no visible focal switch, no
    // re-mount of the panel content.
    if (status.in_reply_to_id) {
      lastThreadOpenRef.current = status.id
      ensureRepliesLoaded(status).then(({ root, clickedId }) => {
        // Stale resolve: a newer click or an explicit close superseded this.
        if (lastThreadOpenRef.current !== status.id) return
        setSidePanel({ mode: 'thread', status: root })
        // Focus stays on the clicked post for the life of the thread —
        // no timer, so a slow resolve can't wipe a newer focus either.
        setFocusedReplyId(clickedId !== root.id ? clickedId : null)
      })
      return
    }

    // Top-level post: the clicked post IS the thread's anchor, so open
    // immediately — and clear any focus left over from a prior thread.
    setSidePanel({ mode: 'thread', status })
    setFocusedReplyId(null)
    ensureRepliesLoaded(status)
  }

  // Reply button inside the thread panel: compose inline beneath the
  // focal post. Only panel-resident statuses can resolve here — the
  // inline composer looks its preview up in the thread's own tree.
  function handleComposeReplyInPanel(status) {
    setSidePanel((prev) => {
      if (prev?.mode === 'thread') {
        return { ...prev, composingStatusId: status.id }
      }
      return { mode: 'compose', status, threadRoot: null }
    })
  }

  // Reply button on timeline/notification/profile rows. When a thread is
  // occupying the side panel, the inline composer would silently fail
  // (the target status isn't in that thread's tree) — so bring up the
  // main composer instead, with the target post shown as context.
  function handleComposeReply(status) {
    if (sidePanelRef.current?.mode === 'thread') {
      setQuoteStatus(null)
      setReplyContext(status)
      setComposing(true)
      return
    }
    handleComposeReplyInPanel(status)
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

  // Delegated handler for links rendered deep inside post content
  // (hashtags, @mentions), where passing callbacks down would mean
  // threading yet another prop through every row. Mentions resolve to a
  // local profile: by account id when the mention carries one, otherwise
  // by acct lookup — falling back to the external URL only if that fails.
  useEffect(() => {
    function onClick(e) {
      const mentionEl = e.target.closest?.('.mention-link')
      if (mentionEl) {
        e.preventDefault()
        e.stopPropagation()
        const accountId = mentionEl.dataset.accountId
        const acct = mentionEl.dataset.acct || (mentionEl.textContent || '').replace(/^@/, '')
        const openExternal = () => {
          const href = mentionEl.getAttribute('href')
          if (href) window.open(href, '_blank', 'noopener')
        }
        if (accountId) {
          handleOpenProfile({ id: accountId })
        } else if (acct) {
          mitra.lookupAccount(session.instanceUrl, session.token, acct)
            .then((account) => {
              if (account?.id) handleOpenProfile(account)
              else openExternal()
            })
            .catch(() => openExternal())
        } else {
          openExternal()
        }
        return
      }
      const el = e.target.closest?.('.hashtag-link')
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      handleOpenHashtag(el.dataset.hashtag)
    }
    // Capture phase is essential: these buttons' own React handlers call
    // e.stopPropagation(), and since React dispatches from the root
    // container, a bubble-phase document listener never fires — React
    // halts native propagation before it gets there.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [session])

  function handleQuote(status) {
    setQuoteStatus(status)
    setComposing(true)
  }

  function handlePostToGroup(group) {
    setComposerGroup(group)
    setComposing(true)
  }

  // Auto-refresh the thread panel every 5 seconds (silent, no loading flash)
  useEffect(() => {
    if (sidePanel?.mode !== 'thread' || !sidePanel.status) return
    const statusId = sidePanel.status.id
    const interval = setInterval(() => {
      if (!navigator.onLine) return // paused while offline; reconnect refreshes
      refreshContext(statusId)
      // Keep the focal post itself fresh too — counts and flags on the
      // tree come from /context, but the root's own state doesn't.
      mitra
        .fetchStatus(session.instanceUrl, session.token, statusId)
        .then((fresh) => {
          setSidePanel((prev) =>
            prev?.mode === 'thread' && prev.status?.id === fresh.id
              ? { ...prev, status: fresh }
              : prev
          )
        })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [sidePanel?.mode, sidePanel?.status?.id, session, refreshContext])

  // The ghost marker is only meaningful while the side panel is open in
  // thread mode.  Other paths that null the panel (profile/hashtag opens,
  // deletion, close button) must not leave a row frozen as "Viewing in
  // thread".
  useEffect(() => {
    if (!sidePanel) {
      setGhostStatusId(null)
      setFocusedReplyId(null)
    }
  }, [sidePanel])

  // Auto-refresh notifications every 5 seconds (silent). Also refreshes
  // pendingFollowIds so that newly-arriving follow_request notifications
  // immediately show Accept/Reject instead of flashing "already handled".
  useEffect(() => {
    if (view !== 'notifications' && tier !== 'wide') return
    if (!session) return
    const interval = setInterval(() => {
      if (!navigator.onLine) return // paused while offline; reconnect refreshes
      Promise.all([
        mitra.fetchNotifications(session.instanceUrl, session.token),
        mitra.fetchAllPendingFollowAccountIds(session.instanceUrl, session.token)
          .catch(() => null),
      ])
        .then(([items, pending]) => {
          setNotifications(items)
          if (pending) setPendingFollowIds(pending)
        })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [view, tier, session])

  // Keep home-timeline rows live: poll the visible posts' state on the
  // same 5s cadence as the thread panel, so counts/flags update everywhere
  // at once instead of only inside an open thread. Batch endpoint keeps
  // this to one request; boost wrappers are rebuilt around fresh inner
  // statuses since /statuses returns originals, never wrappers.
  const timelineRef = useRef([])
  timelineRef.current = timeline
  useEffect(() => {
    if (!session || view !== 'home') return
    const interval = setInterval(() => {
      if (!navigator.onLine) return // paused while offline; reconnect refreshes
      const posts = timelineRef.current.slice(0, 30)
      if (posts.length === 0) return
      mitra
        .fetchStatuses(session.instanceUrl, session.token, posts.map((p) => p.id))
        .then((fresh) => {
          if (!Array.isArray(fresh) || fresh.length === 0) return
          const byId = new Map(fresh.map((s) => [s.id, s]))
          setTimeline((prev) =>
            prev.map((post) => {
              if (post.reblog) {
                const inner = byId.get(post.reblog.id)
                return inner ? { ...post, reblog: inner } : post
              }
              return byId.get(post.id) || post
            })
          )
        })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [session, view])

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
    // Trigger an immediate context refresh so nested replies appear quickly.
    // Read the panel through the ref — the closure above captured a stale
    // `sidePanel` by the time this fires.
    setTimeout(() => {
      const panel = sidePanelRef.current
      const rootId = panel?.threadRoot?.id || panel?.status?.id
      if (rootId) refreshContext(rootId)
    }, 1500)
  }

  const closeSidePanel = useCallback(function closeSidePanel() {
    setSidePanel(null)
    setGhostStatusId(null)
    setFocusedReplyId(null)
    lastThreadOpenRef.current = null
    // Drop the loaded reply trees: an unbound map of every thread ever
    // opened would grow this session's heap forever. Threads always
    // force-refetch on open, so nothing is lost by clearing.
    setReplyStates({})
  }, [])

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
      prev.map((n) => {
        if (!n.status) return n
        const merged = mergeStatusIntoRow(n.status, updated)
        return merged === n.status ? n : { ...n, status: merged }
      })
    )
  }

  if (!session) {
    return (
      <LoginView
        onBeginLogin={beginLogin}
        onCreateAccount={signup}
        error={authError}
        completingLogin={completingLogin}
      />
    )
  }

  // Mitra has no exclude_types[] query param, so chip filtering happens
  // here at render time. The unread badge and marker sync above still
  // use the full list — hiding a category doesn't mark it read.
  const visibleNotifications = notifications.filter((n) => !notifExcluded.includes(n.type))

  const notificationsBody = (
    <>
      <div className="notif-filters" role="group" aria-label="Notification filters">
        {NOTIF_FILTERS.map(([label, types]) => {
          const isOff = types.some((t) => notifExcluded.includes(t))
          return (
            <button
              key={label}
              type="button"
              className={`notif-filter-chip${isOff ? ' off' : ''}`}
              onClick={() => toggleNotifFilter(types)}
            >
              {label}
            </button>
          )
        })}
      </div>
      {notificationsError && (
        <>
          <div className="banner banner-error">{notificationsError}</div>
          <div className="empty-state">
            <button className="pill-btn suggested" onClick={loadNotifications}>Retry</button>
          </div>
        </>
      )}
      {notificationsLoading && notifications.length === 0 ? (
        <div className="empty-state">Loading…</div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">Nothing here yet.</div>
      ) : visibleNotifications.length === 0 ? (
        <div className="empty-state">All notifications are filtered out.</div>
      ) : (
        <>
          <div className="timeline-list">
            {visibleNotifications.map((n) => (
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
                pendingFollowIds={pendingFollowIds}
                statusById={notifStatusById}
                onQuote={handleQuote}
                currentAccountId={session.account?.id}
                onDelete={handleDeleteStatus}
                onEdit={handleEditStatus}
                onMute={handleMuteAccount}
                onBlock={handleBlockAccount}
              />
            ))}
          </div>
          {notificationsHasMore && <div ref={notifSentinelRef} className="scroll-sentinel" />}
          {notificationsLoadingMore && <div className="empty-state">Loading…</div>}
        </>
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
          {error && (
            <>
              <div className="banner banner-error">{error}</div>
              <div className="empty-state">
                <button className="pill-btn suggested" onClick={loadTimeline}>Retry</button>
              </div>
            </>
          )}
          <div className="section-label">Home timeline</div>
          {loading && timeline.length === 0 ? (
            <div className="empty-state">Loading…</div>
          ) : timeline.length === 0 ? (
            <StatusPage
              icon={Home}
              heading="No posts yet"
              description="Follow someone to see their posts here."
            />
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
                  statusById={timelineStatusById}
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
            <div ref={homeSentinelRef} className="scroll-sentinel" />
          )}
        </>
      )}

      {view === 'explore' && (
        <>
          {exploreError && (
            <>
              <div className="banner banner-error">{exploreError}</div>
              <div className="empty-state">
                <button className="pill-btn suggested" onClick={() => loadExplore(exploreFeed)}>Retry</button>
              </div>
            </>
          )}
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
              <button
                className={`feed-toggle-btn${exploreFeed === 'people' ? ' active' : ''}`}
                onClick={() => setExploreFeed('people')}
                type="button"
              >
                <Users size={13} />
                People
              </button>
            </div>
          </div>
          {exploreFeed === 'people' ? (
            directoryAccounts.length === 0 && directoryLoading ? (
              <div className="empty-state">Loading…</div>
            ) : (
              <>
                <div className="timeline-list">
                  {directoryAccounts.map((account) => (
                    <button
                      type="button"
                      key={account.id}
                      className="search-account-row directory-card"
                      onClick={() => handleOpenProfile(account)}
                    >
                      <Avatar name={account.display_name || account.username} src={account.avatar} />
                      <div className="search-account-names">
                        <span className="post-name">{account.display_name || account.username}</span>
                        <span className="post-handle">@{account.acct || account.username}</span>
                      </div>
                      <span className="directory-bio">{account.note ? noteToPlainText(account.note) : ''}</span>
                    </button>
                  ))}
                </div>
                {directoryHasMore && directoryAccounts.length > 0 && (
                  <div ref={exploreSentinelRef} className="scroll-sentinel" />
                )}
                {directoryLoading && <div className="empty-state">Loading…</div>}
              </>
            )
          ) : (
            <>
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
                      statusById={exploreStatusById}
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
        </>
      )}

      {view === 'muted' && (
        <MutedAccountsView
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenProfile={(account) => { setView('home'); handleOpenProfile(account) }}
        />
      )}

      {view === 'account' && (
        <AccountSettingsView
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenProfile={(account) => { setView('home'); handleOpenProfile(account) }}
          onDeleted={logout}
        />
      )}

      {view === 'lists' && (
        <ListsView
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenThread={handleOpenThread}
          onComposeReply={handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onQuote={handleQuote}
          currentAccountId={session.account?.id}
          onDelete={handleDeleteStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
          onEdit={handleEditStatus}
        />
      )}

      {view === 'groups' && (
        <GroupsView
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenThread={handleOpenThread}
          onComposeReply={handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onQuote={handleQuote}
          onPostToGroup={handlePostToGroup}
          currentAccountId={session.account?.id}
          onDelete={handleDeleteStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
          onEdit={handleEditStatus}
        />
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

      {view === 'messages' && (
        <ConversationsView
          key={messagesRefreshTick}
          instanceUrl={session.instanceUrl}
          token={session.token}
          currentAccountId={session.account?.id}
          onOpenThread={handleOpenThread}
          onComposeReply={handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onUpdatePost={updatePost}
          onQuote={handleQuote}
          onDelete={handleDeleteStatus}
          onEdit={handleEditStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
        />
      )}

      {view === 'favourites' && (
        <FavouritesView
          key={favouritesRefreshTick}
          instanceUrl={session.instanceUrl}
          token={session.token}
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
      )}

      {view === 'bookmarks' && (
        <>
          {bookmarksError && (
            <>
              <div className="banner banner-error">{bookmarksError}</div>
              <div className="empty-state">
                <button className="pill-btn suggested" onClick={loadBookmarks}>Retry</button>
              </div>
            </>
          )}
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
                  statusById={bookmarksStatusById}
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
          <div className="section-label-row">
            <div className="section-label">Notifications</div>
            {notifications.length > 0 && (
              <button
                className="icon-btn"
                aria-label="Clear all notifications"
                title="Clear all"
                onClick={handleClearNotifications}
                disabled={clearingNotifications}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <ErrorBoundary>{notificationsBody}</ErrorBoundary>
        </>
      )}
    </div>
  )

  const threadPanelProps = {
    panel: sidePanel,
    replyStates,
    onOpenThread: (status) => handleOpenThread(status, { fromPanel: true }),
    onComposeReply: handleComposeReplyInPanel,
    onOpenLightbox: setLightboxAttachment,
    onOpenProfile: handleOpenProfile,
    onUpdateReply: updateReplyInPanel,
    onClose: closeSidePanel,
    instanceUrl: session.instanceUrl,
    token: session.token,
    onReplyPosted: handleReplyPosted,
    onCancelCompose: handleCancelCompose,
    onRefreshContext: refreshContext,
    onQuote: handleQuote,
    currentAccountId: session.account?.id,
    onDelete: handleDeleteStatus,
    onMute: handleMuteAccount,
    onBlock: handleBlockAccount,
    onEdit: handleEditStatus,
    maxCharacters: session.maxCharacters || 500,
    focusedReplyId,
  }

  // Swipe-from-left-edge to close thread on narrow tier.
  useSwipeBack(narrowThreadRef, closeSidePanel, { active: tier === 'narrow' && !!sidePanel })

  // Active skin's structural overrides (Tier 3). Adwaita has none and
  // keeps the inline GNOME header bar below.
  const SkinHeaderBar = appSettings.skin?.components?.HeaderBar || null
  const headerProps = {
    session, tier, view, setView, notifUnread,
    handleRefresh, setComposing, logout, openSettingsFrom,
    settingsOpen,
  }

  return (
    <UIContext.Provider value={appSettings.skin?.components || {}}>
    <GhostContext.Provider value={{ ghostStatusId, inPanel: false }}>
    <AppSettingsContext.Provider value={appSettings.contextValue}>
    <PickerContext.Provider value={{ openPickerId, setOpenPickerId }}>
      {!online && (
        <div className="banner banner-offline">
          You&apos;re offline — updates paused. Content is from cache.
        </div>
      )}
      <ToastStack />
      {showPullIndicator && (
        <div className={`pull-indicator${refreshing ? ' refreshing' : ''}`} style={pull ? { transform: `translateX(-50%) translateY(${Math.min(pull / 2, 24)}px)` } : undefined}>
          <RotateCw size={14} className={refreshing ? 'spin' : undefined} />
          <span>{refreshing ? 'Refreshing…' : pull >= 80 ? 'Release to refresh' : 'Pull to refresh'}</span>
        </div>
      )}
      <ScrollTopButton scrollEl={scrollEl} tier={tier} />
      {SkinHeaderBar ? (
        <SkinHeaderBar {...headerProps} />
      ) : (
      <header className="headerbar">
        <div className="headerbar-brand-wrap">
          <button
            type="button"
            className="headerbar-brand headerbar-brand-btn"
            aria-label="Server details"
            onClick={() => setServerInfoOpen((v) => !v)}
          >
            <InstanceIcon instanceUrl={session.instanceUrl} />
            <div>
              rvmf
              <div className="headerbar-subtitle">
                {session.instanceUrl.replace(/^https?:\/\//, '')}
              </div>
            </div>
          </button>
          {serverInfoOpen && (
            <ServerInfoPopover
              open={serverInfoOpen}
              onClose={() => setServerInfoOpen(false)}
              instanceUrl={session.instanceUrl}
              token={session.token}
            />
          )}
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
              {notifUnread > 0 && <span className="notif-badge">{notifUnread > 99 ? '99+' : notifUnread}</span>}
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
            className={`view-switcher-btn${view === 'messages' ? ' active' : ''}`}
            onClick={() => setView('messages')}
          >
            <MessageCircle size={14} />
            Messages
          </button>
          <button
            className={`view-switcher-btn${view === 'lists' ? ' active' : ''}`}
            onClick={() => setView('lists')}
          >
            <List size={14} />
            Lists
          </button>
          <button
            className={`view-switcher-btn${view === 'groups' ? ' active' : ''}`}
            onClick={() => setView('groups')}
          >
            <Users size={14} />
            Groups
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
          {tier === 'wide' && (
            <button
              className="icon-btn"
              aria-label="Back to top"
              title="Back to top"
              onClick={() => scrollEl?.scrollTo({
                top: 0,
                behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
              })}
            >
              <ArrowUpToLine size={16} />
            </button>
          )}
          <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={handleRefresh}>
            <RotateCw size={16} />
          </button>
          <div className="settings-menu-wrap">
            <button
              className="icon-btn"
              aria-label="Settings"
              title="Settings"
              onClick={(e) => {
                if (settingsOpen) { setSettingsOpen(false); return }
                openSettingsFrom(e)
              }}
            >
              <Settings size={16} />
            </button>
          </div>
          <button className="suggested-btn" onClick={() => setComposing(true)}>
            <Plus size={15} />
            New post
          </button>
          <button className="icon-btn" aria-label="Log out" title="Log out" onClick={logout}>
            <LogOut size={16} />
          </button>
          <Avatar
            name={session.account.display_name || session.account.username}
            src={session.account.avatar}
          />
        </div>
      </header>
      )}
      <SettingsMenu
        open={settingsOpen}
        anchor={settingsAnchor}
        settings={appSettings}
        onClose={() => setSettingsOpen(false)}
        onNavigate={setView}
      />

      {tier === 'wide' ? (
        <div className="app-shell">
          <aside className="notif-column scrollbar-thin">
            <div className="section-label-row">
            <div className="section-label">Notifications</div>
            {notifications.length > 0 && (
              <button
                className="icon-btn"
                aria-label="Clear all notifications"
                title="Clear all"
                onClick={handleClearNotifications}
                disabled={clearingNotifications}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
            <ErrorBoundary>{notificationsBody}</ErrorBoundary>
          </aside>
          <div className="content-scroll scrollbar-thin" ref={setScrollEl}><ErrorBoundary>{timelineContent}</ErrorBoundary></div>
          <aside className="thread-column">
            {sidePanel ? (
              <>
                <ThreadPanelHeader {...threadPanelProps} />
                <div className="thread-column-scroll scrollbar-thin">
                  <ErrorBoundary><ThreadPanelContent {...threadPanelProps} /></ErrorBoundary>
                </div>
              </>
            ) : (
                <div className="thread-column-empty">
                <StatusPage
                  icon={MessageCircle}
                  heading="No thread open"
                  description="Select a post to view its replies."
                />
              </div>
            )}
          </aside>
        </div>
      ) : tier === 'medium' ? (
        <div className={`main-layout${sidePanel ? ' panel-open' : ''}`}>
          <div className="content-scroll scrollbar-thin" ref={setScrollEl}><ErrorBoundary>{timelineContent}</ErrorBoundary></div>
          <ErrorBoundary><ThreadPanel {...threadPanelProps} /></ErrorBoundary>
        </div>
      ) : (
        <div className={`main-layout${sidePanel ? ' narrow-thread' : ''}`} ref={narrowThreadRef}>
          {sidePanel && <ThreadPanelHeader {...threadPanelProps} backLabel="Back to timeline" />}
          <div className="content-scroll scrollbar-thin" ref={setScrollEl}>
            {sidePanel ? (
              <div className="timeline-wrap">
                <ErrorBoundary><ThreadPanelContent {...threadPanelProps} backLabel="Back to timeline" /></ErrorBoundary>
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
          // Remount when the compose context (reply/quote/group target)
          // changes while open: non-draft state (uploads, poll, error,
          // idempotency key) must not leak across targets. Draft text
          // survives via useComposeDraft.
          key={replyContext?.id || quoteStatus?.id || composerGroup?.id || 'new'}
          instanceUrl={session.instanceUrl}
          token={session.token}
          onClose={() => { setComposing(false); setQuoteStatus(null); setReplyContext(null); setComposerGroup(null) }}
          onPosted={prependPost}
          quoteStatus={quoteStatus}
          replyToStatus={replyContext}
          maxCharacters={session.maxCharacters || 500}
          groupId={composerGroup?.id || null}
          groupName={composerGroup ? (composerGroup.display_name || composerGroup.acct || composerGroup.username) : null}
          currentAccountId={session.account?.id}
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
    </GhostContext.Provider>
    </UIContext.Provider>
  )
}
