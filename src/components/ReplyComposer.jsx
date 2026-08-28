import { useContext, useEffect, useRef, useState } from 'react'
import {
  X,
  Eye,
  Smile,
  ImagePlus,
  BarChart2,
  FileText,
  Heading1,
} from 'lucide-react'
import * as mitra from '../lib/mitra'
import { processStatusContent } from '../lib/render.jsx'
import {
  useMediaUploads, MediaUploadStrip, CharCounter, VisibilitySelect, LanguageSelect,
  usePollDraft, PollEditorFields, ParentPreviewMedia, useStatusPreview, StatusPreviewPane,
  replyVisibilityOptions, defaultReplyVisibility,
} from './Compose.jsx'
import { AppSettingsContext } from '../hooks'
import {
  insertAtCaret,
  useEmojiAutocomplete,
  EmojiDropdown,
  EmojiPicker,
} from './Emoji.jsx'
import { useMentionAutocomplete, MentionDropdown } from './Mention.jsx'

export function ReplyComposerFields({ status, instanceUrl, token, onClose, onPosted, maxCharacters = 500, currentAccountId }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [spoilerText, setSpoilerText] = useState('')
  const [showCW, setShowCW] = useState(false)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const [customEmojis, setCustomEmojis] = useState([])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const { uploads, addFiles, editDescription, commitDescription, removeUpload, mediaIds, isUploading } = useMediaUploads(
    instanceUrl,
    token
  )
  const poll = usePollDraft()
  // One key per draft: retries of a timed-out submit dedupe server-side.
  const draftKeyRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `draft-${Date.now()}-${Math.random()}`
  )
  const account = status?.account || {}
  const name = account.display_name || account.username || 'Unknown'
  const { defaultVisibility } = useContext(AppSettingsContext)
  // Replies may not be raised above the parent — only the visibilities the
  // server accepts for a reply to `status` are offered, and the select starts
  // at the sensible default (conversation for limited parents, direct for DM).
  // A conversation parent is *not* hard-locked: replying as an explicit DM is
  // still allowed, matching mitra-web.
  const parentVisibility = status?.visibility
  const isSameAuthor = currentAccountId && status?.account?.id === currentAccountId
  const replyOptions = parentVisibility
    ? replyVisibilityOptions(parentVisibility, isSameAuthor)
    : undefined
  const [visibility, setVisibility] = useState(
    parentVisibility ? defaultReplyVisibility(parentVisibility) : (defaultVisibility || 'public')
  )
  const [showTitle, setShowTitle] = useState(false)
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const preview = useStatusPreview(showPreview, text, instanceUrl, token)
  const { query: acQuery, suggestions: acSuggestions, selectedIndex: acIndex, handleKeyDown: acKeyDown } = useEmojiAutocomplete(text, setText, textareaRef, customEmojis)
  const mn = useMentionAutocomplete(text, setText, textareaRef, instanceUrl, token)

  useEffect(() => {
    mitra.fetchCustomEmojis(instanceUrl).then((emojis) => setCustomEmojis(emojis || [])).catch(() => {})
  }, [instanceUrl])

  // Polls and media attachments are mutually exclusive
  useEffect(() => {
    if (uploads.length > 0 && poll.enabled) poll.setEnabled(false)
    if (poll.enabled && mediaIds.length > 0) removeUpload(mediaIds[0])
  }, [uploads.length, poll.enabled])

  async function submit() {
    if (!text.trim() && mediaIds.length === 0 && !poll.enabled) {
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
      const reply = await mitra.postStatus(instanceUrl, token, text.trim(), {
        inReplyToId: status.id,
        visibility,
        mediaIds,
        spoilerText: showCW ? spoilerText : undefined,
        poll: poll.params,
        idempotencyKey: draftKeyRef.current,
        title: showTitle && title.trim() ? title.trim() : undefined,
        language: language || undefined,
      })
      onPosted(status.id, reply)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="thread-panel-header">
        <span className="dialog-title">Reply</span>
        <button className="icon-btn" aria-label="Cancel" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {status && (
        <div className="thread-panel-preview">
          <div className="post-meta">
            <span className="post-name">{name}</span>
            <span className="post-handle">@{account.acct || account.username}</span>
          </div>
          <p className="post-text">{processStatusContent(status, instanceUrl).textNodes}</p>
          <ParentPreviewMedia status={status} instanceUrl={instanceUrl} />
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}
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
          placeholder={`Reply to ${name}…`}
          rows={6}
          autoFocus
        />
        <EmojiDropdown query={acQuery} suggestions={acSuggestions} selectedIndex={acIndex} onSelect={(s) => {
          const insert = s.type === 'custom' ? `:${s.name}:` : s.char
          insertAtCaret(text, setText, textareaRef, insert)
        }} />
        <MentionDropdown query={mn.query} suggestions={mn.suggestions} selectedIndex={mn.selectedIndex} onSelect={(i) => mn.acceptSelection(i)} />
        <CharCounter current={text.length} max={maxCharacters} />
      </div>
      {showPreview && <StatusPreviewPane nodes={preview.nodes} error={preview.error} />}
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
        <div style={{ flex: 1 }} />
        <button className="pill-btn" onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className="pill-btn suggested"
          onClick={submit}
          disabled={busy || isUploading}
          type="button"
        >
          {busy ? 'Posting…' : 'Reply'}
        </button>
      </div>
    </>
  )
}

