import { useContext, useEffect, useRef, useState } from 'react'
import {
  X,
  Paperclip,
  Eye,
  Smile,
  ImagePlus,
  BarChart2,
  FileText,
  Heading1,
} from 'lucide-react'
import * as mitra from '../lib/mitra'
import { processStatusContent, renderEmojiText } from '../lib/render.jsx'
import { QuoteCard } from './Post.jsx'
import { ProxiedImg } from './Media.jsx'
import { AppSettingsContext } from '../hooks'
import { insertAtCaret,
  useEmojiAutocomplete,
  EmojiDropdown,
  EmojiPicker,
} from './Emoji.jsx'
import { useMentionAutocomplete, MentionDropdown } from './Mention.jsx'

// Manages a compose dialog's attached files: upload starts the moment a
// file is picked (not at submit time), each tracked independently so one
// slow/failed upload doesn't block the others. `mediaIds` only includes
// ones that finished successfully — submit should wait for `isUploading`
// to clear before posting.
export function useMediaUploads(instanceUrl, token) {
  const [uploads, setUploads] = useState([])
  // Mirror of the latest typed alt text per upload key, readable from
  // async callbacks without state-peeking races.
  const descriptionsRef = useRef({})
  // Live mirror of `uploads` for the unmount cleanup below. The effect has
  // an empty deps array, so it captures `uploads` exactly once — the initial
  // [] — which would make the cleanup a no-op and leak one object URL per
  // attached file every time the dialog closes. Reading through the ref
  // guarantees the cleanup revokes whatever is actually attached.
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  useEffect(() => {
    return () => {
      uploadsRef.current.forEach((u) => URL.revokeObjectURL(u.previewUrl))
    }
  }, [])

  function addFiles(fileList) {
    const remaining = Math.max(0, 4 - uploads.length)
    Array.from(fileList)
      .slice(0, remaining)
      .forEach((file) => {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const previewUrl = URL.createObjectURL(file)
        setUploads((prev) => [
          ...prev,
          { key, file, previewUrl, description: '', mediaId: null, uploading: true, error: '' },
        ])
        mitra
          .uploadMedia(instanceUrl, token, file)
          .then((attachment) => {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === key ? { ...u, uploading: false, mediaId: attachment.id } : u
              )
            )
            // Alt text typed while the upload was still in flight never
            // got a mediaId to target — push it up now.
            const pending = descriptionsRef.current[key]
            if (pending && instanceUrl && token) {
              mitra.updateMediaDescription(instanceUrl, token, attachment.id, pending)
                .catch(() => {})
            }
          })
          .catch((err) => {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === key
                  ? { ...u, uploading: false, error: err.message || 'Upload failed.' }
                  : u
              )
            )
          })
      })
  }

  // Local state updates as the user types; the server copy is synced on
  // blur (commitDescription below sends only when it has a mediaId).
  function editDescription(key, description) {
    descriptionsRef.current[key] = description
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, description } : u)))
  }

  // Called on blur with the input's final value. No dirty-checking
  // against state here: onChange already synced u.description before
  // blur fires, so comparing would always be equal and never send.
  function commitDescription(key, description) {
    if (!instanceUrl || !token) return
    const target = uploads.find((u) => u.key === key)
    if (!target?.mediaId) return
    mitra.updateMediaDescription(instanceUrl, token, target.mediaId, description)
      .then(() => {
        descriptionsRef.current[key] = description
      })
      .catch(() => {})
  }

  function removeUpload(key) {
    delete descriptionsRef.current[key]
    setUploads((prev) => {
      const target = prev.find((u) => u.key === key)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((u) => u.key !== key)
    })
  }

  const mediaIds = uploads.filter((u) => u.mediaId).map((u) => u.mediaId)
  const isUploading = uploads.some((u) => u.uploading)

  return { uploads, addFiles, editDescription, commitDescription, removeUpload, mediaIds, isUploading }
}

export function MediaUploadStrip({ uploads, onRemove, onEditDescription, onCommitDescription }) {
  if (uploads.length === 0) return null
  return (
    <div className="upload-strip">
      {uploads.map((u) => (
        <div className="upload-thumb" key={u.key}>
          <div className="upload-thumb-media">
            {u.file.type.startsWith('image/') ? (
              <img src={u.previewUrl} alt="" />
            ) : u.file.type.startsWith('video/') ? (
              <video src={u.previewUrl} muted />
            ) : (
              <div className="upload-thumb-generic">
                <Paperclip size={16} />
              </div>
            )}
            {u.uploading && <div className="upload-thumb-status">Uploading…</div>}
            {u.error && <div className="upload-thumb-status error">Failed</div>}
            <button
              type="button"
              className="upload-thumb-remove"
              onClick={() => onRemove(u.key)}
              aria-label="Remove attachment"
            >
              <X size={12} />
            </button>
          </div>
          <input
            type="text"
            className="upload-thumb-alt"
            placeholder="Describe…"
            value={u.description}
            onChange={(e) => onEditDescription?.(u.key, e.target.value)}
            onBlur={(e) => onCommitDescription?.(u.key, e.target.value)}
            aria-label="Media description"
          />
        </div>
      ))}
    </div>
  )
}

export function visibilityLabel(v) {
  switch (v) {
    case 'public':
      return 'Public'
    case 'unlisted':
      return 'Unlisted'
    case 'private':
      return 'Followers only'
    case 'direct':
      return 'Direct message'
    case 'subscribers':
      return 'Subscribers only'
    case 'conversation':
      return 'Conversation'
    default:
      return v
  }
}

const VISIBILITY_OPTIONS = ['public', 'unlisted', 'private', 'subscribers', 'direct']

// The visibilities Mitra will actually accept for a *reply* to a parent of
// `parentVisibility` — mirrors the server's `Visibility::can_reply_with`.
// Replies may not be raised above the parent; `conversation` (visible to the
// conversation's participants) and `direct` are the two open options for the
// common case, and a direct-message parent can only be replied to with
// `direct`. `isSameAuthor` matters only for followers-only parents, which the
// author may reply to a step wider. (`unlisted`/`public` share Mitra's Public
// enum, so a public post allows up to public/followers/direct replies.)
export function replyVisibilityOptions(parentVisibility, isSameAuthor = false) {
  switch (parentVisibility) {
    case 'direct':
      return ['direct']
    case 'conversation':
    case 'subscribers':
    case 'group':
      return ['conversation', 'direct']
    case 'private':
      return isSameAuthor ? ['conversation', 'private', 'direct'] : ['conversation', 'direct']
    case 'unlisted':
    case 'public':
    default:
      return ['public', 'unlisted', 'private', 'direct']
  }
}

// Sensible starting visibility for a reply: DM stays direct (the only valid
// value), conversation-style/limited parents default to `conversation` (what
// mitra-web picks), and public/unlisted replies inherit the parent.
export function defaultReplyVisibility(parentVisibility) {
  switch (parentVisibility) {
    case 'direct':
      return 'direct'
    case 'conversation':
    case 'subscribers':
    case 'group':
    case 'private':
      return 'conversation'
    case 'unlisted':
      return 'unlisted'
    default:
      return 'public'
  }
}

// Renders the visibility options, plus whatever non-standard value is
// currently set (e.g. Mitra's 'conversation') so it displays instead of
// leaving the select blank. An `options` list overrides the full standard
// set — used when replying, where only the parent's valid reply visibilities
// are offered.
export function VisibilitySelect({ value, onChange, locked = false, options: optionList }) {
  const base = optionList || VISIBILITY_OPTIONS
  const options = base.includes(value) ? base : [value, ...base]
  return (
    <select
      className="compose-visibility-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={locked}
      aria-label={locked ? 'Visibility (locked by the conversation)' : 'Visibility'}
      title={locked ? 'Conversation replies stay inside the conversation' : undefined}
    >
      {options.map((v) => (
        <option key={v} value={v}>{visibilityLabel(v)}</option>
      ))}
    </select>
  )
}

const POST_LANGUAGES = [
  ['', 'Language…'],
  ['en', 'English'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'],
  ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
]

export function LanguageSelect({ value, onChange }) {
  return (
    <select
      className="compose-visibility-select"
      aria-label="Post language"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {POST_LANGUAGES.map(([code, label]) => (
        <option key={code || 'none'} value={code}>{label}</option>
      ))}
    </select>
  )
}

// Debounced server-side rendering of composer text (markdown → HTML via
// /statuses/preview), then through the same safe rich-text pipeline post
// bodies use — never raw HTML injection.
export function useStatusPreview(enabled, text, instanceUrl, token) {
  const [state, setState] = useState({ nodes: null, error: '' })

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      mitra.previewStatus(instanceUrl, token, text)
        .then((out) => {
          if (cancelled) return
          setState({
            nodes: processStatusContent({ content: out.content || '' }, instanceUrl).textNodes,
            error: '',
          })
        })
        .catch((err) => {
          if (!cancelled) setState({ nodes: null, error: err.message || 'Preview failed.' })
        })
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [enabled, text, instanceUrl, token])

  return state
}

export function StatusPreviewPane({ nodes, error }) {
  if (error) return <div className="banner banner-error">{error}</div>
  if (!nodes) {
    return <div className="compose-preview compose-preview-empty">Rendering preview…</div>
  }
  return (
    <div className="compose-preview">
      <div className="compose-preview-context">Preview</div>
      <p className="post-text">{nodes}</p>
    </div>
  )
}

export function CharCounter({ current, max }) {
  const remaining = max - current
  if (current === 0) return null
  const cls = remaining < 0 ? 'over' : remaining < 50 ? 'low' : ''
  return <span className={`char-counter ${cls}`}>{remaining}</span>
}

// Thumbnail strip of the parent post's media for composer previews.
// Deliberately not the full MediaGrid: no lightbox wiring down here, and
// sensitive media stays blurred until clicked (per-preview, local state).
export function ParentPreviewMedia({ status, instanceUrl }) {
  const [revealed, setRevealed] = useState(false)
  if (!status) return null
  const { attachments, sensitive } = processStatusContent(status, instanceUrl)
  const images = attachments.filter((a) => a.type === 'image').slice(0, 4)
  const otherCount = attachments.length - images.length
  if (images.length === 0 && otherCount === 0) return null
  const blurred = sensitive && !revealed
  return (
    <div
      className={`parent-preview-media${blurred ? ' blurred' : ''}`}
      onClick={blurred ? (e) => { e.stopPropagation(); setRevealed(true) } : undefined}
      role={blurred ? 'button' : undefined}
    >
      {blurred ? (
        <span className="parent-preview-cw">{spoilerTextOf(status)} — click to view</span>
      ) : (
        <>
          {images.map((att) => (
            <ProxiedImg
              key={att.id}
              className="parent-preview-thumb"
              src={att.preview_url || att.url}
              alt={att.description || ''}
            />
          ))}
          {otherCount > 0 && (
            <span className="parent-preview-more">+{otherCount} 📎</span>
          )}
        </>
      )}
    </div>
  )
}

function spoilerTextOf(status) {
  return status.spoiler_text || 'Sensitive content'
}

// Edit an existing post's text. Loads the raw source (the rendered
// content is HTML and mustn't be round-tripped), then PUTs it back.
// Mitra returns the updated status, which onSaved propagates into
// whatever list the post lives in.
export function EditDialog({ status, instanceUrl, token, onClose, onSaved }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef(null)
  const { query: acQuery, suggestions: acSuggestions, selectedIndex: acIndex, handleKeyDown: acKeyDown } = useEmojiAutocomplete(text, setText, textareaRef, [])
  const mn = useMentionAutocomplete(text, setText, textareaRef, instanceUrl, token)

  useEffect(() => {
    let cancelled = false
    mitra.fetchStatusSource(instanceUrl, token, status.id)
      .then((source) => {
        if (!cancelled) setText(source.text || '')
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load the post source.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [status.id])

  async function save() {
    if (!text.trim()) {
      setError('Post can\u2019t be empty.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const updated = await mitra.editStatus(instanceUrl, token, status.id, text.trim())
      onSaved(updated)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Edit post</span>
          <button className="icon-btn" onClick={onClose} aria-label="Cancel">
            <X size={16} />
          </button>
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <div className="compose-textarea-wrap">
            <textarea
              ref={textareaRef}
              className="compose-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (acKeyDown(e)) return
                if (mn.handleKeyDown(e)) return
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  save()
                }
              }}
              rows={6}
              autoFocus
            />
            <EmojiDropdown query={acQuery} suggestions={acSuggestions} selectedIndex={acIndex} onSelect={(s) => {
              const insert = s.type === 'custom' ? `:${s.name}:` : s.char
              insertAtCaret(text, setText, textareaRef, insert)
            }} />
            <MentionDropdown query={mn.query} suggestions={mn.suggestions} selectedIndex={mn.selectedIndex} onSelect={(i) => mn.acceptSelection(i)} />
          </div>
        )}
        <div className="dialog-actions">
          <div style={{ flex: 1 }} />
          <button className="pill-btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="pill-btn suggested"
            onClick={save}
            disabled={busy || loading}
            type="button"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

const POLL_DURATIONS = [
  ['30 minutes', 1800],
  ['1 hour', 3600],
  ['6 hours', 21600],
  ['1 day', 86400],
  ['3 days', 259200],
  ['7 days', 604800],
]
const POLL_MAX_OPTIONS = 8

// Draft state for the poll being composed. `params` is undefined while
// disabled or invalid, so submit handlers can pass it straight through.
export function usePollDraft() {
  const [enabled, setEnabled] = useState(false)
  const [options, setOptions] = useState(['', ''])
  const [expiresIn, setExpiresIn] = useState(86400)
  const [multiple, setMultiple] = useState(false)

  function setOption(i, value) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)))
  }
  function addOption() {
    setOptions((prev) => (prev.length >= POLL_MAX_OPTIONS ? prev : [...prev, '']))
  }
  function removeOption(i) {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)))
  }
  function reset() {
    setEnabled(false)
    setOptions(['', ''])
    setExpiresIn(86400)
    setMultiple(false)
  }

  const trimmedOptions = options.map((o) => o.trim()).filter(Boolean)
  const params = enabled
    ? { options: trimmedOptions, expires_in: expiresIn, multiple }
    : undefined

  return {
    enabled,
    setEnabled,
    options,
    setOption,
    addOption,
    removeOption,
    expiresIn,
    setExpiresIn,
    multiple,
    setMultiple,
    reset,
    params,
    valid: !enabled || trimmedOptions.length >= 2,
  }
}

export function PollEditorFields({ poll }) {
  return (
    <div className="poll-editor">
      {poll.options.map((opt, i) => (
        <div className="poll-editor-row" key={i}>
          <input
            className="poll-editor-input"
            type="text"
            value={opt}
            placeholder={`Option ${i + 1}`}
            maxLength={200}
            onChange={(e) => poll.setOption(i, e.target.value)}
          />
          {poll.options.length > 2 && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Remove option"
              onClick={() => poll.removeOption(i)}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      <div className="poll-editor-controls">
        {poll.options.length < POLL_MAX_OPTIONS && (
          <button type="button" className="pill-btn" onClick={poll.addOption}>
            Add option
          </button>
        )}
        <select
          className="compose-visibility-select"
          value={poll.expiresIn}
          onChange={(e) => poll.setExpiresIn(Number(e.target.value))}
          aria-label="Poll duration"
        >
          {POLL_DURATIONS.map(([label, secs]) => (
            <option key={secs} value={secs}>{label}</option>
          ))}
        </select>
        <label className="poll-editor-multiple">
          <input
            type="checkbox"
            checked={poll.multiple}
            onChange={(e) => poll.setMultiple(e.target.checked)}
          />
          Multiple choices
        </label>
      </div>
    </div>
  )
}

export function ComposeDialog({ instanceUrl, token, onClose, onPosted, quoteStatus, replyToStatus, maxCharacters = 500, groupId = null, groupName = null, currentAccountId }) {
  const { defaultVisibility } = useContext(AppSettingsContext)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Replies may not be raised above the parent — only the visibilities the
  // server accepts for a reply are offered, starting at the sensible default.
  // Fresh posts use the server-configured default visibility.
  const replyOptions = replyToStatus
    ? replyVisibilityOptions(replyToStatus.visibility, currentAccountId && replyToStatus.account?.id === currentAccountId)
    : undefined
  const [visibility, setVisibility] = useState(
    replyToStatus ? defaultReplyVisibility(replyToStatus.visibility) : (defaultVisibility || 'public')
  )
  const [spoilerText, setSpoilerText] = useState('')
  const [showCW, setShowCW] = useState(false)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const [customEmojis, setCustomEmojis] = useState([])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  // Optional title (toggled), language tag, and markdown preview pane.
  const [showTitle, setShowTitle] = useState(false)
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const { uploads, addFiles, editDescription, commitDescription, removeUpload, mediaIds, isUploading } = useMediaUploads(
    instanceUrl,
    token
  )
  const poll = usePollDraft()
  // One key per draft: retries of a timed-out submit dedupe server-side.
  const draftKeyRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `draft-${Date.now()}-${Math.random()}`
  )
  const { query: acQuery, suggestions: acSuggestions, selectedIndex: acIndex, handleKeyDown: acKeyDown } = useEmojiAutocomplete(text, setText, textareaRef, customEmojis)
  const mn = useMentionAutocomplete(text, setText, textareaRef, instanceUrl, token)
  const preview = useStatusPreview(showPreview, text, instanceUrl, token)

  useEffect(() => {
    mitra.fetchCustomEmojis(instanceUrl).then((emojis) => setCustomEmojis(emojis || [])).catch(() => {})
  }, [instanceUrl])

  // Polls and media attachments are mutually exclusive
  useEffect(() => {
    if (uploads.length > 0 && poll.enabled) poll.setEnabled(false)
    if (poll.enabled && mediaIds.length > 0) removeUpload(mediaIds[0])
  }, [uploads.length, poll.enabled])

  async function submit() {
    if (!text.trim() && mediaIds.length === 0 && !quoteStatus && !poll.enabled) {
      setError('Write something or attach a file first.')
      return
    }
    if (text.length > maxCharacters) {
      setError(`Post is ${text.length - maxCharacters} character${text.length - maxCharacters !== 1 ? 's' : ''} over the limit.`)
      return
    }
    if (isUploading) {
      setError('Still uploading — hang on a sec.')
      return
    }
    if (poll.enabled && !poll.valid) {
      setError('A poll needs at least two options.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const status = await mitra.postStatus(instanceUrl, token, text.trim(), {
        inReplyToId: replyToStatus?.id,
        mediaIds,
        visibility,
        quoteId: quoteStatus?.id,
        spoilerText: showCW ? spoilerText : undefined,
        poll: poll.params,
        idempotencyKey: draftKeyRef.current,
        title: showTitle && title.trim() ? title.trim() : undefined,
        language: language || undefined,
        groupId: groupId || undefined,
      })
      onPosted(status)
      onClose()
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">New post</span>
          <button className="icon-btn" onClick={onClose} aria-label="Cancel">
            <X size={16} />
          </button>
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        {groupId && groupName && (
          <div className="compose-reply-context">Posting to {groupName}</div>
        )}
        {showTitle && (
          <input
            className="compose-title-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title…"
            maxLength={200}
          />
        )}
        {showCW && (
          <input
            className="compose-cw-input"
            type="text"
            value={spoilerText}
            onChange={(e) => setSpoilerText(e.target.value)}
            placeholder="Content warning…"
            autoFocus
          />
        )}
        <div className="compose-textarea-wrap">
          <textarea
            ref={textareaRef}
            className="compose-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (acKeyDown(e)) return
              if (mn.handleKeyDown(e)) return
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items || [])
              const imageFiles = items
                .filter((item) => item.type.startsWith('image/'))
                .map((item) => item.getAsFile())
                .filter(Boolean)
              if (imageFiles.length > 0) {
                e.preventDefault()
                addFiles(imageFiles)
              }
            }}
            placeholder="What's on your mind?"
            rows={5}
            autoFocus
          />
          <EmojiDropdown query={acQuery} suggestions={acSuggestions} selectedIndex={acIndex} onSelect={(s) => {
            const insert = s.type === 'custom' ? `:${s.name}:` : s.char
            insertAtCaret(text, setText, textareaRef, insert)
          }} />
          <MentionDropdown query={mn.query} suggestions={mn.suggestions} selectedIndex={mn.selectedIndex} onSelect={(i) => mn.acceptSelection(i)} />
          <CharCounter current={text.length} max={maxCharacters} />
        </div>
        {showPreview && (
          <StatusPreviewPane nodes={preview.nodes} error={preview.error} />
        )}
        {replyToStatus && (
          <div className="thread-panel-preview compose-reply-preview">
            <div className="compose-reply-context">Replying to</div>
            <div className="post-meta">
              <span className="post-name">{renderEmojiText(replyToStatus.account?.display_name || replyToStatus.account?.username || 'Unknown', replyToStatus.account?.emojis)}</span>
              <span className="post-handle">@{replyToStatus.account?.acct || replyToStatus.account?.username}</span>
            </div>
            <p className="post-text">{processStatusContent(replyToStatus, instanceUrl).textNodes}</p>
            <ParentPreviewMedia status={replyToStatus} instanceUrl={instanceUrl} />
          </div>
        )}
        {quoteStatus && (
          <div className="compose-quote-preview">
            <QuoteCard status={quoteStatus} instanceUrl={instanceUrl} onOpenThread={() => {}} />
          </div>
        )}
        {poll.enabled && <PollEditorFields poll={poll} />}
        <MediaUploadStrip uploads={uploads} onRemove={removeUpload} onEditDescription={editDescription} onCommitDescription={commitDescription} />
        <div className="dialog-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            className="icon-btn"
            type="button"
            aria-label="Attach media"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploads.length >= 4}
          >
            <ImagePlus size={16} />
          </button>
          <button
            className={`icon-btn${showCW ? ' active' : ''}`}
            type="button"
            aria-label="Content warning"
            onClick={() => setShowCW((v) => !v)}
          >
            <Eye size={16} />
          </button>
          <button
            className={`icon-btn${showTitle ? ' active' : ''}`}
            type="button"
            aria-label="Title"
            title="Add a title"
            onClick={() => setShowTitle((v) => !v)}
          >
            <Heading1 size={16} />
          </button>
          <button
            className={`icon-btn${showPreview ? ' active' : ''}`}
            type="button"
            aria-label="Preview"
            title="Markdown preview"
            onClick={() => setShowPreview((v) => !v)}
          >
            <FileText size={16} />
          </button>
          <button
            className={`icon-btn${poll.enabled ? ' active' : ''}`}
            type="button"
            aria-label="Add poll"
            title={uploads.length > 0 ? 'Polls and media can\u2019t be combined' : undefined}
            disabled={uploads.length > 0}
            onClick={() => poll.setEnabled((v) => !v)}
          >
            <BarChart2 size={16} />
          </button>
          <div style={{ position: 'relative', flex: '0 0 auto' }}>
            <button
              className={`icon-btn${showEmojiPicker ? ' active' : ''}`}
              type="button"
              aria-label="Emoji"
              onClick={() => setShowEmojiPicker((v) => !v)}
            >
              <Smile size={16} />
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                customEmojis={customEmojis}
                onSelect={(ch) => { insertAtCaret(text, setText, textareaRef, ch); setShowEmojiPicker(false) }}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
          </div>
          <VisibilitySelect value={visibility} onChange={setVisibility} options={replyOptions} />
          <LanguageSelect value={language} onChange={setLanguage} />
          <div style={{ flex: 1, minWidth: 0 }} />
          <button className="pill-btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="pill-btn suggested"
            onClick={submit}
            disabled={busy || isUploading}
            type="button"
          >
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
