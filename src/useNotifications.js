import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as mitra from './lib/mitra'
import { storageGet, storageSet } from './lib/storage.js'
import { mergeStatusIntoRow } from './lib/render.jsx'

// Server-side notification filters (exclude_types[]). A group counts as
// "off" when any of its types is excluded; groups never overlap.
export const NOTIF_FILTERS = [
  ['Mentions', ['mention']],
  ['Boosts', ['reblog']],
  ['Quotes', ['quote']],
  ['Favourites', ['favourite']],
  ['Reactions', ['pleroma:emoji_reaction']],
  ['Follows', ['follow', 'follow_request']],
  ['Polls', ['poll']],
  ['Edits', ['update']],
]

// Notifications domain: list + pagination, server-side exclude filter,
// markers-API read position (unread badge + pin-while-visible), the 5s
// poll, pending follow requests, and clearing. Needs `view`/`tier` because
// notifications are only polled while they're on screen — the tab view on
// narrow/medium tiers or the permanent column on wide.
export function useNotifications(session, { view, tier }) {
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
  // Account ids with pending incoming follow requests (null = unknown yet)
  const [pendingFollowIds, setPendingFollowIds] = useState(null)
  const [clearingNotifications, setClearingNotifications] = useState(false)

  const notificationsVisible = view === 'notifications' || tier === 'wide'

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
    if (notificationsVisible) {
      loadNotifications()
    }
  }, [notificationsVisible, loadNotifications])

  // Auto-refresh notifications every 5 seconds (silent). Also refreshes
  // pendingFollowIds so that newly-arriving follow_request notifications
  // immediately show Accept/Reject instead of flashing "already handled".
  useEffect(() => {
    if (!notificationsVisible || !session) return
    let polling = true
    const tick = () => {
      if (!polling) return
      if (document.hidden) return // hidden tab: battery and server load can wait
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
    }
    const interval = setInterval(tick, 5000)
    // Coming back to the tab refreshes immediately instead of waiting
    // out the rest of a skipped interval.
    const onVisible = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      polling = false
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [notificationsVisible, session])

  async function clearNotifications() {
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

  // Favouriting/boosting a notification's own status updates the row in
  // the list (as opposed to updateReplyInPanel, which handles thread
  // trees). Two different data shapes, so a small dedicated helper.
  function updateNotificationStatus(updated) {
    setNotifications((prev) =>
      prev.map((n) => {
        if (!n.status) return n
        const merged = mergeStatusIntoRow(n.status, updated)
        return merged === n.status ? n : { ...n, status: merged }
      })
    )
  }

  // Mitra has no exclude_types[] query param, so chip filtering happens at
  // render time. The unread badge and marker sync above still use the full
  // list — hiding a category doesn't mark it read.
  const visibleNotifications = useMemo(
    () => notifications.filter((n) => !notifExcluded.includes(n.type)),
    [notifications, notifExcluded]
  )

  return {
    notifications, notificationsLoading, notificationsError,
    visibleNotifications, notificationsHasMore, notificationsLoadingMore,
    notifSentinelRef, notifExcluded, setNotifExcluded, toggleNotifFilter,
    notifMarkerAt, notifUnread, notificationsVisible,
    pendingFollowIds, clearingNotifications,
    loadNotifications, clearNotifications, respondFollowRequest,
    updateNotificationStatus,
  }
}
