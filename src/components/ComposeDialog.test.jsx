import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppSettingsContext } from '../hooks'
import { ComposeDialog } from './Compose.jsx'

// The dialog fetches custom emojis on mount; keep tests offline.
vi.mock('../lib/mitra', () => ({
  fetchCustomEmojis: vi.fn().mockResolvedValue([]),
  postStatus: vi.fn(),
}))

const renderDialog = (props = {}) => render(
  <AppSettingsContext.Provider value={{ defaultVisibility: 'public' }}>
    <ComposeDialog
      instanceUrl="https://inst.example"
      token="t"
      onClose={() => {}}
      onPosted={() => {}}
      maxCharacters={500}
      {...props}
    />
  </AppSettingsContext.Provider>
)

describe('ComposeDialog validation', () => {
  beforeEach(() => localStorage.clear())

  it('refuses to post nothing', async () => {
    const onPosted = vi.fn()
    renderDialog({ onPosted })
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(await screen.findByText(/write something or attach/i)).toBeInTheDocument()
    expect(onPosted).not.toHaveBeenCalled()
  })

  it('refuses posts over the character limit', async () => {
    const onPosted = vi.fn()
    renderDialog({ onPosted })
    fireEvent.change(screen.getByPlaceholderText(/what's on your mind/i), {
      target: { value: 'x'.repeat(501) },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(await screen.findByText(/over the limit/i)).toBeInTheDocument()
    expect(onPosted).not.toHaveBeenCalled()
  })

  it('shows the over-limit count in the counter', () => {
    renderDialog()
    fireEvent.change(screen.getByPlaceholderText(/what's on your mind/i), {
      target: { value: 'x'.repeat(505) },
    })
    expect(screen.getByText('-5')).toHaveClass('over')
  })
})
