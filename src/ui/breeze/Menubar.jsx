import { useState } from 'react'
import { Avatar } from '../../components/Media.jsx'

// KDE Breeze structural variant: a classic menu bar instead of the
// GNOME header bar. Receives the documented HeaderBar props contract
// (see docs/THEMING.md) and renders dropdown menus that drive the
// same actions.
const GO_ITEMS = [
  ['home', 'Home'], ['notifications', 'Notifications'], ['explore', 'Explore'],
  ['messages', 'Messages'], ['lists', 'Lists'], ['groups', 'Groups'],
  ['bookmarks', 'Bookmarks'], ['search', 'Search'],
]

function Menu({ label, open, onToggle, children }) {
  return (
    <div className="menubar-menu">
      <button type="button" className={`menubar-item${open ? ' active' : ''}`} onClick={onToggle}>
        {label}
      </button>
      {open && (
        <>
          <div className="boost-dropdown-backdrop" onClick={onToggle} />
          <div className="menubar-dropdown boost-dropdown">{children}</div>
        </>
      )}
    </div>
  )
}

export default function BreezeMenubar({
  session, view, setView, notifUnread,
  handleRefresh, setComposing, logout,
  settingsOpen, setSettingsOpen,
}) {
  const [openMenu, setOpenMenu] = useState(null)
  const toggle = (name) => setOpenMenu((m) => (m === name ? null : name))
  const close = () => setOpenMenu(null)

  return (
    <nav className="menubar">
      <span className="menubar-brand">rvmf</span>

      <Menu label="Go" open={openMenu === 'go'} onToggle={() => toggle('go')}>
        {GO_ITEMS.map(([id, label]) => (
          <button key={id} type="button"
            className={`boost-dropdown-item${view === id ? ' boosted' : ''}`}
            onClick={() => { setView(id); close() }}>
            {label}
            {id === 'notifications' && notifUnread > 0 ? ` (${notifUnread})` : ''}
          </button>
        ))}
      </Menu>

      <Menu label="File" open={openMenu === 'file'} onToggle={() => toggle('file')}>
        <button type="button" className="boost-dropdown-item" disabled={!session}
          onClick={() => { setComposing(true); close() }}>
          New Post… (Ctrl+N)
        </button>
        <button type="button" className="boost-dropdown-item" disabled={!session}
          onClick={() => { handleRefresh(); close() }}>
          Refresh Timeline
        </button>
      </Menu>

      <Menu label="Settings" open={openMenu === 'settings'} onToggle={() => toggle('settings')}>
        <button type="button" className="boost-dropdown-item"
          onClick={() => { setSettingsOpen(!settingsOpen); close() }}>
          Preferences…
        </button>
        <button type="button" className="boost-dropdown-item destructive" disabled={!session}
          onClick={() => { logout(); close() }}>
          Log Out
        </button>
      </Menu>

      <div className="menubar-spacer" />
      {session?.account && (
        <Avatar
          size={22}
          name={session.account.display_name || session.account.username}
          src={session.account.avatar}
        />
      )}
    </nav>
  )
}
