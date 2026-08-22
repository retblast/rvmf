import { useEffect, useRef, useState } from 'react'
import {
  X,
  Paperclip,
  Eye,
  Smile,
  ImagePlus,
} from 'lucide-react'
import * as mitra from '../lib/mitra'
import { processStatusContent } from '../lib/render.jsx'
import { QuoteCard } from './Post.jsx'
import {
  insertAtCaret,
  useEmojiAutocomplete,
  EmojiDropdown,
  EmojiPicker,
} from './Emoji.jsx'

// Manages a compose dialog's attached files: upload starts the moment a
// file is picked (not at submit time), each tracked independently so one
// slow/failed upload doesn't block the others. `mediaIds` only includes
// ones that finished successfully — submit should wait for `isUploading`
// to clear before posting.
function useMediaUploads(instanceUrl, token) {
  const [uploads, setUploads] = useState([])

  useEffect(() => {
    return () => {
      uploads.forEach((u) => URL.revokeObjectURL(u.previewUrl))
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
          { key, file, previewUrl, mediaId: null, uploading: true, error: '' },
        ])
        mitra
          .uploadMedia(instanceUrl, token, file)
          .then((attachment) => {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === key ? { ...u, uploading: false, mediaId: attachment.id } : u
              )
            )
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

  function removeUpload(key) {
    setUploads((prev) => {
      const target = prev.find((u) => u.key === key)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((u) => u.key !== key)
    })
  }

  const mediaIds = uploads.filter((u) => u.mediaId).map((u) => u.mediaId)
  const isUploading = uploads.some((u) => u.uploading)

  return { uploads, addFiles, removeUpload, mediaIds, isUploading }
}

function MediaUploadStrip({ uploads, onRemove }) {
  if (uploads.length === 0) return null
  return (
    <div className="upload-strip">
      {uploads.map((u) => (
        <div className="upload-thumb" key={u.key}>
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
    default:
      return v
  }
}

export function ReplyComposerFields({ status, instanceUrl, token, onClose, onPosted, maxCharacters = 500 }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [spoilerText, setSpoilerText] = useState('')
  const [showCW, setShowCW] = useState(false)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const [customEmojis, setCustomEmojis] = useState([])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const { uploads, addFiles, removeUpload, mediaIds, isUploading } = useMediaUploads(
    instanceUrl,
    token
  )
  const account = status?.account || {}
  const name = account.display_name || account.username || 'Unknown'
  const [visibility, setVisibility] = useState(status?.visibility || 'public')
  const { query: acQuery, suggestions: acSuggestions, selectedIndex: acIndex, handleKeyDown: acKeyDown } = useEmojiAutocomplete(text, setText, textareaRef, customEmojis)

  useEffect(() => {
    mitra.fetchCustomEmojis(instanceUrl).then((emojis) => setCustomEmojis(emojis || [])).catch(() => {})
  }, [instanceUrl])

  async function submit() {
    if (!text.trim() && mediaIds.length === 0) {
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
    setBusy(true)
    setError('')
    try {
      const reply = await mitra.postStatus(instanceUrl, token, text.trim(), {
        inReplyToId: status.id,
        visibility,
        mediaIds,
        spoilerText: showCW ? spoilerText : undefined,
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
      <div className="compose-textarea-wrap">
        <textarea
          ref={textareaRef}
          className="compose-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (acKeyDown(e)) return
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
        <CharCounter current={text.length} max={maxCharacters} />
      </div>
      <MediaUploadStrip uploads={uploads} onRemove={removeUpload} />
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
          <select
            className="compose-visibility-select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
          <option value="public">{visibilityLabel('public')}</option>
          <option value="unlisted">{visibilityLabel('unlisted')}</option>
          <option value="private">{visibilityLabel('private')}</option>
          <option value="direct">{visibilityLabel('direct')}</option>
        </select>
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

export function CharCounter({ current, max }) {
  const remaining = max - current
  if (current === 0) return null
  const cls = remaining < 0 ? 'over' : remaining < 50 ? 'low' : ''
  return <span className={`char-counter ${cls}`}>{remaining}</span>
}

export function ComposeDialog({ instanceUrl, token, onClose, onPosted, quoteStatus, maxCharacters = 500 }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [visibility, setVisibility] = useState('public')
  const [spoilerText, setSpoilerText] = useState('')
  const [showCW, setShowCW] = useState(false)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const [customEmojis, setCustomEmojis] = useState([])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const { uploads, addFiles, removeUpload, mediaIds, isUploading } = useMediaUploads(
    instanceUrl,
    token
  )
  const { query: acQuery, suggestions: acSuggestions, selectedIndex: acIndex, handleKeyDown: acKeyDown } = useEmojiAutocomplete(text, setText, textareaRef, customEmojis)

  useEffect(() => {
    mitra.fetchCustomEmojis(instanceUrl).then((emojis) => setCustomEmojis(emojis || [])).catch(() => {})
  }, [instanceUrl])

  async function submit() {
    if (!text.trim() && mediaIds.length === 0 && !quoteStatus) {
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
    setBusy(true)
    setError('')
    try {
      const status = await mitra.postStatus(instanceUrl, token, text.trim(), {
        mediaIds,
        visibility,
        quoteId: quoteStatus?.id,
        spoilerText: showCW ? spoilerText : undefined,
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
          <CharCounter current={text.length} max={maxCharacters} />
        </div>
        {quoteStatus && (
          <div className="compose-quote-preview">
            <QuoteCard status={quoteStatus} instanceUrl={instanceUrl} onOpenThread={() => {}} />
          </div>
        )}
        <MediaUploadStrip uploads={uploads} onRemove={removeUpload} />
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
          <select
            className="compose-visibility-select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="public">{visibilityLabel('public')}</option>
            <option value="unlisted">{visibilityLabel('unlisted')}</option>
            <option value="private">{visibilityLabel('private')}</option>
            <option value="direct">{visibilityLabel('direct')}</option>
          </select>
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
