import { Bell, Bookmark, Compass, Home, List, LogOut, Mail, Plus, RotateCw, Search, Settings, Users } from 'lucide-react'
import { useMaskIdentity } from '../../hooks'
import { Avatar } from '../../components/Media.jsx'

// Stealth (X-look) skin chrome. One component, three tier renders:
//   - wide (>=1400): full left rail — brand glyph, labeled nav, Post pill,
//     refresh/settings, account chip + log out
//   - medium (900–1399): the same rail with labels collapsed to icons
//   - narrow (<900, phones): slim top bar (avatar → settings, view title,
//     search) + fixed bottom tab bar with a center Post button, X-style
//
// Accessible names are preserved from the Adwaita header bar (Home,
// Explore, Notifications, Messages, Bookmarks, Lists, Groups, Search,
// New post, Settings, Refresh, Log out) so role-based e2e and screen
// readers keep working. The account chip runs through the privacy mask —
// identity stays "You"/@you when privacy mode is on.

const NAV = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'explore', label: 'Explore', Icon: Compass },
  { id: 'notifications', label: 'Notifications', Icon: Bell, badge: true },
  { id: 'messages', label: 'Messages', Icon: Mail },
  { id: 'bookmarks', label: 'Bookmarks', Icon: Bookmark },
  { id: 'lists', label: 'Lists', Icon: List },
  { id: 'groups', label: 'Groups', Icon: Users },
  { id: 'search', label: 'Search', Icon: Search },
]

// Bottom tab bar carries the four primary views; the rest live behind
// the avatar → settings menu (the skin declares them as menuViews).
const TABS = NAV.filter(({ id }) => ['home', 'explore', 'notifications', 'messages'].includes(id))

function viewLabel(view) {
  return NAV.find(({ id }) => id === view)?.label || 'rvmf'
}

function NavButton({ view, setView, notifUnread, item }) {
  const { id, label, Icon, badge } = item
  const active = view === id
  return (
    <button
      type="button"
      className={`x-nav-item${active ? ' active' : ''}`}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={() => setView(id)}
    >
      <span className="x-nav-icon">
        <Icon size={24} />
        {badge && notifUnread > 0 && (
          <span className="x-badge">{notifUnread > 99 ? '99+' : notifUnread}</span>
        )}
      </span>
      <span className="view-label">{label}</span>
    </button>
  )
}

export default function StealthRail({ session, tier, view, setView, notifUnread, handleRefresh, setComposing, logout, openSettingsFrom, settingsOpen: _settingsOpen }) {
  const mask = useMaskIdentity()
  const me = mask(session.account)

  if (tier === 'narrow') {
    return (
      <>
        <header className="x-topbar">
          <button
            type="button"
            className="x-topbar-avatar"
            aria-label="Settings"
            onClick={(e) => openSettingsFrom(e)}
          >
            <Avatar name={me.display_name || me.username} src={me.avatar} size={30} />
          </button>
          <span className="x-topbar-title">{viewLabel(view)}</span>
          <button type="button" className="icon-btn" aria-label="Search" onClick={() => setView('search')}>
            <Search size={20} />
          </button>
        </header>
        <nav className="x-tabbar" aria-label="Primary">
          {TABS.filter(({ id }) => id !== 'messages').map((item) => (
            <NavButton key={item.id} view={view} setView={setView} notifUnread={notifUnread} item={item} />
          ))}
          <button type="button" className="x-tab-fab" aria-label="New post" onClick={() => setComposing(true)}>
            <Plus size={26} />
          </button>
          {TABS.filter(({ id }) => id === 'messages').map((item) => (
            <NavButton key={item.id} view={view} setView={setView} notifUnread={notifUnread} item={item} />
          ))}
        </nav>
      </>
    )
  }

  return (
    <nav className="x-rail" aria-label="Primary">
      <div className="x-brand" aria-hidden="true">X</div>
      {NAV.map((item) => (
        <NavButton key={item.id} view={view} setView={setView} notifUnread={notifUnread} item={item} />
      ))}
      <button type="button" className="x-post-btn" aria-label="New post" onClick={() => setComposing(true)}>
        <Plus size={20} />
        <span className="view-label">Post</span>
      </button>
      <div className="x-rail-footer">
        <button type="button" className="icon-btn" aria-label="Refresh" title="Refresh" onClick={handleRefresh}>
          <RotateCw size={20} />
        </button>
        <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={(e) => openSettingsFrom(e)}>
          <Settings size={20} />
        </button>
        <div className="x-account-chip-row">
          <button
            type="button"
            className="x-account-chip"
            aria-label="Account"
            onClick={(e) => openSettingsFrom(e)}
          >
            <Avatar name={me.display_name || me.username} src={me.avatar} size={34} />
            <span className="x-account-names">
              <span className="x-account-name">{me.display_name || me.username}</span>
              <span className="x-account-handle">@{me.acct || me.username}</span>
            </span>
          </button>
          <button type="button" className="icon-btn" aria-label="Log out" title="Log out" onClick={logout}>
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </nav>
  )
}
