import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { htmlToPlainText } from '../lib/render.jsx'
import { Switch } from './Switch.jsx'

// Read a File as { base64, mediaType, preview }. The API wants raw
// base64 plus an explicit media type — no data: URI prefix.
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const match = /^data:([^;]+);base64,(.*)$/.exec(result)
      if (!match) {
        reject(new Error('Could not read that image.'))
        return
      }
      resolve({ mediaType: match[1], base64: match[2], preview: result })
    }
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.readAsDataURL(file)
  })
}

const MAX_FIELDS = 6

// Edit the signed-in user's own profile via update_credentials.
export function ProfileEditDialog({ account, instanceUrl, token, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(account.display_name || '')
  const [bio, setBio] = useState(account.note ? htmlToPlainText(account.note) : '')
  const [bot, setBot] = useState(Boolean(account.bot))
  const [locked, setLocked] = useState(Boolean(account.locked))
  const [fields, setFields] = useState(
    (account.fields || []).map((f) => ({ name: htmlToPlainText(f.name), value: htmlToPlainText(f.value) }))
  )
  const [avatar, setAvatar] = useState(null)
  const [header, setHeader] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const avatarInputRef = useRef(null)
  const headerInputRef = useRef(null)

  function setField(idx, key, val) {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, [key]: val } : f)))
  }

  async function pickImage(input, setter) {
    const file = input.target.files && input.target.files[0]
    input.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.')
      return
    }
    try {
      setter(await readImage(file))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      const body = {
        display_name: displayName,
        note: bio,
        bot,
        locked,
        fields_attributes: fields
          .map((f) => ({ name: f.name.trim(), value: f.value.trim() }))
          .filter((f) => f.name && f.value),
      }
      if (avatar) {
        body.avatar = avatar.base64
        body.avatar_media_type = avatar.mediaType
      }
      if (header) {
        body.header = header.base64
        body.header_media_type = header.mediaType
      }
      const updated = await mitra.updateCredentials(instanceUrl, token, body)
      onSaved(updated)
    } catch (err) {
      setError(err.message || 'Failed to save profile.')
      setBusy(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card profile-edit-card" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Edit profile</span>
          <button className="icon-btn" onClick={onClose} aria-label="Cancel">
            <X size={16} />
          </button>
        </div>
        {error && <div className="banner banner-error">{error}</div>}

        <div className="profile-edit-images">
          <button type="button" className="profile-edit-avatar-btn" onClick={() => avatarInputRef.current?.click()}>
            <img src={avatar ? avatar.preview : account.avatar} alt="" />
            <span>{avatar ? 'Change' : 'Avatar'}</span>
          </button>
          <button type="button" className="profile-edit-header-btn" onClick={() => headerInputRef.current?.click()}>
            {header ? <img src={header.preview} alt="" /> : <span>Header</span>}
            <span>{header ? 'Change' : 'Set banner'}</span>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e, setAvatar)} />
          <input ref={headerInputRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e, setHeader)} />
        </div>

        <label className="profile-edit-label">Display name</label>
        <input
          className="profile-edit-input"
          value={displayName}
          maxLength={64}
          onChange={(e) => setDisplayName(e.target.value)}
        />

        <label className="profile-edit-label">Bio</label>
        <textarea
          className="profile-edit-input"
          rows={4}
          placeholder="Tell people about yourself…"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />

        <div className="profile-edit-toggles">
          <label className="profile-edit-toggle-row">
            <span>Protected — Approve Followers Manually</span>
            <Switch checked={locked} onChange={setLocked} label="Protected" />
          </label>
          <label className="profile-edit-toggle-row">
            <span>Automated Account (Bot)</span>
            <Switch checked={bot} onChange={setBot} label="Automated Account" />
          </label>
        </div>

        <div className="profile-edit-fields-head">
          <label className="profile-edit-label" style={{ marginBottom: 0 }}>Profile fields</label>
          {fields.length < MAX_FIELDS && (
            <button type="button" className="pill-btn" onClick={() => setFields((prev) => [...prev, { name: '', value: '' }])}>
              + Add field
            </button>
          )}
        </div>
        {fields.length === 0 && <div className="poll-meta">No fields yet.</div>}
        {fields.map((field, idx) => (
          <div key={idx} className="profile-edit-field-row">
            <input
              className="profile-edit-input"
              placeholder="Label"
              value={field.name}
              maxLength={64}
              onChange={(e) => setField(idx, 'name', e.target.value)}
            />
            <input
              className="profile-edit-input"
              placeholder="Content"
              value={field.value}
              maxLength={255}
              onChange={(e) => setField(idx, 'value', e.target.value)}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label="Remove field"
              onClick={() => setFields((prev) => prev.filter((_, i) => i !== idx))}
            >
              <X size={14} />
            </button>
          </div>
        ))}

        <div className="dialog-actions">
          <div style={{ flex: 1 }} />
          <button className="pill-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="pill-btn suggested" type="button" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
