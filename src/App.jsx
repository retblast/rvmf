import { useCallback, useEffect, useRef, useState } from 'react'
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
  LogOut,
  Globe,
  Settings,
  Trash2,
} from 'lucide-react'
import { useMitraSession } from './useMitraSession'
import * as mitra from './lib/mitra'
import { buildReplyTree, findNode, insertIntoTree, updateTreeNode, htmlToPlainText as noteToPlainText } from './lib/render.jsx'
import { AppSettingsContext, PickerContext, useLayoutTier, usePullToRefresh } from './hooks'
import LoginView from './LoginView'
import { Avatar, MediaLightbox } from './components/Media.jsx'
import { NotificationRow, PostRow } from './components/Post.jsx'
import { ComposeDialog, EditDialog, visibilityLabel as mitraVisibilityLabel } from './components/Compose.jsx'
import { ThreadPanel, ThreadPanelContent } from './components/ThreadPanel.jsx'
import { ProfileView } from './components/ProfileView.jsx'
import { SearchView } from './components/SearchView.jsx'
import { HashtagFeed } from './components/HashtagFeed.jsx'
import { MutedAccountsView } from './components/MutedAccountsView.jsx'
import InstanceIcon from './components/InstanceIcon.jsx'
import { applyOsAccent } from './lib/osAccent'
import { ListsView } from './components/ListsView.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { GroupsView } from './components/GroupsView.jsx'
import { ConversationsView } from './components/ConversationsView.jsx'
import { AccountSettingsView } from './components/AccountSettingsView.jsx'
import { FavouritesView } from './components/FavouritesView.jsx'

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

// Server-side notification policy rules (GET /v2/notifications/policy).
// Values are 'accept' | 'drop' and can't be changed from the API — the
// instance decides them.
const NOTIF_POLICY_RULES = [
  ['for_not_following', "From people you don't follow"],
  ['for_not_followers', "From people not following you"],
  ['for_new_accounts', 'From brand-new accounts'],
  ['for_private_mentions', 'From direct mentions'],
]

export default function App() {
  const { session, beginLogin, logout, authError, completingLogin } = useMitraSession()
  const tier = useLayoutTier()
  const [scrollEl, setScrollEl] = useState(null)
  const refreshRef = useRef(() => {})
  const [view, setView] = useState('home')
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [composing, setComposing] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState(null)
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
      const raw = JSON.parse(localStorage.getItem('mitra-notif-excluded'))
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
  const [clientName, setClientNameState] = useState(() => mitra.getClientName())
  const [notifPolicy, setNotifPolicy] = useState(null)
  const [defaultVisibility, setDefaultVisibility] = useState('public')
  const [clearingNotifications, setClearingNotifications] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [fetchClientMedia, setFetchClientMedia] = useState(() => {
    try {
      return localStorage.getItem('mitra-fetch-client-media') !== 'false'
    } catch {
      return true
    }
  })

  const [alwaysSensitive, setAlwaysSensitive] = useState(() => {
    try {
      return localStorage.getItem('mitra-always-sensitive') === 'true'
    } catch {
      return false
    }
  })

  const [useOsAccent, setUseOsAccent] = useState(() => {
    try {
      return localStorage.getItem('mitra-use-os-accent') !== 'false'
    } catch {
      return true
    }
  })

  function toggleUseOsAccent() {
    setUseOsAccent((prev) => {
      const next = !prev
      applyOsAccent(next)
      try {
        localStorage.setItem('mitra-use-os-accent', String(next))
      } catch { /* persistence unavailable */ }
      return next
    })
  }

  function toggleAlwaysSensitive() {
    setAlwaysSensitive((prev) => {
      const next = !prev
      try {
        localStorage.setItem('mitra-always-sensitive', String(next))
      } catch { /* persistence unavailable */ }
      return next
    })
  }

  // Only meaningful when strict sensitive mode hides everything: allow
  // hover previews to peek at unrevealed media.
  const [peekSpoilerMedia, setPeekSpoilerMedia] = useState(() => {
    try {
      return localStorage.getItem('mitra-peek-spoiler') === 'true'
    } catch {
      return false
    }
  })

  function togglePeekSpoilerMedia() {
    setPeekSpoilerMedia((prev) => {
      const next = !prev
      try {
        localStorage.setItem('mitra-peek-spoiler', String(next))
      } catch { /* persistence unavailable */ }
      return next
    })
  }

  function toggleFetchClientMedia() {
    setFetchClientMedia((prev) => {
      const next = !prev
      try {
        localStorage.setItem('mitra-fetch-client-media', String(next))
      } catch { /* ignore */ }
      return next
    })
  }

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

  // Persist the posting default on the account (SharedClientConfig) so
  // it applies everywhere, not just this browser.
  function handleDefaultVisibilityChange(v) {
    const previous = defaultVisibility
    setDefaultVisibility(v)
    if (!session) return
    mitra.updateCredentials(session.instanceUrl, session.token, { source: { privacy: v } })
      .catch(() => setDefaultVisibility(previous))
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
    } catch { /* persistence unavailable */ }
  }, [themeMode])

  // Browser tab favicon follows the instance; restored when logged out.
  const defaultFaviconRef = useRef(null)
  useEffect(() => {
    let link = document.querySelector("link[rel~='icon']")
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    if (!defaultFaviconRef.current) defaultFaviconRef.current = link.href
    link.href = session
      ? `${session.instanceUrl}/favicon.ico`
      : defaultFaviconRef.current
  }, [session])

  const loadTimeline = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError('')
    setHasMore(true)
    try {
      const statuses = await mitra.fetchHomeTimeline(session.instanceUrl, session.token)
      setTimeline(statuses)
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

  function toggleNotifFilter(types) {
    setNotifExcluded((prev) => {
      const isOn = !types.some((t) => prev.includes(t))
      const next = isOn
        ? [...prev, ...types.filter((t) => !prev.includes(t))]
        : prev.filter((t) => !types.includes(t))
      try {
        localStorage.setItem('mitra-notif-excluded', JSON.stringify(next))
      } catch { /* persistence unavailable */ }
      return next
    })
  }

  const loadNotifications = useCallback(async () => {
    if (!session) return
    setNotificationsLoading(true)
    setNotificationsError('')
    setNotificationsHasMore(true)
    try {
      const items = await mitra.fetchNotifications(session.instanceUrl, session.token)
      setNotifications(items)
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

  // Server-side posting default: seeds the composer's visibility and
  // syncs across devices via SharedClientConfig.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    mitra.fetchPreferences(session.instanceUrl, session.token)
      .then((prefs) => {
        const v = prefs?.['posting:default:visibility']
        if (!cancelled && v) setDefaultVisibility(v)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [session])

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
      } else if (settingsOpen) {
        e.preventDefault()
        setSettingsOpen(false)
      } else if (sidePanel) {
        e.preventDefault()
        closeSidePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [composing, editing, openPickerId, settingsOpen, sidePanel])

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

  // Auto-refresh the thread panel every 5 seconds (silent, no loading flash)
  useEffect(() => {
    if (sidePanel?.mode !== 'thread' || !sidePanel.status) return
    const statusId = sidePanel.status.id
    const interval = setInterval(() => {
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
  }, [sidePanel, session, refreshContext])

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
      if (rootId) refreshContext(rootId)
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
      {notificationsError && <div className="banner banner-error">{notificationsError}</div>}
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
    onOpenThread: handleOpenThread,
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

  return (
    <AppSettingsContext.Provider value={{ fetchClientMedia, alwaysSensitive, peekSpoilerMedia, defaultVisibility, instanceUrl: session.instanceUrl, token: session.token }}>
    <PickerContext.Provider value={{ openPickerId, setOpenPickerId }}>
      {showPullIndicator && (
        <div className={`pull-indicator${refreshing ? ' refreshing' : ''}`} style={pull ? { transform: `translateX(-50%) translateY(${Math.min(pull / 2, 24)}px)` } : undefined}>
          <RotateCw size={14} className={refreshing ? 'spin' : undefined} />
          <span>{refreshing ? 'Refreshing…' : pull >= 80 ? 'Release to refresh' : 'Pull to refresh'}</span>
        </div>
      )}
      <header className="headerbar">
        <div className="headerbar-brand">
          <InstanceIcon instanceUrl={session.instanceUrl} />
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
          <button className="icon-btn" aria-label="Refresh" onClick={handleRefresh}>
            <RotateCw size={16} />
          </button>
          <div className="settings-menu-wrap">
            <button
              className="icon-btn"
              aria-label="Settings"
              onClick={() => {
                setSettingsOpen((v) => !v)
                if (!notifPolicy) {
                  mitra.fetchNotificationPolicy(session.instanceUrl, session.token)
                    .then(setNotifPolicy)
                    .catch(() => {})
                }
              }}
            >
              <Settings size={16} />
            </button>
            {settingsOpen && (
              <>
                <div className="settings-menu-backdrop" onClick={() => setSettingsOpen(false)} />
                <div className="settings-menu">
                  <label className="settings-menu-row">
                    <span>Fetch media directly</span>
                    <input
                      type="checkbox"
                      checked={fetchClientMedia}
                      onChange={toggleFetchClientMedia}
                    />
                  </label>
                  <label className="settings-menu-row">
                    <span>Mark all media as sensitive</span>
                    <input
                      type="checkbox"
                      checked={alwaysSensitive}
                      onChange={toggleAlwaysSensitive}
                    />
                  </label>
                  {alwaysSensitive && (
                    <label className="settings-menu-row settings-menu-subrow">
                      <span>Reveal media on hover (peek)</span>
                      <input
                        type="checkbox"
                        checked={peekSpoilerMedia}
                        onChange={togglePeekSpoilerMedia}
                      />
                    </label>
                  )}
                  <label className="settings-menu-row">
                    <span>Use system accent color</span>
                    <input
                      type="checkbox"
                      checked={useOsAccent}
                      onChange={toggleUseOsAccent}
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
                    <span>Default post visibility</span>
                    <select
                      className="compose-visibility-select"
                      value={defaultVisibility}
                      onChange={(e) => handleDefaultVisibilityChange(e.target.value)}
                    >
                      {['public', 'unlisted', 'private', 'subscribers', 'direct'].map((v) => (
                        <option key={v} value={v}>{mitraVisibilityLabel(v)}</option>
                      ))}
                    </select>
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
                  <button
                    type="button"
                    className="settings-menu-row settings-menu-link"
                    onClick={() => { setSettingsOpen(false); setView('favourites') }}
                  >
                    <span>Favourites</span>
                    <span className="settings-menu-arrow">→</span>
                  </button>
                  <button
                    type="button"
                    className="settings-menu-row settings-menu-link"
                    onClick={() => { setSettingsOpen(false); setView('muted') }}
                  >
                    <span>Muted accounts</span>
                    <span className="settings-menu-arrow">→</span>
                  </button>
                  <button
                    type="button"
                    className="settings-menu-row settings-menu-link"
                    onClick={() => { setSettingsOpen(false); setView('account') }}
                  >
                    <span>Account &amp; sessions</span>
                    <span className="settings-menu-arrow">→</span>
                  </button>
                  {notifPolicy && (
                    <div className="settings-menu-section">
                      <span className="settings-menu-heading">Filtered notifications (server)</span>
                      {/* Mitra's policy values are 'accept' | 'drop' — which
                          notifications the instance filters before you ever
                          see them. Server-decided, so display-only. */}
                      {NOTIF_POLICY_RULES.map(([key, label]) => {
                        const value = notifPolicy[key]
                        if (!value) return null
                        return (
                          <div key={key} className="settings-menu-row settings-menu-subrow">
                            <span>{label}</span>
                            <span className={`notif-policy-badge${value === 'drop' ? ' drop' : ''}`}>
                              {value}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
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
          <aside className="thread-column scrollbar-thin">
            {sidePanel ? (
              <ErrorBoundary><ThreadPanelContent {...threadPanelProps} /></ErrorBoundary>
            ) : (
              <div className="thread-column-empty">Select a post to view its replies.</div>
            )}
          </aside>
        </div>
      ) : tier === 'medium' ? (
        <div className={`main-layout${sidePanel ? ' panel-open' : ''}`}>
          <div className="content-scroll scrollbar-thin" ref={setScrollEl}><ErrorBoundary>{timelineContent}</ErrorBoundary></div>
          <ErrorBoundary><ThreadPanel {...threadPanelProps} /></ErrorBoundary>
        </div>
      ) : (
        <div className="main-layout">
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
          instanceUrl={session.instanceUrl}
          token={session.token}
          onClose={() => { setComposing(false); setQuoteStatus(null); setReplyContext(null) }}
          onPosted={prependPost}
          quoteStatus={quoteStatus}
          replyToStatus={replyContext}
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
