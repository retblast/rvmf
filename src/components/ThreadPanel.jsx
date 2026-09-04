import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, LoaderCircle, X } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { PostRow, ThreadReply } from './Post.jsx'
import { GhostContext } from '../hooks'
import { ReplyComposerFields } from './ReplyComposer.jsx'

const EASE = [0.32, 0.72, 0, 1]

// Panel-opening choreography: the focal post slides in from the direction
// of the timeline; ancestors stagger into place converging upward toward
// it (closest ancestor first, since it's nearest the anchor); replies
// stagger into place converging downward (closest reply first). Everything
// arranges itself around the post you actually clicked.
const focalVariants = {
  hidden: { opacity: 0, x: -18 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.32, ease: EASE } },
}
const ancestorItemVariants = {
  hidden: { opacity: 0, y: -14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
}
const descendantItemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
}
const staggerUpVariants = {
  hidden: {},
  visible: { transition: { delayChildren: 0.1, staggerChildren: 0.05, staggerDirection: -1 } },
}
const staggerDownVariants = {
  hidden: {},
  visible: { transition: { delayChildren: 0.1, staggerChildren: 0.05 } },
}

export function ThreadPanelContent({
  panel,
  replyStates,
  onOpenThread,
  onComposeReply,
  onOpenLightbox,
  onOpenProfile,
  onUpdateReply,
  onClose,
  onCancelCompose,
  onRefreshContext,
  instanceUrl,
  token,
  onReplyPosted,
  backLabel,
  onQuote,
  currentAccountId,
  onDelete,
  onMute,
  onBlock,
  onEdit,
  maxCharacters,
  focusedReplyId,
}) {
  const status = panel?.status
  const state = status ? replyStates[status.id] : null
  const composingStatusId = panel?.composingStatusId || null
  const [backfilling, setBackfilling] = useState(false)
  const [collapsedReplies, setCollapsedReplies] = useState(new Set())

  function toggleCollapse(id) {
    setCollapsedReplies((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Remote posts only show the replies this instance has seen; this asks
  // it to pull the conversation from the origin server, then refreshes.
  const isRemote = Boolean(status?.account?.acct?.includes('@'))
  async function backfillConversation() {
    if (!status || backfilling) return
    setBackfilling(true)
    try {
      await mitra.loadConversation(instanceUrl, token, status.id, true)
      onRefreshContext?.(status.id)
    } catch (err) {
      console.error(err)
    } finally {
      setBackfilling(false)
    }
  }

  const statusById = useMemo(() => {
    const map = new Map()
    if (status) map.set(status.id, status)
    if (state?.ancestors) state.ancestors.forEach((a) => map.set(a.id, a))
    function collect(nodes) {
      for (const node of nodes) {
        map.set(node.status.id, node.status)
        if (node.children.length > 0) collect(node.children)
      }
    }
    if (state?.items) collect(state.items)
    return map
  }, [status, state])

  const composing = Boolean(composingStatusId)

  const [highlightedId, setHighlightedId] = useState(null)

  useEffect(() => {
    if (!focusedReplyId) return
    const el = document.querySelector(`[data-status-id="${focusedReplyId}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusedReplyId])

  // Rendered inline by the focal post or whichever reply is targeted
  const composerProps = {
    instanceUrl,
    token,
    onClose: onCancelCompose,
    onPosted: onReplyPosted,
    maxCharacters,
    currentAccountId,
  }

  if (panel?.mode === 'compose') {
    return (
      <ReplyComposerFields
        status={status}
        instanceUrl={instanceUrl}
        token={token}
        onClose={onClose}
        onPosted={(rootId, reply) => {
          onReplyPosted(rootId, reply)
          onClose()
        }}
        maxCharacters={maxCharacters}
        currentAccountId={currentAccountId}
      />
    )
  }

  return (
    <GhostContext.Provider value={{ ghostStatusId: null, inPanel: true }}>
    <motion.div key={status?.id || 'empty'} data-testid="thread-root">
      <div className="thread-panel-header">
        <span className="dialog-title">
          {composing ? 'Reply' : (
            <>
              {backLabel && (
                <button className="icon-btn thread-back-btn" aria-label={backLabel} onClick={onClose}>
                  <ArrowLeft size={16} />
                </button>
              )}
              {state?.ancestors?.length > 0 ? 'Thread' : 'Replies'}
            </>
          )}
        </span>
        {composing ? (
          <button className="icon-btn" aria-label="Cancel reply" onClick={onCancelCompose}>
            <X size={16} />
          </button>
        ) : (
          !backLabel && (
            <button className="icon-btn" aria-label="Close replies" onClick={onClose}>
              <X size={16} />
            </button>
          )
        )}
      </div>
      {state?.ancestors?.length > 0 && (
        <motion.div
          className="thread-ancestors"
          variants={staggerUpVariants}
          initial="hidden"
          animate="visible"
        >
          {state.ancestors.map((ancestor) => (
            <motion.div key={ancestor.id} variants={ancestorItemVariants}>
              <ThreadReply
                node={{ status: ancestor, children: [] }}
                depth={state.ancestors.indexOf(ancestor)}
                composerFor={composingStatusId}
                composerProps={composerProps}
                instanceUrl={instanceUrl}
                token={token}
                onUpdate={onUpdateReply}
                onOpenThread={onOpenThread}
                onComposeReply={onComposeReply}
                onOpenLightbox={onOpenLightbox}
                onOpenProfile={onOpenProfile}
                statusById={statusById}
                onQuote={onQuote}
                highlightedId={highlightedId}
                focusedReplyId={focusedReplyId}
                onHighlightParent={setHighlightedId}
                currentAccountId={currentAccountId}
                onDelete={onDelete}
                onEdit={onEdit}
                onMute={onMute}
                onBlock={onBlock}
                collapsedReplies={collapsedReplies}
                onToggleCollapse={toggleCollapse}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
      {status && (
        <div className="thread-panel-focal">
          <AnimatePresence>
            <motion.div
              key={status.id}
              layoutId={`post-${status.id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <PostRow
            post={status}
            composerFor={composingStatusId}
            composerProps={{ ...composerProps, status }}
            instanceUrl={instanceUrl}
            token={token}
            onUpdate={onUpdateReply}
            onOpenThread={onOpenThread}
            onComposeReply={onComposeReply}
            onOpenLightbox={onOpenLightbox}
            onOpenProfile={onOpenProfile}
            onQuote={onQuote}
            statusById={statusById}
            depth={state.ancestors?.length || 0}
            highlightedId={highlightedId}
            onHighlightParent={setHighlightedId}
            currentAccountId={currentAccountId}
            onDelete={onDelete}
            onEdit={onEdit}
            onMute={onMute}
            onBlock={onBlock}
          />
            </motion.div>
          </AnimatePresence>
        </div>
      )}
      <motion.div
        className="thread-panel-replies"
        variants={staggerDownVariants}
        initial="hidden"
        animate="visible"
      >
        {state?.loading && <div className="reply-loading">Loading replies…</div>}
        {state?.error && <div className="banner banner-error">{state.error}</div>}
        {isRemote && (
          <button
            type="button"
            className="pill-btn backfill-btn"
            onClick={backfillConversation}
            disabled={backfilling}
          >
            <LoaderCircle size={13} className={backfilling ? 'spin' : undefined} style={{ marginRight: 4 }} />
            {backfilling ? 'Fetching from origin…' : 'Load missing replies from origin'}
          </button>
        )}
        {state?.items?.map((node) => (
          <motion.div key={node.status.id} variants={descendantItemVariants} data-status-id={node.status.id} className={focusedReplyId === node.status.id ? 'focused-reply' : undefined}>
            <ThreadReply
              node={node}
              depth={state.ancestors.length + 1}
              composerFor={composingStatusId}
              composerProps={composerProps}
              instanceUrl={instanceUrl}
              token={token}
              onUpdate={onUpdateReply}
              onOpenThread={onOpenThread}
              onComposeReply={onComposeReply}
              onOpenLightbox={onOpenLightbox}
              onOpenProfile={onOpenProfile}
              statusById={statusById}
              onQuote={onQuote}
              highlightedId={highlightedId}
              focusedReplyId={focusedReplyId}
              onHighlightParent={setHighlightedId}
              currentAccountId={currentAccountId}
              onDelete={onDelete}
              onEdit={onEdit}
              onMute={onMute}
              onBlock={onBlock}
              collapsedReplies={collapsedReplies}
              onToggleCollapse={toggleCollapse}
            />
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
    </GhostContext.Provider>
  )
}

// The sliding-panel presentation: used at the "medium" window-width tier,
// where there's room to push the timeline over but not enough for a
// permanent third column. Wide tier renders ThreadPanelContent directly in
// a permanent column instead; narrow tier renders it in place of the
// timeline. Same content, three different chromes.
export function ThreadPanel(props) {
  const { panel, onClose } = props
  return (
    <>
      <div className="thread-panel-backdrop" onClick={onClose} />
      <aside className={`thread-panel${panel ? ' open' : ''}`}>
        <div className="thread-panel-inner scrollbar-thin">
          <ThreadPanelContent {...props} />
        </div>
      </aside>
    </>
  )
}
