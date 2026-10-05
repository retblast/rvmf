// Timeline rows. PostRow stays here; the heavyweight shared internals
// live in postCore.jsx and ThreadReply/NotificationRow in their own
// files. The re-exports below keep the historical import surface
// (`import { PostRow, ThreadReply, QuoteCard, useTranslation } from
// './Post.jsx'`) stable for the dozen consumer files.
import { memo, useCallback, useContext, useState } from 'react'
import { Repeat2, ChevronRight } from 'lucide-react'
import { PickerContext, GhostContext, useMaskIdentity, useMentionMaskId } from '../hooks'
import { formatRelativeTime, processStatusContentForDisplay, renderEmojiText } from '../lib/render.jsx'
import { Avatar, MediaGrid } from './Media.jsx'
import { ReplyComposerFields } from './ReplyComposer.jsx'
import {
  unwrapStatus, buildReplyMentions, ReplyContextLine, PostTitle, ContentWarning, useCwReveal,
  useTranslation, TranslatedBody, usePostActions, PostActions, ReactionChips, QuoteCard, PollCard,
} from './postCore.jsx'

export { canBoostStatus, useTranslation } from './postCore.jsx'
export { QuoteCard } from './postCore.jsx'
export { ThreadReply } from './ThreadReply.jsx'
export { NotificationRow } from './NotificationRow.jsx'
export const PostRow = memo(function PostRow({ post, instanceUrl, token, onUpdate, onOpenThread, onComposeReply, onOpenLightbox, onOpenProfile, onQuote, depth, highlightedId, currentAccountId, onDelete, onMute, onBlock, onEdit, composerFor, composerProps }) {
  const [mediaHidden, setMediaHidden] = useState(false)
  // null | { kind: 'favourited_by' | 'reblogged_by' } — who-did-this popover
  const [accountsView, setAccountsView] = useState(null)
  const { openPickerId, setOpenPickerId } = useContext(PickerContext)
  const mask = useMaskIdentity()
  const mentionMaskId = useMentionMaskId()
  const isBoost = Boolean(post.reblog)
  const status = unwrapStatus(post)
  const showPicker = openPickerId === status.id
  const setShowPicker = (open) => setOpenPickerId(open ? status.id : null)
  const account = mask(status.account || {})
  const displayNameRaw = account.display_name || account.username || 'Unknown'
  const displayName = renderEmojiText(displayNameRaw, account.emojis)
  const booster = isBoost ? mask(post.account) : null
  const content = processStatusContentForDisplay(status, instanceUrl, mentionMaskId)
  const translation = useTranslation(status)
  const [cwRevealed, toggleCwRevealed] = useCwReveal(status.id)
  // Build the sorted mention list: reply target first, then other body mentions.
  const replyMentions = buildReplyMentions(status)

  function handlePollUpdated(poll) {
    const newStatus = { ...status, poll }
    onUpdate(isBoost ? { ...post, reblog: newStatus } : newStatus)
  }

  // Ghost context for thread panel ghost placeholders
  const { ghostStatusId, inPanel } = useContext(GhostContext)

  // Ghost is a pure derivation: this row is a placeholder when the
  // thread panel is open for this post and the row is outside the panel.
  const isGhost = ghostStatusId === status.id && !inPanel

  const wrapUpdate = useCallback((updated) => {
    onUpdate(isBoost ? { ...post, reblog: updated } : updated)
  }, [onUpdate, isBoost, post])

  const { busy, toggleBookmark, toggleReaction, toggleFavourite, toggleReblog } =
    usePostActions({ status, instanceUrl, token, onUpdate: wrapUpdate })

  // Everything a CW collapses: body text (or its translation), quote,
  // poll, and media. Rendered bare when there's no warning; wrapped in
  // the ContentWarning banner when there is. MediaGrid's cwRevealed
  // consumes the media warning in the same reveal click.
  const gatedContent = (<>
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
      cwRevealed={cwRevealed}
    />
  </>)

  const postContent = isGhost ? (
    <div className="post-row-main">
      <Avatar name={displayNameRaw} src={account.avatar} staticSrc={account.avatar_static} />
      <span className="ghost-label">
        Viewing in thread <ChevronRight size={12} />
      </span>
    </div>
  ) : (
    <>
      {booster && (
        <div className="repost-indicator">
          <Repeat2 size={13} />
          {booster.display_name || booster.username} boosted
        </div>
      )}
      <div className="post-row-main">
        <Avatar name={displayNameRaw} src={account.avatar} staticSrc={account.avatar_static} onClick={() => onOpenProfile?.(account)} />
        <div
          className="post-body"
          onClick={(e) => {
            e.stopPropagation()
            onOpenThread(status)
          }}
        >
          <div className="post-meta">
            <span className="post-name" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>{displayName}</span>
            <span className="post-handle" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>@{account.acct || account.username}</span>
            <span className="post-time">{formatRelativeTime(status.created_at)}</span>
            {status.edited_at && (
              <span className="post-edited" title={`Edited ${formatRelativeTime(status.edited_at)}`}>
                (edited)
              </span>
            )}
          </div>
          <ReplyContextLine mentions={replyMentions} onOpenProfile={onOpenProfile} />
          <PostTitle status={status} />
          {content.hasCw
            ? (
              <ContentWarning spoilerText={content.spoilerText} revealed={cwRevealed} onToggle={toggleCwRevealed}>
                {gatedContent}
              </ContentWarning>
              )
            : gatedContent}
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
            compact={false}
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
    </>
  )

  return (
    <div
      className={`post-row${highlightedId === status.id ? ' highlighted' : ''}${isGhost ? ' ghost' : ''}`}
      style={depth != null ? { '--reply-depth': depth } : undefined}
      data-status-id={status.id}
    >
      {postContent}
    </div>
  )
})
