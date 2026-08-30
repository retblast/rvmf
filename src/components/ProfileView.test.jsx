import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AppSettingsContext } from '../hooks'
import { ProfileView } from './ProfileView.jsx'
import { forgetGifConversion } from '../lib/gif/convert.js'

vi.mock('../lib/mitra', () => ({
  fetchAccount: vi.fn(),
  fetchAccountStatuses: vi.fn(),
  fetchRelationships: vi.fn(),
  fetchLists: vi.fn(),
  fetchAccountLists: vi.fn(),
  loadRemoteActivities: vi.fn(),
  followAccount: vi.fn(),
  unfollowAccount: vi.fn(),
  fetchFollowers: vi.fn(),
  fetchFollowing: vi.fn(),
  fetchSubscribers: vi.fn(),
  removeFromFollowers: vi.fn(),
  addAccountsToList: vi.fn(),
  removeAccountsFromList: vi.fn(),
}))

vi.mock('./Post.jsx', () => ({
  PostRow: () => null,
}))

vi.mock('./ProfileEdit.jsx', () => ({
  ProfileEditDialog: () => null,
}))

vi.mock('../lib/gif/convert.js', () => ({
  ensureGifConverted: vi.fn(async () => null),
  forgetGifConversion: vi.fn(async () => {}),
  resetGifConversionMemo: vi.fn(),
  GIF_LARGE_BYTES: 5 * 1024 * 1024,
  GIF_MIN_BYTES: 1024,
}))

import * as mitra from '../lib/mitra'

const ACCOUNT = {
  id: 'acc-1',
  username: 'gifperson',
  display_name: 'Gif Person',
  acct: 'gifperson',
  avatar: 'https://x.example/avatar.gif',
  avatar_static: 'https://x.example/avatar.png',
  header: '',
  note: 'hello',
  statuses_count: 3,
  following_count: 2,
  followers_count: 5,
  subscribers_count: 0,
}

function contextValue(overrides = {}) {
  return {
    instanceUrl: 'https://x.example',
    token: 'tok',
    fetchClientMedia: false,
    gifConversionEnabled: true,
    gifIncludeLarge: false,
    gifHoverAnimate: false,
    ...overrides,
  }
}

function renderProfile(context = {}) {
  return render(
    <AppSettingsContext.Provider value={contextValue(context)}>
      <ProfileView
        accountId="acc-1"
        instanceUrl="https://x.example"
        token="tok"
        currentAccountId="me"
        onClose={() => {}}
        onOpenProfile={() => {}}
        onOpenThread={() => {}}
        onOpenLightbox={() => {}}
        onComposeReply={() => {}}
        onUpdate={() => {}}
        onQuote={() => {}}
        onDelete={() => {}}
        onMute={() => {}}
        onBlock={() => {}}
        onEdit={() => {}}
      />
    </AppSettingsContext.Provider>
  )
}

describe('ProfileView avatar retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mitra.fetchAccount.mockResolvedValue(ACCOUNT)
    mitra.fetchAccountStatuses.mockResolvedValue([])
    mitra.fetchRelationships.mockResolvedValue([])
  })

  it('shows the retry button for a GIF avatar when conversion is on', async () => {
    const { container } = renderProfile()
    await waitFor(() => expect(screen.getByText('Gif Person')).toBeTruthy())
    const btn = container.querySelector('.profile-avatar-retry')
    expect(btn).not.toBeNull()
    expect(btn.getAttribute('aria-label')).toContain('Retry')
  })

  it('hides the retry button when conversion is off', async () => {
    const { container } = renderProfile({ gifConversionEnabled: false })
    await waitFor(() => expect(screen.getByText('Gif Person')).toBeTruthy())
    expect(container.querySelector('.profile-avatar-retry')).toBeNull()
  })

  it('resets the conversion pipeline for the profile avatar when clicked', async () => {
    const { container } = renderProfile()
    await waitFor(() => expect(screen.getByText('Gif Person')).toBeTruthy())
    const btn = container.querySelector('.profile-avatar-retry')
    fireEvent.click(btn)
    await waitFor(() => expect(forgetGifConversion).toHaveBeenCalledWith(ACCOUNT.avatar))
  })
})