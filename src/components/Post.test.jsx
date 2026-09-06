import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppSettingsContext, GhostContext } from '../hooks'
import { useTranslation, PostRow } from './Post.jsx'

// The real translate module lazily pulls in Transformers.js (multi-GB model,
// WebGPU) — mock it so the hook's orchestration can be tested without that.
const translateText = vi.fn()
const translationPressureNotice = vi.fn(async () => null)
vi.mock('../lib/translate', () => ({
  translateText: (...args) => translateText(...args),
  translationPressureNotice: (...args) => translationPressureNotice(...args),
}))

// PostRow uses usePostActions which calls mitra API methods — mock them
// to avoid real fetches in jsdom.
vi.mock('../lib/mitra', () => ({ default: {}, setFavourited: vi.fn(), setReblogged: vi.fn(), addReaction: vi.fn(), removeReaction: vi.fn() }))

function Provider({ children, provider = 'qwen-cpu' }) {
  return (
    <AppSettingsContext.Provider value={{ translationEnabled: true, translationProvider: provider }}>
      {children}
    </AppSettingsContext.Provider>
  )
}

// Minimal harness that surfaces the hook's state through the DOM so the
// toggle behavior is exercised end to end.
function Harness({ status }) {
  const t = useTranslation(status)
  return (
    <div>
      <button onClick={t.toggle}>toggle</button>
      <span data-testid="shown">{String(t.shown)}</span>
      <span data-testid="phase">{t.phase}</span>
      <span data-testid="source">{t.sourceCode || ''}</span>
      <span data-testid="translated">{t.translated || ''}</span>
      {t.error && <span data-testid="error">{t.error}</span>}
    </div>
  )
}

const status = {
  id: '1',
  language: 'ja',
  content: '<p>hello</p>',
  mentions: [],
  emojis: [],
}

function setup(overrides = {}, provider) {
  return render(<Harness status={{ ...status, ...overrides }} />, { wrapper: ({ children }) => <Provider provider={provider}>{children}</Provider> })
}

beforeEach(() => {
  translateText.mockReset()
  translationPressureNotice.mockReset()
  translationPressureNotice.mockResolvedValue(null)
})

describe('useTranslation', () => {
  it('is opted in via the settings context and starts untranslated', () => {
    setup()
    expect(screen.getByTestId('shown').textContent).toBe('false')
    expect(screen.getByTestId('phase').textContent).toBe('idle')
  })

  it('toggles the translated view on, calling the translator once', async () => {
    translateText.mockResolvedValue('こんにちは')
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: 'toggle' }))
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('done'))
    expect(screen.getByTestId('shown').textContent).toBe('true')
    expect(screen.getByTestId('translated').textContent).toBe('こんにちは')
    expect(translateText).toHaveBeenCalledTimes(1)

    // Toggling again reveals the original.
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('shown').textContent).toBe('false')
  })

  it('reuses a finished translation without re-translating', async () => {
    translateText.mockResolvedValue('こんにちは')
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: 'toggle' }))
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('done'))

    await user.click(screen.getByRole('button', { name: 'toggle' })) // off
    await user.click(screen.getByRole('button', { name: 'toggle' })) // back on
    expect(screen.getByTestId('shown').textContent).toBe('true')
    expect(translateText).toHaveBeenCalledTimes(1) // no second fetch
  })

  it('translates directly with no source language when the tag is missing', async () => {
    // Neither on-device translator needs a source: instruction models read it
    // from the text. No tag + Latin-only content used to force a picker.
    translateText.mockResolvedValue('bonjour')
    const user = userEvent.setup()
    setup({ language: null })

    await user.click(screen.getByRole('button', { name: 'toggle' }))
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('done'))
    expect(translateText).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('source').textContent).toBe('') // no source anywhere
  })

  it('uses the post language tag only for the display label, not for inference', async () => {
    translateText.mockResolvedValue('こんにちは')
    const user = userEvent.setup()
    setup({ language: 'ja' })

    await user.click(screen.getByRole('button', { name: 'toggle' }))
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('done'))
    expect(screen.getByTestId('source').textContent).toBe('ja')

    // The hook still passes the tag along (cosmetic), but the translator no
    // longer consumes it as a model code.
    expect(translateText.mock.calls[0][1]).toBe('ja')
  })
})

// ---------------------------------------------------------------------------
// Ghost placeholder ("Viewing in thread") — derived purely from context
// ---------------------------------------------------------------------------

const ghostPost = {
  id: 'post-ghost-1',
  content: '<p>ghost test post</p>',
  account: { id: 'u1', display_name: 'Alice', acct: 'alice', avatar: '', emojis: [] },
  created_at: '2026-09-01T12:00:00Z',
  mentions: [],
  emojis: [],
}

function GhostWrapper({ ghostId = null, inPanel = false, children }) {
  return (
    <Provider>
      <GhostContext.Provider value={{ ghostStatusId: ghostId, inPanel }}>
        {children}
      </GhostContext.Provider>
    </Provider>
  )
}

function renderGhostRow(ghostId = null, inPanel = false) {
  return render(
    <GhostWrapper ghostId={ghostId} inPanel={inPanel}>
      <PostRow
        post={ghostPost}
        instanceUrl="http://test.example.com"
        token="tk"
        onUpdate={() => {}}
        onOpenThread={() => {}}
        onComposeReply={() => {}}
        onOpenLightbox={() => {}}
        onOpenProfile={() => {}}
        onQuote={() => {}}
        currentAccountId="u1"
      />
    </GhostWrapper>
  )
}

describe('PostRow ghost placeholder', () => {
  it('ghosts when ghostStatusId matches the post id', () => {
    renderGhostRow(ghostPost.id)
    const row = document.querySelector('.post-row')
    expect(row).not.toBeNull()
    expect(row.className).toContain('ghost')
  })

  it('shows the "Viewing in thread" label when ghosted', () => {
    renderGhostRow(ghostPost.id)
    expect(screen.getByText(/Viewing in thread/)).toBeTruthy()
  })

  it('does not ghost when ghostStatusId is a different post', () => {
    renderGhostRow('other-id')
    const row = document.querySelector('.post-row')
    expect(row).not.toBeNull()
    expect(row.className).not.toContain('ghost')
    expect(screen.queryByText(/Viewing in thread/)).toBeNull()
  })

  it('does not ghost when ghostStatusId is null', () => {
    renderGhostRow(null)
    const row = document.querySelector('.post-row')
    expect(row).not.toBeNull()
    expect(row.className).not.toContain('ghost')
  })

  it('does not ghost when the row is inside the panel', () => {
    renderGhostRow(ghostPost.id, true)
    const row = document.querySelector('.post-row')
    expect(row).not.toBeNull()
    expect(row.className).not.toContain('ghost')
  })

  it('reacts instantly when ghostStatusId switches between two posts', () => {
    const postA = { ...ghostPost, id: 'post-a' }
    const postB = { ...ghostPost, id: 'post-b' }
    const { rerender } = render(
      <GhostWrapper ghostId="post-a">
        <PostRow
          post={postA}
          instanceUrl="http://test.example.com"
          token="tk"
          onUpdate={() => {}}
          onOpenThread={() => {}}
          onComposeReply={() => {}}
          onOpenLightbox={() => {}}
          onOpenProfile={() => {}}
          onQuote={() => {}}
          currentAccountId="u1"
        />
      </GhostWrapper>
    )
    expect(document.querySelector('.post-row').className).toContain('ghost')

    // Switch ghost to post-b (the same component renders post-b now)
    rerender(
      <GhostWrapper ghostId="post-b">
        <PostRow
          post={postB}
          instanceUrl="http://test.example.com"
          token="tk"
          onUpdate={() => {}}
          onOpenThread={() => {}}
          onComposeReply={() => {}}
          onOpenLightbox={() => {}}
          onOpenProfile={() => {}}
          onQuote={() => {}}
          currentAccountId="u1"
        />
      </GhostWrapper>
    )
    // post-b should be ghosted immediately (no 300ms timer)
    expect(document.querySelector('.post-row').className).toContain('ghost')
  })
})