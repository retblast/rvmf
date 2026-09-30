import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppSettingsContext } from '../../hooks'
import StealthRail from './Rail.jsx'

// Stealth (X-look) chrome: one component, three tier renders. The
// accessible names must match the Adwaita header bar's exactly — specs
// and screen readers navigate by role+name, so the skin swap stays
// invisible to them.

const SESSION = {
  account: { id: 'u1', display_name: 'Alice', acct: 'alice', username: 'alice', avatar: null },
}

function renderRail(tier, { notifUnread = 0, mask, view = 'home', privacyMode } = {}) {
  return render(
    <AppSettingsContext.Provider value={{ mask, privacyMode, selfId: privacyMode ? 'u1' : null }}>
      <StealthRail
        session={SESSION}
        tier={tier}
        view={view}
        setView={() => {}}
        notifUnread={notifUnread}
        handleRefresh={() => {}}
        setComposing={() => {}}
        logout={() => {}}
        openSettingsFrom={() => {}}
        settingsOpen={false}
      />
    </AppSettingsContext.Provider>
  )
}

describe('StealthRail wide/medium tier', () => {
  it('renders the full nav with the standard accessible names', () => {
    renderRail('wide')
    for (const label of ['Home', 'Explore', 'Notifications', 'Messages', 'Bookmarks', 'Lists', 'Groups', 'Search']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('keeps the action names: New post, Refresh, Settings, Log out, Account', () => {
    renderRail('wide')
    expect(screen.getByRole('button', { name: 'New post' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Account' })).toBeTruthy()
  })

  it('shows the unread badge count on Notifications', () => {
    renderRail('wide', { notifUnread: 3 })
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('marks the active view with aria-current', () => {
    renderRail('wide', { view: 'messages' })
    expect(screen.getByRole('button', { name: 'Messages' }).getAttribute('aria-current')).toBe('page')
  })

  it('masks the account chip when privacy mode is on', () => {
    const mask = (account) => account.id === 'u1'
      ? { ...account, display_name: 'You', acct: 'you', username: 'you', avatar: null }
      : account
    renderRail('wide', { mask, privacyMode: true })
    expect(screen.getByText('You')).toBeTruthy()
    expect(screen.getByText('@you')).toBeTruthy()
    expect(screen.queryByText('Alice')).toBeNull()
    expect(screen.queryByText('@alice')).toBeNull()
  })

  it('shows the real account chip by default', () => {
    renderRail('wide')
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('@alice')).toBeTruthy()
  })
})

describe('StealthRail phone tier', () => {
  it('renders the bottom tab bar with the primary four and a Post FAB', () => {
    renderRail('narrow')
    for (const label of ['Home', 'Explore', 'Notifications', 'Messages']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'New post' })).toBeTruthy()
    // Rail-only views have no phone chrome — they live behind the menu.
    expect(screen.queryByRole('button', { name: 'Bookmarks' })).toBeNull()
  })

  it('renders a top bar with the settings avatar and search', () => {
    renderRail('narrow')
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull() // pull-to-refresh covers phones
  })

  it('titles the top bar with the current view', () => {
    renderRail('narrow', { view: 'explore' })
    expect(document.querySelector('.x-topbar-title').textContent).toBe('Explore')
  })
})
