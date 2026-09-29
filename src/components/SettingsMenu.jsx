import { PROVIDERS, PROVIDER_IDS } from '../lib/translate.js'
import { GIF_LARGE_BYTES } from '../lib/gif/convert.js'
import { SKINS } from '../lib/skins.js'
import { visibilityLabel as mitraVisibilityLabel } from './Compose.jsx'
import { Switch } from './Switch.jsx'
import { ConfirmDialog } from './ConfirmDialog.jsx'

// The settings popover: appearance, content, GIF/translation power
// features, and account-level defaults. All the state lives in
// useAppSettings (`settings` prop); this is pure presentation plus the
// translation opt-in confirm dialog. `anchor` positions the panel next to
// its trigger (null = centered).
export function SettingsMenu({ open, anchor, settings, onClose, onNavigate }) {
  if (!open && !settings.confirmingTranslation) return null

  // Anchor the settings panel to its trigger while capping its height to the
  // space that actually fits the viewport; the panel scrolls internally when
  // the content is taller than that.
  function menuStyle() {
    if (!anchor) return undefined
    const fromBottom = anchor.bottom + 460 > window.innerHeight
    const space = (fromBottom ? anchor.top : window.innerHeight - anchor.bottom) - 14
    return {
      top: fromBottom ? undefined : anchor.bottom + 6,
      bottom: fromBottom ? window.innerHeight - anchor.top + 6 : undefined,
      maxHeight: Math.max(160, space),
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - 340)),
    }
  }

  return (
    <>
      {open && (
        <>
          <div className="settings-menu-backdrop" onClick={onClose} />
          <div
            className={`settings-menu${anchor ? '' : ' centered'}`}
            style={menuStyle()}
          >
            <div className="settings-group">
              <span className="settings-menu-heading">Appearance</span>
              <div className="settings-menu-row">
                <span>Style</span>
                <select
                  className="compose-visibility-select"
                  value={settings.skinId}
                  onChange={(e) => settings.setSkinId(e.target.value)}
                  aria-label="Style"
                >
                  {Object.values(SKINS).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <label className="settings-menu-row">
                <span>Use System Accent Color</span>
                <Switch checked={settings.useOsAccent} onChange={settings.toggleUseOsAccent} label="Use System Accent Color" />
              </label>
              <div className="settings-menu-row">
                <span>Theme</span>
                <div className="theme-toggle">
                  <button
                    className={`theme-toggle-btn${settings.themeMode === 'system' ? ' active' : ''}`}
                    onClick={() => settings.setThemeMode('system')}
                  >
                    System
                  </button>
                  <button
                    className={`theme-toggle-btn${settings.themeMode === 'light' ? ' active' : ''}`}
                    onClick={() => settings.setThemeMode('light')}
                  >
                    Light
                  </button>
                  <button
                    className={`theme-toggle-btn${settings.themeMode === 'dark' ? ' active' : ''}`}
                    onClick={() => settings.setThemeMode('dark')}
                  >
                    Dark
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-group">
              <span className="settings-menu-heading">Content</span>
              <label className="settings-menu-row">
                <span>Fetch Media Directly</span>
                <Switch checked={settings.fetchClientMedia} onChange={settings.toggleFetchClientMedia} label="Fetch Media Directly" />
              </label>
              <label className="settings-menu-row">
                <span>Mark All Media As Sensitive</span>
                <Switch checked={settings.alwaysSensitive} onChange={settings.toggleAlwaysSensitive} label="Mark All Media As Sensitive" />
              </label>
              {settings.alwaysSensitive && (
                <label className="settings-menu-row settings-menu-subrow">
                  <span>Reveal Media on Hover (Peek)</span>
                  <Switch checked={settings.peekSpoilerMedia} onChange={settings.togglePeekSpoilerMedia} label="Reveal Media on Hover (Peek)" />
                </label>
              )}
            </div>

            <div className="settings-group">
              <span className="settings-menu-heading">Privacy</span>
              <label className="settings-menu-row">
                <span>Hide My Identity</span>
                <Switch checked={settings.privacyMode} onChange={settings.togglePrivacyMode} label="Hide My Identity" />
              </label>
            </div>

            <div className="settings-group">
              <span className="settings-menu-heading">GIF Power Saver</span>
              <label className="settings-menu-row">
                <span>Convert GIFs to AV1</span>
                <Switch checked={settings.gifConversionEnabled} onChange={settings.toggleGifConversion} label="Convert GIFs to AV1" />
              </label>
              <div className="settings-menu-note">
                Re-encodes animated GIFs as AV1 video on this device so scrolling drains less battery. Conversions live in a private cache that expires after 30 days of disuse.
              </div>
              {settings.gifConversionEnabled && (
                <>
                  <label className="settings-menu-row settings-menu-subrow">
                    <span>Convert Large GIFs Too</span>
                    <Switch checked={settings.gifIncludeLarge} onChange={settings.toggleGifIncludeLarge} label="Convert Large GIFs Too" />
                  </label>
                  <div className="settings-menu-note">
                    By default GIFs over {Math.round(GIF_LARGE_BYTES / 1024 / 1024)} MB stay as-is — conversion is slower for them.
                  </div>
                  <label className="settings-menu-row settings-menu-subrow">
                    <span>Animate on Hover</span>
                    <Switch checked={settings.gifHoverAnimate} onChange={settings.toggleGifHoverAnimate} label="Animate on Hover" />
                  </label>
                  <div className="settings-menu-note">
                    Emojis and avatars stay still until you hover them.
                  </div>
                </>
              )}
            </div>

            <div className="settings-group">
              <span className="settings-menu-heading">Translation</span>
              <label className="settings-menu-row">
                <span>Translate Foreign Posts</span>
                <Switch checked={settings.translationEnabled} onChange={settings.handleToggleTranslation} label="Translate Foreign Posts" />
              </label>
              <div className="settings-menu-note">
                Runs on-device in your browser — post text never leaves your device.
              </div>
              {settings.translationEnabled && (
                <div className="settings-menu-row settings-menu-subrow settings-menu-radio-group">
                  <span className="settings-menu-radios">
                    {PROVIDER_IDS.map((id) => (
                      <label
                        key={id}
                        className="settings-menu-radio"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="radio"
                          name="translation-provider"
                          value={id}
                          checked={settings.translationProvider === id}
                          onChange={() => settings.handleTranslationProvider(id)}
                        />
                        <span>{PROVIDERS[id].uiLabel}</span>
                      </label>
                    ))}
                  </span>
                </div>
              )}
            </div>

            <div className="settings-group">
              <span className="settings-menu-heading">Account</span>
              <div className="settings-menu-row">
                <span>Default Post Visibility</span>
                <select
                  className="compose-visibility-select"
                  value={settings.defaultVisibility}
                  onChange={(e) => settings.handleDefaultVisibilityChange(e.target.value)}
                >
                  {['public', 'unlisted', 'private', 'subscribers', 'direct'].map((v) => (
                    <option key={v} value={v}>{mitraVisibilityLabel(v)}</option>
                  ))}
                </select>
              </div>
              <div className="settings-menu-row">
                <span>Sent From</span>
                <input
                  type="text"
                  className="settings-text-input"
                  value={settings.clientName}
                  onChange={(e) => settings.handleClientNameChange(e.target.value)}
                  maxLength={32}
                />
              </div>
            </div>

            <button
              type="button"
              className="settings-menu-row settings-menu-link"
              onClick={() => { onClose(); onNavigate('favourites') }}
            >
              <span>Favourites</span>
              <span className="settings-menu-arrow">→</span>
            </button>
            <button
              type="button"
              className="settings-menu-row settings-menu-link"
              onClick={() => { onClose(); onNavigate('muted') }}
            >
              <span>Muted Accounts</span>
              <span className="settings-menu-arrow">→</span>
            </button>
            <button
              type="button"
              className="settings-menu-row settings-menu-link"
              onClick={() => { onClose(); onNavigate('account') }}
            >
              <span>Account &amp; Sessions</span>
              <span className="settings-menu-arrow">→</span>
            </button>
          </div>
        </>
      )}

      {settings.confirmingTranslation && (
        <ConfirmDialog
          title="Enable on-device translation?"
          confirmLabel="Enable"
          onCancel={() => settings.setConfirmingTranslation(false)}
          onConfirm={settings.confirmTranslation}
        >
          <p>
            This turns on in-browser translation for posts in a language
            that isn't yours. Translations run on-device — post text is
            never sent to a server.
          </p>
          <p className="confirm-note">
            The default uses the fast, lightweight Qwen model (~600 MB,
            CPU). You can switch to the higher-quality Gemma 4 model
            (WebGPU) from the Translation settings. Models download
            once, then stay cached.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}
