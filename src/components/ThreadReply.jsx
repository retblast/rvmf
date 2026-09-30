// Thread reply rows — the recursive unit of thread trees, rendered by
// the thread panel and the notification rows. Split out of Post.jsx so
// NotificationRow can depend on it without a cycle through PostRow.
import { useContext, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { PickerContext, useMaskIdentity, useMentionMaskId } from '../hooks'
import { formatRelativeTime, processStatusContentForDisplay, renderEmojiText } from '../lib/render.jsx'
import { Avatar, MediaGrid } from './Media.jsx'
import { ReplyComposerFields } from './ReplyComposer.jsx'
import {
  buildReplyMentions, ReplyContextLine, useTranslation, TranslatedBody,
  usePostActions, PostActions, ReactionChips, QuoteCard, PollCard,
} from './postCore.jsx'
// One reply, at any depth, with the exact same action row and interactivity
// as a normal post row (reply/boost/favourite/monero/more, all functional)
// — not a stripped-down version. Its own already-loaded children render
// directly beneath it — no per-node fetch or click-to-expand, since the
// whole subtree came from one /context call at the moment the thread was
// opened. Clicking a reply's body re-opens the panel focused on it
// specifically (fresh ancestors, in case there's more context above what's
// already showing), same handler as everywhere else in the app.
export function ThreadReply({
  node,
  depth = 0,
  instanceUrl,
  token,
  onUpdate,
  onOpenThread,
  onComposeReply,
  onOpenLightbox,
  onOpenProfile,
  statusById,
  onQuote,
  compact = false,
  highlightedId,
  focusedReplyId,
  onHighlightParent,
  currentAccountId,
  onDelete,
  onEdit,
  onMute,
  onBlock,
  composerFor,
  composerProps,
  collapsedReplies,
  onToggleCollapse,
}) {
  const [mediaHidden, setMediaHidden] = useState(false)
  const [accountsView, setAccountsView] = useState(null)
  const { openPickerId, setOpenPickerId } = useContext(PickerContext)
  const showPicker = openPickerId === node.status.id
  const setShowPicker = (open) => setOpenPickerId(open ? node.status.id : null)
  const status = node.status
  const mask = useMaskIdentity()
  const mentionMaskId = useMentionMaskId()
  const account = mask(status.account || {})
  const rawName = account.display_name || account.username || 'Unknown'
  const name = renderEmojiText(rawName, account.emojis)
  const content = processStatusContentForDisplay(status, instanceUrl, mentionMaskId)
  const translation = useTranslation(status)
  const parentStatus = statusById?.get(status.in_reply_to_id) || null
  // Build the sorted mention list: reply target first, then other body mentions.
  const replyMentions = buildReplyMentions(status)

  function handlePollUpdated(poll) {
    onUpdate({ ...status, poll })
  }

  const { busy, toggleBookmark, toggleReaction, toggleFavourite, toggleReblog } =
    usePostActions({ status, instanceUrl, token, onUpdate })

  return (
    <>
      <div
        className={`reply-row${highlightedId === status.id ? ' highlighted' : ''}${focusedReplyId === status.id ? ' focused-reply' : ''}`}
        style={{ '--reply-depth': depth }}
        data-status-id={status.id}
      >
        <Avatar name={rawName} src={account.avatar} staticSrc={account.avatar_static} onClick={() => onOpenProfile?.(account)} />
        <div
          className="reply-body"
          onClick={(e) => {
            e.stopPropagation()
            onOpenThread(status)
          }}
        >
          <div className="post-meta">
            <span className="post-name" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>{name}</span>
            <span className="post-handle" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>@{account.acct || account.username}</span>
            {parentStatus && (
              <button
                className="post-parent-link"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenThread(parentStatus)
                }}
                onMouseEnter={() => onHighlightParent?.(parentStatus.id)}
                onMouseLeave={() => onHighlightParent?.(null)}
              >
                parent
              </button>
            )}
            <span className="post-time">{formatRelativeTime(status.created_at)}</span>
            {status.edited_at && (
              <span className="post-edited" title={`Edited ${formatRelativeTime(status.edited_at)}`}>
                (edited)
              </span>
            )}
            {node.children.length > 0 && collapsedReplies && (
              <button
                className={`reply-collapse-btn${collapsedReplies.has(node.status.id) ? '' : ' open'}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleCollapse?.(node.status.id)
                }}
                aria-label={collapsedReplies.has(node.status.id) ? 'Expand replies' : 'Collapse replies'}
              >
                <ChevronRight size={13} className="accordion-chevron" />
                <span className="reply-collapse-count">{node.children.length}</span>
              </button>
            )}
          </div>
          <ReplyContextLine mentions={replyMentions} onOpenProfile={onOpenProfile} />
          {translation.shown
            ? <TranslatedBody status={status} t={translation} />
            : <p className="post-text">{content.textNodes}</p>}
          <QuoteCard status={status.pleroma?.quote || status.quote?.quoted_status || status.quote} instanceUrl={instanceUrl} onOpenThread={onOpenThread} />
          {status.poll && (
            <PollCard
              poll={status.poll}
              instanceUrl={instanceUrl}
              token={token}
              onUpdated={handlePollUpdated}
              statusId={status.id}
            />
          )}
          <MediaGrid
            attachments={content.attachments}
            sensitive={content.sensitive}
            spoilerText={content.spoilerText}
            onOpenLightbox={onOpenLightbox}
            forceHidden={mediaHidden}
          />
          <ReactionChips
            reactions={status.pleroma?.emoji_reactions}
            statusId={status.id}
            instanceUrl={instanceUrl}
            token={token}
            onReact={toggleReaction}
          />
          <PostActions
            status={status}
            instanceUrl={instanceUrl}
            token={token}
            compact={compact}
            content={content}
            currentAccountId={currentAccountId}
            busy={busy}
            toggleBookmark={toggleBookmark}
            toggleReaction={toggleReaction}
            toggleFavourite={toggleFavourite}
            toggleReblog={toggleReblog}
            onComposeReply={onComposeReply}
            onQuote={onQuote}
            onOpenProfile={onOpenProfile}
            onDelete={onDelete}
            onMute={onMute}
            onBlock={onBlock}
            onEdit={onEdit}
            onUpdate={onUpdate}
            mediaHidden={mediaHidden}
            setMediaHidden={setMediaHidden}
            translation={translation}
            showPicker={showPicker}
            setShowPicker={setShowPicker}
            accountsView={accountsView}
            setAccountsView={setAccountsView}
          />
        </div>
      </div>
      {composerFor === status.id && composerProps && (
        <div className="inline-reply-composer">
          <ReplyComposerFields status={status} {...composerProps} />
        </div>
      )}
      {node.children.length > 0 && (
        <div className={`reply-accordion${collapsedReplies?.has(node.status.id) ? '' : ' open'}`}>
          <div className="reply-accordion-inner">
            <div className="inline-replies-wrap">
              <div className="inline-replies-track" onClick={(e) => e.stopPropagation()}>
                {node.children.map((child) => (
                  <ThreadReply
                    key={child.status.id}
                    node={child}
                    depth={depth + 1}
                    instanceUrl={instanceUrl}
                    token={token}
                    onUpdate={onUpdate}
                    onOpenThread={onOpenThread}
                    onComposeReply={onComposeReply}
                    onOpenLightbox={onOpenLightbox}
                    onOpenProfile={onOpenProfile}
                    statusById={statusById}
                    onQuote={onQuote}
                    highlightedId={highlightedId}
                    focusedReplyId={focusedReplyId}
                    onHighlightParent={onHighlightParent}
                    currentAccountId={currentAccountId}
                    onDelete={onDelete}
                    onMute={onMute}
                    onBlock={onBlock}
                    onEdit={onEdit}
                    composerFor={composerFor}
                    composerProps={composerProps}
                    collapsedReplies={collapsedReplies}
                    onToggleCollapse={onToggleCollapse}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
