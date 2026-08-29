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
  Download,
  Languages,
} from 'lucide-react'
import * as mitra from '../lib/mitra'
import { PickerContext, AppSettingsContext, useEscapeKey, showToast, downloadAllMedia } from '../hooks'
import { formatRelativeTime, htmlToPlainText, processStatusContent, renderEmojiText, renderPlainText } from '../lib/render.jsx'
import { translateText } from '../lib/translate'
import {
  canonicalizeLanguage,
  canonicalLangName,
  canonicalLanguages,
  detectScriptLanguage,
} from '../lib/languages'
import { Avatar, MediaGrid, ProxiedImg } from './Media.jsx'
import { GifVideo } from './GifVideo.jsx'
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

// Browser language (BCP-47, e.g. "en-US"), cached once at module load so the
// translate control is stable across re-renders. Lazy so it never runs in
// non-browser environments (tests).
let cachedLang = null
function userLanguage() {
  if (cachedLang == null && typeof navigator !== 'undefined') {
    cachedLang = navigator.language || 'en'
  }
  return cachedLang || 'en'
}

// On-device translation state for one post. Fediverse language tags are often
// missing or wrong, so the translation *button* is always available (once the
// feature is enabled) rather than gated on a language-mismatch heuristic — the
// user decides what to translate. Translation still targets the user's browser
// language and, when the post carries a resolvable source tag, uses it; the
// model (~3 GB) is downloaded and the request runs fully client-side on first
// use — post text never leaves the device.
// Exported so unit tests can exercise the toggle behavior directly.
export function useTranslation(status) {
  // The feature is opt-in via a settings toggle (default off). Fail closed:
  // if the setting isn't explicitly enabled (or the context isn't provided,
  // e.g. in isolation tests), no toggle is offered.
  const { translationEnabled, translationProvider } = useContext(AppSettingsContext)
  const browserLang = userLanguage()
  const targetCode = canonicalizeLanguage(browserLang) || 'en'

  // phase: 'idle' | 'needs-source' | 'loading' | 'done' | 'error'
  const [phase, setPhase] = useState('idle')
  const [progress, setProgress] = useState(null) // null | { overall, file, ready }
  const [translated, setTranslated] = useState(null)
  const [error, setError] = useState(null)
  const [shown, setShown] = useState(false)
  // A user-chosen source language, set via the picker. Takes precedence over
  // the post's tag and the script guess so a wrong auto-fill can be corrected.
  const [sourceOverride, setSourceOverride] = useState(null)

  // Resolve the source language for this post: explicit user choice first,
  // then the post's language tag, then a conservative script guess. The script
  // guess / tag are only ever surfaced as a correctable choice, and when
  // nothing resolves we enter 'needs-source' and ask the user. This is a
  // canonical ISO id (`ja`) that each provider maps to its own model code.
  const sourceCode =
    sourceOverride ??
    canonicalizeLanguage(status?.language) ??
    detectScriptLanguage(htmlToPlainText(status?.content))
  const sourceLangName = canonicalLangName(sourceCode)

  // Actually run the translation for a given source code, reporting progress.
  async function runTranslate(code) {
    setPhase('loading')
    setProgress(null)
    setError(null)
    try {
      // The 4 B parameter model only runs at a usable speed through the GPU.
      // Turning on a clear WebGPU gate here is more honest than silently
      // falling back to the CPU (which would take minutes per token).
      if (typeof navigator !== 'undefined' && !navigator.gpu) {
        throw new Error(
          'On-device translation needs a WebGPU-capable browser ' +
          '(Chrome/Edge, or Firefox with webgpu enabled).'
        )
      }
      const source = htmlToPlainText(status.content)
      const result = await translateText(source, code, targetCode, setProgress, translationProvider)
      setTranslated(result)
      setPhase('done')
    } catch (err) {
      console.error(err)
      setError(String(err?.message || err))
      setPhase('error')
    }
  }

  // Kick off translation if needed, then reveal the translated view.
  async function toggle() {
    if (shown) {
      setShown(false)
      return
    }
    setShown(true)
    if (phase === 'loading') return
    if (phase === 'done') return
    if (!sourceCode) {
      setPhase('needs-source')
      return
    }
    await runTranslate(sourceCode)
  }

  // Called when the user picks a source language. Re-runs translation so a
  // wrong auto-fill (or a bad/absent tag) is corrected in place.
  function changeSource(code) {
    if (!code) return
    setSourceOverride(code)
    if (shown && code !== sourceCode) runTranslate(code)
  }

  return {
    translationEnabled,
    sourceCode,
    sourceLangName,
    shown,
    phase,
    progress,
    translated,
    error,
    toggle,
    changeSource,
  }
}

// Small action-row button that toggles a post between its original and its
// on-device translation. Active (highlighted) while the translated view is up.
function TranslateToggleButton({ active, disabled, onClick }) {
  return (
    <button
      className={`action-btn${active ? ' translated' : ''}`}
      aria-label={active ? 'Show original' : 'Translate'}
      title={active ? 'Show original post' : 'Translate this post on-device'}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      disabled={disabled}
    >
      <Languages size={15} />
    </button>
  )
}

// A compact `<select>` of the model's supported languages, used both to
// correct a wrong/absent auto-detected source and to kick off translation when
// no source could be detected. The post's tag and script guess are only ever
// surfaced through this control — never trusted silently.
function SourceLanguageSelect({ value, disabled, onChange }) {
  return (
    <select
      className="post-translation-source"
      value={value || ''}
      disabled={disabled}
      aria-label="Source language"
      title="Source language"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>Choose source language…</option>
      {canonicalLanguages().map(({ code, label }) => (
        <option key={code} value={code}>{label}</option>
      ))}
    </select>
  )
}

// The translated view shown in place of the original text: a "Translated from
// X" heading with a show-original ✕, the translated text, the progress bar
// while the model downloads/runs, an inline error, or a source-language
// picker when the post has no usable tag and no decisive script guess.
function TranslatedBody({ status, t }) {
  const { sourceCode, sourceLangName, phase, progress, translated, error, toggle, changeSource } = t

  if (phase === 'loading') {
    // A real progress bar: determinate while the weights download, then an
    // indeterminate "Translating…" bar once the model is loaded and inference
    // (which has no byte-level progress) is running.
    const overall = typeof progress?.overall === 'number' ? progress.overall : null
    const ready = progress?.ready === true
    const indeterminate = ready || overall == null
    const label = ready
      ? 'Translating…'
      : overall != null
        ? `Downloading translation model… ${Math.round(overall)}%`
        : 'Preparing translator…'
    const pct = Math.max(0, Math.min(100, overall))
    return (
      <div className="post-translation post-translation-loading">
        <span className="post-translation-label">{label}</span>
        <div
          className={`post-translation-progress${indeterminate ? ' is-indeterminate' : ''}`}
          role="progressbar"
          aria-label="Translation model progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : Math.round(pct)}
        >
          <div
            className="post-translation-progress-fill"
            style={indeterminate ? undefined : { width: `${pct}%` }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="post-translation">
      {phase === 'done' && translated && (
        <>
          <div className="post-translation-head">
            <span className="post-translation-label">
              <Languages size={13} /> Translated from {sourceLangName || 'unknown language'}
              <SourceLanguageSelect value={sourceCode} onChange={changeSource} />
            </span>
            <button
              className="post-translation-close"
              aria-label="Show original"
              title="Show original"
              onClick={(e) => { e.stopPropagation(); toggle() }}
            >
              <X size={13} />
            </button>
          </div>
          <p className="post-text post-translation-text">
            {renderPlainText(translated, status.mentions, status.emojis)}
          </p>
        </>
      )}
      {phase === 'needs-source' && (
        <div className="post-translation-head">
          <span className="post-translation-label">
            <Languages size={13} /> Couldn't detect the source language — pick one:
            <SourceLanguageSelect value={sourceCode} onChange={changeSource} />
          </span>
          <button
            className="post-translation-close"
            aria-label="Show original"
            title="Show original"
            onClick={(e) => { e.stopPropagation(); toggle() }}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {phase === 'error' && (
        <div className="banner banner-error">{error}</div>
      )}
    </div>
  )
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
  const translation = useTranslation(status)
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
                data-favourited={status.favourited ? 'true' : 'false'}
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
            {translation.translationEnabled && (
              <TranslateToggleButton
                active={translation.shown}
                disabled={translation.phase === 'loading'}
                onClick={translation.toggle}
              />
            )}
            <PostOptionsMenu
              status={status}
              instanceUrl={instanceUrl}
              token={token}
              mediaAttachments={content.attachments}
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
            <GifVideo direct className="reaction-emoji-img" src={r.url} alt={r.name} />
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
              <Avatar name={account.display_name || account.username} src={account.avatar} staticSrc={account.avatar_static} />
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
        data-reblogged={reblogged ? 'true' : 'false'}
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
        <Avatar name={rawName} src={account.avatar} staticSrc={account.avatar_static} size={16} />
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

function PostOptionsMenu({ status, instanceUrl, token, mediaAttachments, isOwn, onDelete, onMute, onBlock, onEdit, onUpdate }) {
  const [open, setOpen] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState('')
  const [dlState, setDlState] = useState('idle') // 'idle' | 'busy' | 'done' | 'error'
  const mediaCount = Array.isArray(mediaAttachments) ? mediaAttachments.length : 0
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
      showToast('Link copied')
      setOpen(false)
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

  async function handleDownloadMedia() {
    if (dlState === 'busy') return
    setDlState('busy')
    try {
      await downloadAllMedia(mediaAttachments, { instanceUrl, token })
      setDlState('done')
      showToast('Media saved')
    } catch {
      setDlState('error')
    } finally {
      setTimeout(() => setDlState('idle'), 1200)
    }
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
              Copy link
            </button>
            {mediaCount > 0 && (
              <button className="boost-dropdown-item" onClick={handleDownloadMedia} disabled={dlState === 'busy'}>
                <Download size={15} />
                {dlState === 'busy' ? 'Downloading…' : `Download media (${mediaCount})`}
              </button>
            )}
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
  const translation = useTranslation(status)
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
                data-favourited={status.favourited ? 'true' : 'false'}
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
            {translation.translationEnabled && (
              <TranslateToggleButton
                active={translation.shown}
                disabled={translation.phase === 'loading'}
                onClick={translation.toggle}
              />
            )}
            <PostOptionsMenu
              status={status}
              instanceUrl={instanceUrl}
              token={token}
              mediaAttachments={content.attachments}
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
        ? <GifVideo direct src={emojiUrl} alt={emojiName} className="inline-custom-emoji" />
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
  pendingFollowIds,
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
          <Avatar name={rawName} src={account.avatar} staticSrc={account.avatar_static} size={22} onClick={() => onOpenProfile?.(account)} />
          <span className="notif-text">
            <span className="post-name clickable" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>{name}</span> {notificationVerb(notification.type, notification)}
          </span>
          <span className="post-time">{formatRelativeTime(notification.created_at)}</span>
        </div>

        {notification.type === 'follow_request' && !responded && pendingFollowIds != null && !pendingFollowIds.has(account.id) && (
          // Request was already handled elsewhere (or earlier session) —
          // the server keeps the notification around, but there is
          // nothing left to accept or reject.
          <div className="notif-responded">
            {account.display_name || account.username} followed you
          </div>
        )}
        {notification.type === 'follow_request' && !responded && (pendingFollowIds == null || pendingFollowIds.has(account.id)) && (
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
