import { useCallback, useEffect, useRef, useState } from 'react'
import * as mitra from './lib/mitra'
import { buildReplyTree, findNode, insertIntoTree, updateTreeNode } from './lib/render.jsx'

// The side-panel thread engine: which thread is open, the loaded reply
// trees, the "Viewing in thread" ghost anchor, focused-reply highlighting,
// inline-compose targeting, and the 5s silent refresh while a thread is
// open. `openComposerForReply(status)` (App-owned composer state) handles
// replies that target posts outside the open thread's tree.
export function useThreadPanel(session, { openComposerForReply }) {
  const [replyStates, setReplyStates] = useState({})
  const replyStatesRef = useRef(replyStates)
  replyStatesRef.current = replyStates
  const [sidePanel, setSidePanel] = useState(null)
  const sidePanelRef = useRef(sidePanel)
  sidePanelRef.current = sidePanel
  // The timeline row the user clicked outside the panel — drives the
  // ghost placeholder ("Viewing in thread"). Anchors independently of
  // sidePanel.status, which may be the thread root for mid-thread
  // replies or refreshed by the poll interval.
  const [ghostStatusId, setGhostStatusId] = useState(null)
  // Guards async thread-open fetches: remembers which status started the
  // in-flight load so a stale resolve can't clobber a newer open (or an
  // explicit close).
  const lastThreadOpenRef = useRef(null)
  const [focusedReplyId, setFocusedReplyId] = useState(null)

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

  // Resolves the thread root for `status`. If the post is a mid-thread
  // reply (has ancestors), we re-fetch from the root so the full thread
  // — including sibling branches — is shown. Returns { root, clickedId }
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
          // Mid-thread post: ancestors[0] is the thread root. Re-fetch
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
  // or no-ops if that same status is already showing. This is the only
  // way threads open anywhere in the app: always the slide-out panel,
  // never inline in the timeline.
  //
  // { fromPanel } — set when the click originates from inside the thread
  // panel (e.g. a reply's own onOpenThread). Panel-internal navigation
  // never changes the ghost anchor — the marker stays on the row the user
  // clicked *outside* the panel.
  function handleOpenThread(status, { fromPanel = false } = {}) {
    // If already showing this exact post, re-anchor the ghost and bail.
    if (sidePanelRef.current?.mode === 'thread' && sidePanelRef.current.status.id === status.id) {
      if (!fromPanel) setGhostStatusId(status.id)
      return
    }

    // Ghost the clicked row immediately so the banner appears without
    // waiting for the async thread resolve. For mid-thread replies the
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
      openComposerForReply(status)
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
  // thread mode. Other paths that null the panel (profile/hashtag opens,
  // deletion, close button) must not leave a row frozen as "Viewing in
  // thread".
  useEffect(() => {
    if (!sidePanel) {
      setGhostStatusId(null)
      setFocusedReplyId(null)
    }
  }, [sidePanel])

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

  return {
    sidePanel, setSidePanel, replyStates, ghostStatusId, focusedReplyId,
    closeSidePanel, refreshContext,
    handleOpenThread, handleComposeReplyInPanel, handleCancelCompose,
    handleComposeReply, handleReplyPosted, updateReplyInPanel,
  }
}
