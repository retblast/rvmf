import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as mitra from './lib/mitra'
import { mergeStatusIntoRow } from './lib/render.jsx'

// Hard cap on in-memory timeline rows. The server paginates the home feed
// forever, and an unbounded array would quietly grow this session's heap
// the whole time the tab is open. ~400 rows is well past any realistic
// scrolling session (infinite scroll fetches older pages on demand), so
// the array is trimmed to the newest TIMELINE_MAX_ROWS whenever it grows.
const TIMELINE_MAX_ROWS = 400

// Home timeline: list, pagination, infinite scroll, the 5s liveness poll,
// and the row-update helpers other surfaces share (via updatePost).
export function useTimeline(session, { view, tier }) {
  const [timeline, setTimeline] = useState([])
  // Pagination cursor tracked separately from the array: with
  // TIMELINE_MAX_ROWS trimming scroll-spam rows, the array's tail is "the
  // oldest row still in memory", not the true fetch boundary.
  const lastStatusIdRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // Own ref, not document.querySelector: on the wide tier the
  // notifications column renders before this view and carries a
  // sentinel of its own — a class-based lookup would grab that one
  // and home's infinite scroll would watch the wrong element.
  const homeSentinelRef = useRef(null)

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
      setTimeline((prev) => {
        // Dedupe against what's mounted: a reblog wrapper or a just-
        // prepended post can already be on screen when its page arrives,
        // which would render the same row twice.
        const seen = new Set()
        for (const row of prev) {
          seen.add(row.id)
          if (row.reblog) seen.add(row.reblog.id)
        }
        const fresh = statuses.filter((row) =>
          !seen.has(row.id) && !(row.reblog && seen.has(row.reblog.id))
        )
        return [...prev, ...fresh].slice(0, TIMELINE_MAX_ROWS)
      })
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

  function updatePost(updated) {
    setTimeline((prev) => prev.map((p) => mergeStatusIntoRow(p, updated)))
  }

  function prependPost(post) {
    setTimeline((prev) => [post, ...prev].slice(0, TIMELINE_MAX_ROWS))
  }

  function removeStatus(statusId) {
    setTimeline((prev) => prev.filter((p) => p.id !== statusId))
  }

  // id→status map so PostRow can look up parent statuses for "in reply to"
  // links. Kept scoped to this timeline — a boost here shouldn't leak
  // into other feeds (they keep their own maps).
  const statusByIdMemo = useMemo(() => {
    const m = new Map()
    for (const p of timeline) {
      m.set(p.id, p)
      if (p.reblog) m.set(p.reblog.id, p.reblog)
    }
    return m
  }, [timeline])

  return {
    timeline, loading, error, hasMore, loadingMore, homeSentinelRef,
    statusById: statusByIdMemo,
    loadTimeline, loadMoreTimeline, updatePost, prependPost, removeStatus,
  }
}
