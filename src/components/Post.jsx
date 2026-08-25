import { memo, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  MessageCircle,
  Repeat2,
  Star,
  Bookmark,
  MoreHorizontal,
  X,
  EyeOff,
  Eye,
  UserPlus,
  AtSign,
  Bell,
  Smile,
  Link,
  Edit3,
  Pin,
  PinOff,
  Box,
} from 'lucide-react'
import * as mitra from '../lib/mitra'
import { PickerContext, useEscapeKey } from '../hooks'
import { formatRelativeTime, htmlToPlainText, processStatusContent, renderEmojiText } from '../lib/render.jsx'
import { Avatar, MediaGrid, ProxiedImg } from './Media.jsx'
import { COMMON_EMOJI } from './Emoji.jsx'
import { ReplyComposerFields } from './ReplyComposer.jsx'

// A status as returned by the timeline can itself be a boost: in that case
// `post.account` is whoever boosted it, and the actual post — content,
// author, counts, your favourite/reblog state — lives in `post.reblog`.
// Everything that isn't the "so-and-so boosted" line should read from here.
function unwrapStatus(post) {
  return post.reblog || post
}

// Only public and unlisted posts can be reposted — servers reject boosts
// of followers-only/direct/subscribers content, so don't offer the button.
export function canBoostStatus(status) {
  return ['public', 'unlisted'].includes(status?.visibility)
}

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
}) {
  const [busy, setBusy] = useState(false)
  const [mediaHidden, setMediaHidden] = useState(false)
  // null | { kind: 'favourited_by' | 'reblogged_by' } — who-did-this popover
  const [accountsView, setAccountsView] = useState(null)
  const { openPickerId, setOpenPickerId } = useContext(PickerContext)
  const showPicker = openPickerId === node.status.id
  const setShowPicker = (open) => setOpenPickerId(open ? node.status.id : null)
  const status = node.status
  const account = status.account || {}
  const rawName = account.display_name || account.username || 'Unknown'
  const name = renderEmojiText(rawName, account.emojis)
  const content = processStatusContent(status, instanceUrl)
  const parentStatus = statusById?.get(status.in_reply_to_id) || null
  // Same context line as PostRow: when the parent isn't loaded, fall back
  // to the mention matching in_reply_to_account_id. Notification previews
  // have no statusById, so this is usually the only source there.
  const replyToAccount = !parentStatus && status.in_reply_to_account_id
    ? (status.mentions || []).find((m) => m.id === status.in_reply_to_account_id)
    : null

  function handlePollUpdated(poll) {
    onUpdate({ ...status, poll })
  }

  async function toggleBookmark() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await mitra.setBookmarked(instanceUrl, token, status.id, status.bookmarked)
      onUpdate(updated)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function toggleReaction(statusId, emoji, alreadyReacted) {
    try {
      const updated = alreadyReacted
        ? await mitra.removeReaction(instanceUrl, token, statusId, emoji)
        : await mitra.addReaction(instanceUrl, token, statusId, emoji)
      onUpdate(updated)
    } catch (err) {
      console.error(err)
    }
  }

  async function toggleFavourite() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await mitra.setFavourited(instanceUrl, token, status.id, status.favourited)
      onUpdate(updated)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function toggleReblog() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await mitra.setReblogged(instanceUrl, token, status.id, status.reblogged)
      // Mitra serializes the freshly-created repost wrapper on reblog,
      // whose own `reblogged` is always false — the real flag lives on
      // the wrapped original. Unreblog returns the original directly.
      const inner = updated.reblog
        ? { ...updated.reblog, reblogged: Boolean(updated.reblog.reblogged) }
        : { ...updated, reblogged: Boolean(updated.reblogged) }
      onUpdate(inner)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        className={`reply-row${highlightedId === status.id ? ' highlighted' : ''}${focusedReplyId === status.id ? ' focused-reply' : ''}`}
        style={{ '--reply-depth': depth }}
        data-status-id={status.id}
      >
        <Avatar name={rawName} src={account.avatar} onClick={() => onOpenProfile?.(account)} />
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
          </div>
          {replyToAccount && (
            <div className="post-reply-context">
              In reply to{' '}
              <span
                className="post-reply-link clickable"
                onClick={(e) => { e.stopPropagation(); onOpenProfile?.(replyToAccount) }}
              >
                @{replyToAccount.acct || replyToAccount.username}
              </span>
            </div>
          )}
          <p className="post-text">{content.textNodes}</p>
          <QuoteCard status={status.pleroma?.quote || status.quote?.quoted_status || status.quote} instanceUrl={instanceUrl} onOpenThread={onOpenThread} />
          {status.poll && (
            <PollCard
              poll={status.poll}
              instanceUrl={instanceUrl}
              token={token}
              onUpdated={handlePollUpdated}
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
          <div className="post-actions" onClick={(e) => e.stopPropagation()}>
            <button className="action-btn" aria-label="Reply" onClick={() => onComposeReply(status)}>
              <MessageCircle size={15} />
              {!compact && status.replies_count > 0 && <span>{status.replies_count}</span>}
            </button>
            {canBoostStatus(status) && (
              <BoostDropdown
                reblogged={status.reblogged}
                reblogsCount={compact ? 0 : status.reblogs_count}
                busy={busy}
                onBoost={toggleReblog}
                onQuote={() => onQuote(status)}
                onShowReblogs={compact ? undefined : () => setAccountsView({ kind: 'reblogged_by' })}
              />
            )}
            {/* Buttons can't nest — the "who favourited" count is a sibling */}
            <div className="action-btn-group">
              <button
                className={`action-btn${status.favourited ? ' favorited' : ''}`}
                aria-label="Favorite"
                onClick={toggleFavourite}
                disabled={busy}
              >
                <Star size={15} fill={status.favourited ? 'currentColor' : 'none'} />
              </button>
              {!compact && (
                <CountButton
                  count={status.favourites_count}
                  title="Who favourited"
                  onClick={() => setAccountsView({ kind: 'favourited_by' })}
                />
              )}
            </div>
            <button
              className={`action-btn${status.bookmarked ? ' bookmarked' : ''}`}
              aria-label="Bookmark"
              onClick={toggleBookmark}
              disabled={busy}
            >
              <Bookmark size={15} fill={status.bookmarked ? 'currentColor' : 'none'} />
            </button>
            {!compact && (
              <>
                <button
                  className="action-btn"
                  aria-label="React"
                  onClick={() => setShowPicker(!showPicker)}
                >
                  <Smile size={15} />
                </button>
                {showPicker && (
                  <ReactionPicker
                    status={status}
                    instanceUrl={instanceUrl}
                    token={token}
                    onReact={toggleReaction}
                    onClose={() => setShowPicker(false)}
                  />
                )}
              </>
            )}
            {content.attachments.length > 0 && (
              <button
                className="action-btn"
                aria-label={mediaHidden ? 'Show media' : 'Hide media'}
                onClick={() => setMediaHidden((v) => !v)}
              >
                {mediaHidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            )}
            <PostOptionsMenu
              status={status}
              instanceUrl={instanceUrl}
              token={token}
              isOwn={status.account?.id === currentAccountId}
              onDelete={onDelete}
              onMute={onMute}
              onBlock={onBlock}
              onEdit={onEdit}
              onUpdate={onUpdate}
            />
            {accountsView && (
              <>
                <div className="boost-dropdown-backdrop" onClick={(e) => { e.stopPropagation(); setAccountsView(null) }} />
                <AccountsPopover
                  kind={accountsView.kind}
                  statusId={status.id}
                  instanceUrl={instanceUrl}
                  token={token}
                  onClose={() => setAccountsView(null)}
                  onOpenProfile={onOpenProfile}
                />
              </>
            )}
          </div>
        </div>
      </div>
      {composerFor === status.id && composerProps && (
        <div className="inline-reply-composer">
          <ReplyComposerFields status={status} {...composerProps} />
        </div>
      )}
      {node.children.length > 0 && (
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
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function ReactionChips({ reactions, statusId, instanceUrl, token, onReact }) {
  if (!reactions || reactions.length === 0) return null
  return (
    <div className="reaction-chips">
      {reactions.map((r) => (
        <button
          key={r.name}
          className={`reaction-chip${r.me ? ' reacted' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onReact(statusId, r.name, r.me)
          }}
        >
          {r.url ? (
            <ProxiedImg direct className="reaction-emoji-img" src={r.url} alt={r.name} />
          ) : (
            <span className="reaction-emoji-text">{r.name}</span>
          )}
          <span className="reaction-count">{r.count}</span>
        </button>
      ))}
    </div>
  )
}

function ReactionPicker({ status, instanceUrl, token, onReact, onClose }) {
  const [instanceEmoji, setInstanceEmoji] = useState([])
  useEffect(() => {
    let cancelled = false
    mitra.fetchCustomEmojis(instanceUrl).then((emojis) => {
      if (!cancelled) setInstanceEmoji(emojis || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [instanceUrl])
  const seen = new Set()
  const customEmoji = []
  ;(status.emojis || []).forEach((e) => {
    if (!seen.has(e.shortcode)) { seen.add(e.shortcode); customEmoji.push(e) }
  })
  instanceEmoji.forEach((e) => {
    if (!seen.has(e.shortcode)) { seen.add(e.shortcode); customEmoji.push(e) }
  })
  return (
    <div className="reaction-picker" onClick={(e) => e.stopPropagation()}>
      <div className="reaction-picker-section">
        {COMMON_EMOJI.map((emoji) => (
          <button key={emoji} className="reaction-picker-item" onClick={() => { onReact(status.id, emoji, false); onClose() }}>
            {emoji}
          </button>
        ))}
      </div>
      {customEmoji.length > 0 && (
        <>
          <div className="reaction-picker-divider" />
          <div className="reaction-picker-section">
            {customEmoji.map((e) => (
              <button key={e.shortcode} className="reaction-picker-item" onClick={() => { onReact(status.id, `:${e.shortcode}:`, false); onClose() }}>
                <ProxiedImg direct src={e.url} alt={e.shortcode} className="reaction-picker-custom-emoji" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Popover listing the accounts behind a favourite/boost count. Fetches
// once per open; rows open profiles via onOpenProfile.
function AccountsPopover({ kind, statusId, instanceUrl, token, onClose, onOpenProfile }) {
  const [accounts, setAccounts] = useState(null)
  const [error, setError] = useState('')
  useEscapeKey(onClose)

  const fetchPage = useCallback(() => (
    kind === 'favourited_by'
      ? mitra.fetchFavouritedBy(instanceUrl, token, statusId)
      : mitra.fetchRebloggedBy(instanceUrl, token, statusId)
  ), [kind, instanceUrl, token, statusId])

  useEffect(() => {
    let cancelled = false
    fetchPage()
      .then((list) => { if (!cancelled) setAccounts(list || []) })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load.') })
    return () => { cancelled = true }
  }, [fetchPage])

  return (
    <div className="boost-dropdown accounts-popover" onClick={(e) => e.stopPropagation()}>
      <div className="accounts-popover-heading">{kind === 'favourited_by' ? 'Favourited by' : 'Boosted by'}</div>
      {error && <div className="banner banner-error">{error}</div>}
      {!accounts && !error ? (
        <span className="poll-meta">Loading…</span>
      ) : accounts?.length === 0 ? (
        <span className="poll-meta">Nobody yet.</span>
      ) : (
        <div className="accounts-popover-list">
          {(accounts || []).map((account) => (
            <button
              type="button"
              key={account.id}
              className="search-account-row"
              onClick={() => { onClose(); onOpenProfile?.(account) }}
            >
              <Avatar name={account.display_name || account.username} src={account.avatar} />
              <div className="search-account-names">
                <span className="post-name">{account.display_name || account.username}</span>
                <span className="post-handle">@{account.acct || account.username}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Count span that doubles as a "who did this" button; hidden when the
// count is zero (or in compact mode).
function CountButton({ count, title, onClick }) {
  if (!(count > 0)) return null
  return (
    <button
      type="button"
      className="action-count-btn"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      {count}
    </button>
  )
}

function BoostDropdown({ reblogged, reblogsCount, busy, onBoost, onQuote, onShowReblogs }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEscapeKey(() => setOpen(false), open)

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="boost-dropdown-wrap" ref={ref}>
      <button
        className={`action-btn boost-trigger${reblogged ? ' boosted' : ''}`}
        aria-label="Boost or quote"
        onClick={() => setOpen(!open)}
        disabled={busy}
      >
        <Repeat2 size={15} />
      </button>
      {/* Sibling, not child: buttons can't nest. Rendered after the icon
          so the row still reads icon-then-count like every other action. */}
      {onShowReblogs && !open && (
        <CountButton count={reblogsCount} title="Who boosted" onClick={onShowReblogs} />
      )}
      {open && (
        <>
          <div className="boost-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="boost-dropdown">
            <button
              className={`boost-dropdown-item${reblogged ? ' boosted' : ''}`}
              onClick={() => { onBoost(); setOpen(false) }}
            >
              <Repeat2 size={15} />
              {reblogged ? 'Unboost' : 'Boost'}
            </button>
            <button
              className="boost-dropdown-item"
              onClick={() => { onQuote(); setOpen(false) }}
            >
              <MessageCircle size={15} />
              Quote
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function QuoteCard({ status, instanceUrl, onOpenThread }) {
  if (!status) return null
  const account = status.account || {}
  const rawName = account.display_name || account.username || 'Unknown'
  const name = renderEmojiText(rawName, account.emojis)
  const content = processStatusContent(status, instanceUrl)
  return (
    <div className="quote-card" onClick={(e) => { e.stopPropagation(); onOpenThread(status) }}>
      <div className="quote-card-meta">
        <Avatar name={rawName} src={account.avatar} size={16} />
        <span className="quote-card-name">{name}</span>
        <span className="quote-card-handle">@{account.acct || account.username}</span>
      </div>
      <p className="quote-card-text">{content.textNodes}</p>
      {content.attachments.length > 0 && content.attachments[0].type === 'image' && (
        <ProxiedImg className="quote-card-image" src={content.attachments[0].preview_url || content.attachments[0].url} alt="" />
      )}
    </div>
  )
}

export function PollCard({ poll, instanceUrl, token, onUpdated }) {
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!poll) return null

  const { id, options, expired, multiple, votes_count, voters_count, voted, own_votes, expires_at } = poll
  const showResults = expired || voted

  function toggleOption(idx) {
    if (showResults || busy) return
    if (multiple) {
      setSelected((prev) =>
        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
      )
    } else {
      setSelected([idx])
    }
  }

  async function submitVote() {
    if (selected.length === 0) return
    setBusy(true)
    setError('')
    try {
      const updated = await mitra.votePoll(instanceUrl, token, id, selected)
      onUpdated(updated)
    } catch (err) {
      setError(err.message || 'Vote failed.')
    } finally {
      setBusy(false)
    }
  }

  function timeLeft() {
    if (!expires_at || expired) return null
    const ms = new Date(expires_at) - Date.now()
    if (ms <= 0) return null
    const mins = Math.floor(ms / 60000)
    if (mins < 60) return `${mins}m left`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ${mins % 60}m left`
    const days = Math.floor(hrs / 24)
    return `${days}d left`
  }

  return (
    <div className="poll-card">
      {showResults ? (
        options.map((opt, i) => {
          const pct = votes_count > 0 ? Math.round((opt.votes_count / votes_count) * 100) : 0
          const chosen = own_votes?.includes(i)
          return (
            <div key={i} className={`poll-option${chosen ? ' chosen' : ''}`}>
              <div className="poll-option-header">
                <span className="poll-option-text">{htmlToPlainText(opt.title)}</span>
                <span className="poll-option-pct">{pct}%</span>
              </div>
              <div className="poll-option-bar">
                <div className="poll-option-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })
      ) : (
        options.map((opt, i) => (
          <label
            key={i}
            className={`poll-option-pick${selected.includes(i) ? ' selected' : ''}`}
            onClick={() => toggleOption(i)}
          >
            <span className={`poll-radio${multiple ? ' checkbox' : ''}`}>
              {selected.includes(i) && <span className="poll-radio-dot" />}
            </span>
            <span className="poll-option-text">{htmlToPlainText(opt.title)}</span>
          </label>
        ))
      )}
      {error && <div className="banner banner-error">{error}</div>}
      {!showResults && (
        <div className="poll-vote-row">
          <button
            className="pill-btn suggested"
            onClick={submitVote}
            disabled={busy || selected.length === 0}
          >
            {busy ? 'Voting…' : 'Vote'}
          </button>
        </div>
      )}
      <div className="poll-footer">
        <span className="poll-meta">
          {votes_count} vote{votes_count !== 1 ? 's' : ''}
          {voters_count != null && voters_count !== votes_count && ` · ${voters_count} voter${voters_count !== 1 ? 's' : ''}`}
          {timeLeft() && <> · {timeLeft()}</>}
          {expired && <span className="poll-expired"> · Ended</span>}
        </span>
      </div>
    </div>
  )
}

function PostOptionsMenu({ status, instanceUrl, token, isOwn, onDelete, onMute, onBlock, onEdit, onUpdate }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState('')
  // IPFS pin state: 'idle' | 'busy' | 'copied'
  const [ipfsState, setIpfsState] = useState('idle')
  const [ipfsError, setIpfsError] = useState('')
  const ref = useRef(null)
  useEscapeKey(() => setOpen(false), open)

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function copyLink() {
    const acct = status.account?.acct || status.account?.username || 'unknown'
    const url = status.url || `https://${instanceUrl}/@${acct}/${status.id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false); setOpen(false) }, 900)
    }).catch(() => {
      setOpen(false)
    })
  }

  function handleMute() {
    onMute?.(status.account?.id)
    setOpen(false)
  }

  function handleBlock() {
    onBlock?.(status.account?.id)
    setOpen(false)
  }

  function handleDelete() {
    onDelete?.(status.id)
    setOpen(false)
  }

  // Mitra reports pinned state directly on the status payload, so the
  // menu item can be data-driven. The endpoint returns the updated
  // status; propagate it so every list stays in sync.
  async function togglePinned() {
    if (pinBusy) return
    setPinBusy(true)
    setPinError('')
    try {
      const updated = await mitra.setPinned(instanceUrl, token, status.id, !status.pinned)
      onUpdate?.(updated || { ...status, pinned: !status.pinned })
      setOpen(false)
    } catch (err) {
      setPinError(err.message || 'Pin failed.')
    } finally {
      setPinBusy(false)
    }
  }

  // IPFS pinning is only offered for own public posts — the server
  // rejects everything else (403), and 418 means the instance has the
  // integration off, which surfaces as an inline error.
  const ipfsEligible = isOwn && status.visibility === 'public'

  async function handleIpfsPin() {
    if (ipfsState === 'busy') return
    setIpfsState('busy')
    setIpfsError('')
    try {
      const updated = await mitra.pinToIpfs(instanceUrl, token, status.id)
      onUpdate?.(updated || { ...status, ipfs_cid: 'pinned' })
      setOpen(false)
    } catch (err) {
      setIpfsError(err.message || 'Pin failed.')
      setIpfsState('idle')
    }
  }

  function copyIpfsCid() {
    navigator.clipboard.writeText(status.ipfs_cid).then(() => {
      setIpfsState('copied')
      setTimeout(() => { setIpfsState('idle'); setOpen(false) }, 900)
    }).catch(() => {
      setOpen(false)
    })
  }

  return (
    <div className="boost-dropdown-wrap" ref={ref}>
      <button className="action-btn" aria-label="More options" style={{ marginLeft: 'auto' }} onClick={() => setOpen(!open)}>
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <>
          <div className="boost-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="boost-dropdown">
            <button className="boost-dropdown-item" onClick={copyLink}>
              <Link size={15} />
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            {isOwn && onEdit && (
              <button className="boost-dropdown-item" onClick={() => { setOpen(false); onEdit(status) }}>
                <Edit3 size={15} />
                Edit
              </button>
            )}
            {isOwn && (
              <button className="boost-dropdown-item" onClick={togglePinned} disabled={pinBusy}>
                {status.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                {status.pinned ? 'Unpin from profile' : 'Pin to profile'}
              </button>
            )}
            {ipfsEligible && (
              status.ipfs_cid ? (
                <button className="boost-dropdown-item" onClick={copyIpfsCid}>
                  <Box size={15} />
                  {ipfsState === 'copied' ? 'CID copied!' : 'Copy IPFS CID'}
                </button>
              ) : (
                <button className="boost-dropdown-item" onClick={handleIpfsPin} disabled={ipfsState === 'busy'}>
                  <Box size={15} />
                  {ipfsState === 'busy' ? 'Pinning…' : 'Save to IPFS'}
                </button>
              )
            )}
            {ipfsError && <div className="banner banner-error">{ipfsError}</div>}
            {isOwn && (
              <button className="boost-dropdown-item destructive" onClick={handleDelete}>
                <X size={15} />
                Delete
              </button>
            )}
            {pinError && <div className="banner banner-error">{pinError}</div>}
            {!isOwn && (
              <>
                <button className="boost-dropdown-item" onClick={handleMute}>
                  <Eye size={15} />
                  Mute
                </button>
                <button className="boost-dropdown-item" onClick={handleBlock}>
                  <UserPlus size={15} />
                  Block
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export const PostRow = memo(function PostRow({ post, instanceUrl, token, onUpdate, onOpenThread, onComposeReply, onOpenLightbox, onOpenProfile, onQuote, statusById, depth, highlightedId, onHighlightParent, currentAccountId, onDelete, onMute, onBlock, onEdit, composerFor, composerProps }) {
  const [busy, setBusy] = useState(false)
  const [mediaHidden, setMediaHidden] = useState(false)
  // null | { kind: 'favourited_by' | 'reblogged_by' } — who-did-this popover
  const [accountsView, setAccountsView] = useState(null)
  const { openPickerId, setOpenPickerId } = useContext(PickerContext)
  const isBoost = Boolean(post.reblog)
  const status = unwrapStatus(post)
  const showPicker = openPickerId === status.id
  const setShowPicker = (open) => setOpenPickerId(open ? status.id : null)
  const account = status.account || {}
  const displayNameRaw = account.display_name || account.username || 'Unknown'
  const displayName = renderEmojiText(displayNameRaw, account.emojis)
  const booster = isBoost ? post.account : null
  const content = processStatusContent(status, instanceUrl)
  const parentStatus = statusById?.get(status.in_reply_to_id) || null
  const replyToAccount = !parentStatus && status.in_reply_to_account_id
    ? (status.mentions || []).find((m) => m.id === status.in_reply_to_account_id)
    : null

  function handlePollUpdated(poll) {
    const newStatus = { ...status, poll }
    onUpdate(isBoost ? { ...post, reblog: newStatus } : newStatus)
  }

  async function toggleBookmark() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await mitra.setBookmarked(instanceUrl, token, status.id, status.bookmarked)
      onUpdate(isBoost ? { ...post, reblog: updated } : updated)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function toggleReaction(statusId, emoji, alreadyReacted) {
    try {
      const updated = alreadyReacted
        ? await mitra.removeReaction(instanceUrl, token, statusId, emoji)
        : await mitra.addReaction(instanceUrl, token, statusId, emoji)
      onUpdate(isBoost ? { ...post, reblog: updated } : updated)
    } catch (err) {
      console.error(err)
    }
  }

  async function toggleFavourite() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await mitra.setFavourited(instanceUrl, token, status.id, status.favourited)
      onUpdate(isBoost ? { ...post, reblog: updated } : updated)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function toggleReblog() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await mitra.setReblogged(instanceUrl, token, status.id, status.reblogged)
      // Mitra serializes the freshly-created repost wrapper on reblog,
      // whose own `reblogged` is always false — the real flag lives on
      // the wrapped original. Unreblog returns the original directly.
      const inner = updated.reblog
        ? { ...updated.reblog, reblogged: Boolean(updated.reblog.reblogged) }
        : { ...updated, reblogged: Boolean(updated.reblogged) }
      onUpdate(isBoost ? { ...post, reblog: inner } : inner)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`post-row${highlightedId === status.id ? ' highlighted' : ''}`} style={depth != null ? { '--reply-depth': depth } : undefined}>
      {booster && (
        <div className="repost-indicator">
          <Repeat2 size={13} />
          {booster.display_name || booster.username} boosted
        </div>
      )}
      <div className="post-row-main">
        <Avatar name={displayNameRaw} src={account.avatar} onClick={() => onOpenProfile?.(account)} />
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
          </div>
          {replyToAccount && (
            <div className="post-reply-context">
              In reply to{' '}
              <span className="post-reply-link" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(replyToAccount) }}>
                @{replyToAccount.acct || replyToAccount.username}
              </span>
            </div>
          )}
          <p className="post-text">{content.textNodes}</p>
          <QuoteCard status={status.pleroma?.quote || status.quote?.quoted_status || status.quote} instanceUrl={instanceUrl} onOpenThread={onOpenThread} />
          {status.poll && (
            <PollCard
              poll={status.poll}
              instanceUrl={instanceUrl}
              token={token}
              onUpdated={handlePollUpdated}
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
          <div className="post-actions" onClick={(e) => e.stopPropagation()}>
            <button className="action-btn" aria-label="Reply" onClick={() => onComposeReply(status)}>
              <MessageCircle size={15} />
              {status.replies_count > 0 && <span>{status.replies_count}</span>}
            </button>
            {canBoostStatus(status) && (
              <BoostDropdown
                reblogged={status.reblogged}
                reblogsCount={status.reblogs_count}
                busy={busy}
                onBoost={toggleReblog}
                onQuote={() => onQuote(status)}
                onShowReblogs={() => setAccountsView({ kind: 'reblogged_by' })}
              />
            )}
            {/* Buttons can't nest — the "who favourited" count is a sibling */}
            <div className="action-btn-group">
              <button
                className={`action-btn${status.favourited ? ' favorited' : ''}`}
                aria-label="Favorite"
                onClick={toggleFavourite}
                disabled={busy}
              >
                <Star size={15} fill={status.favourited ? 'currentColor' : 'none'} />
              </button>
              <CountButton
                count={status.favourites_count}
                title="Who favourited"
                onClick={() => setAccountsView({ kind: 'favourited_by' })}
              />
            </div>
            <button
              className={`action-btn${status.bookmarked ? ' bookmarked' : ''}`}
              aria-label="Bookmark"
              onClick={toggleBookmark}
              disabled={busy}
            >
              <Bookmark size={15} fill={status.bookmarked ? 'currentColor' : 'none'} />
            </button>
            <button
              className="action-btn"
              aria-label="React"
              onClick={() => setShowPicker(!showPicker)}
            >
              <Smile size={15} />
            </button>
            {showPicker && (
              <ReactionPicker
                status={status}
                instanceUrl={instanceUrl}
                token={token}
                onReact={toggleReaction}
                onClose={() => setShowPicker(false)}
              />
            )}
            {content.attachments.length > 0 && (
              <button
                className="action-btn"
                aria-label={mediaHidden ? 'Show media' : 'Hide media'}
                onClick={() => setMediaHidden((v) => !v)}
              >
                {mediaHidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            )}
            <PostOptionsMenu
              status={status}
              instanceUrl={instanceUrl}
              token={token}
              isOwn={status.account?.id === currentAccountId}
              onDelete={onDelete}
              onMute={onMute}
              onBlock={onBlock}
              onEdit={onEdit}
              onUpdate={onUpdate}
            />
            {accountsView && (
              <>
                <div className="boost-dropdown-backdrop" onClick={(e) => { e.stopPropagation(); setAccountsView(null) }} />
                <AccountsPopover
                  kind={accountsView.kind}
                  statusId={status.id}
                  instanceUrl={instanceUrl}
                  token={token}
                  onClose={() => setAccountsView(null)}
                  onOpenProfile={onOpenProfile}
                />
              </>
            )}
          </div>
        </div>
      </div>
      {composerFor === status.id && composerProps && (
        <div className="inline-reply-composer">
          <ReplyComposerFields status={status} {...composerProps} />
        </div>
      )}
    </div>
  )
})

function notificationVerb(type, notification) {
  switch (type) {
    case 'follow':
      return 'followed you'
    case 'follow_request':
      return 'requested to follow you'
    case 'reblog':
      return 'boosted your post'
    case 'favourite':
      return 'favourited your post'
    case 'mention':
      return 'mentioned you'
    case 'poll':
      return "a poll you're in has ended"
    case 'status':
      return 'posted'
    case 'update':
      return 'edited a post'
    case 'quote':
      return 'quoted your post'
    case 'pleroma:emoji_reaction': {
      const emojiUrl = notification?.emoji_url
      const emojiName = notification?.emoji || notification?.reaction?.content || '🧩'
      const emoji = emojiUrl
        ? <ProxiedImg direct src={emojiUrl} alt={emojiName} className="inline-custom-emoji" />
        : String(emojiName).startsWith(':')
          ? <ProxiedImg alt={emojiName} className="inline-custom-emoji" fallbackText={String(emojiName).replaceAll(':', '')} />
          : emojiName
      return <>reacted with {emoji} to your post</>
    }
    default:
      return type.replace(/_/g, ' ')
  }
}

function notificationIcon(type) {
  switch (type) {
    case 'follow':
    case 'follow_request':
      return UserPlus
    case 'reblog':
      return Repeat2
    case 'favourite':
      return Star
    case 'mention':
      return AtSign
    case 'quote':
      return MessageCircle
    default:
      return Bell
  }
}

export const NotificationRow = memo(function NotificationRow({
  notification,
  instanceUrl,
  token,
  onUpdateStatus,
  onOpenThread,
  onComposeReply,
  onOpenLightbox,
  onOpenProfile,
  onRespondFollowRequest,
  statusById,
  onQuote,
  currentAccountId,
  onDelete,
  onEdit,
  onMute,
  onBlock,
}) {
  const account = notification.account || {}
  const rawName = account.display_name || account.username || 'Unknown'
  const name = renderEmojiText(rawName, account.emojis)
  const Icon = notificationIcon(notification.type)
  const [responding, setResponding] = useState(false)
  const [responded, setResponded] = useState(null)

  async function respond(action) {
    if (responding) return
    setResponding(true)
    try {
      await onRespondFollowRequest(account.id, action)
      setResponded(action)
    } catch (err) {
      console.error(err)
    } finally {
      setResponding(false)
    }
  }

  return (
    <div className="notif-row">
      <div className="notif-icon">
        <Icon size={14} />
      </div>
      <div className="notif-body">
        <div className="notif-header">
          <Avatar name={rawName} src={account.avatar} size={22} onClick={() => onOpenProfile?.(account)} />
          <span className="notif-text">
            <span className="post-name clickable" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>{name}</span> {notificationVerb(notification.type, notification)}
          </span>
          <span className="post-time">{formatRelativeTime(notification.created_at)}</span>
        </div>

        {notification.type === 'follow_request' && !responded && (
          <div className="notif-actions">
            <button
              className="pill-btn suggested"
              disabled={responding}
              onClick={() => respond('authorize')}
              type="button"
            >
              Accept
            </button>
            <button
              className="pill-btn"
              disabled={responding}
              onClick={() => respond('reject')}
              type="button"
            >
              Reject
            </button>
          </div>
        )}
        {responded && (
          <div className="notif-responded">
            {responded === 'authorize' ? 'Accepted.' : 'Rejected.'}
          </div>
        )}

        {notification.status && (
          <div className="notif-status-preview">
            <ThreadReply
              node={{ status: notification.status, children: [] }}
              instanceUrl={instanceUrl}
              token={token}
              onUpdate={onUpdateStatus}
              onOpenThread={onOpenThread}
              onComposeReply={onComposeReply}
              onOpenLightbox={onOpenLightbox}
              onOpenProfile={onOpenProfile}
              statusById={statusById}
              onQuote={onQuote}
              compact
              currentAccountId={currentAccountId}
              onDelete={onDelete}
              onMute={onMute}
              onBlock={onBlock}
              onEdit={onEdit}
            />
          </div>
        )}
      </div>
    </div>
  )
})
