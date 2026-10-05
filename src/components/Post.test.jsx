import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppSettingsContext, GhostContext } from '../hooks'
import { maskAccount } from '../lib/privacy.js'
import { useTranslation, PostRow, QuoteCard } from './Post.jsx'

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

function Provider({ children, provider = 'qwen-cpu', mask }) {
  return (
    <AppSettingsContext.Provider value={{ translationEnabled: true, translationProvider: provider, mask }}>
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

// ---------------------------------------------------------------------------
// "In reply to" context line — only for actual replies
// ---------------------------------------------------------------------------

function renderPlainRow(post) {
  return render(
    <GhostWrapper>
      <PostRow
        post={post}
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

describe('PostRow reply context line', () => {
  const bob = { id: 'u2', acct: 'bob', username: 'bob' }

  it('does not render for a top-level post that merely tags someone', () => {
    renderPlainRow({
      ...ghostPost,
      content: '<p>@bob check this out</p>',
      mentions: [bob],
    })
    expect(document.querySelector('.post-reply-context')).toBeNull()
  })

  it('renders for an actual reply', () => {
    renderPlainRow({
      ...ghostPost,
      content: '<p>@bob agreed</p>',
      mentions: [bob],
      in_reply_to_id: 'p0',
      in_reply_to_account_id: 'u2',
    })
    expect(screen.getByText(/In reply to/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Subject titles — status.title heads the post, always visible
// ---------------------------------------------------------------------------

describe('PostRow subject titles', () => {
  it('renders a post title above the body', () => {
    renderPlainRow({ ...ghostPost, title: 'Big news' })
    const title = document.querySelector('.post-title')
    expect(title).not.toBeNull()
    expect(title.textContent).toBe('Big news')
  })

  it('renders nothing when the post has no title', () => {
    renderPlainRow(ghostPost)
    expect(document.querySelector('.post-title')).toBeNull()
  })

  it('ignores whitespace-only titles', () => {
    renderPlainRow({ ...ghostPost, title: '   ' })
    expect(document.querySelector('.post-title')).toBeNull()
  })
})

describe('QuoteCard subject titles', () => {
  it('renders the quoted post title above its text', () => {
    render(
      <Provider>
        <QuoteCard status={{ ...ghostPost, title: 'Quoted headline' }} instanceUrl="http://test.example.com" onOpenThread={() => {}} />
      </Provider>
    )
    const title = document.querySelector('.quote-card .post-title')
    expect(title).not.toBeNull()
    expect(title.textContent).toBe('Quoted headline')
  })
})


// ---------------------------------------------------------------------------
// Content warnings — spoiler_text collapses the post behind a banner
// ---------------------------------------------------------------------------

describe('PostRow content warnings', () => {
  const cwPost = {
    ...ghostPost,
    spoiler_text: 'spoilers for the ending',
    sensitive: true,
  }

  it('shows the banner with the spoiler text and hides the body while collapsed', () => {
    renderPlainRow(cwPost)
    expect(screen.getByText(/spoilers for the ending/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Show more/ })).toBeTruthy()
    expect(screen.queryByText('ghost test post')).toBeNull()
    expect(document.querySelector('.media-grid')).toBeNull()
  })

  it('reveals the body and media on click, offering Show less', async () => {
    const user = userEvent.setup()
    renderPlainRow({ ...cwPost, media_attachments: [] })
    await user.click(screen.getByRole('button', { name: /Show more/ }))
    expect(screen.getByText('ghost test post')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Show less/ })).toBeTruthy()
  })

  it('re-hides the body on a second click', async () => {
    const user = userEvent.setup()
    renderPlainRow(cwPost)
    await user.click(screen.getByRole('button', { name: /Show more/ }))
    await user.click(screen.getByRole('button', { name: /Show less/ }))
    expect(screen.queryByText('ghost test post')).toBeNull()
  })

  it('renders no banner for posts without a content warning', () => {
    renderPlainRow(ghostPost)
    expect(document.querySelector('.post-cw')).toBeNull()
    expect(screen.getByText('ghost test post')).toBeTruthy()
  })

  it('starts expanded when expand-all is enabled', () => {
    render(
      <AppSettingsContext.Provider value={{ translationEnabled: true, translationProvider: 'qwen-cpu', expandAllContentWarnings: true }}>
        <PostRow
          post={cwPost}
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
      </AppSettingsContext.Provider>
    )
    expect(screen.getByText('ghost test post')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Show less/ })).toBeTruthy()
  })
})

describe('PostRow privacy masking', () => {
  const realMask = (account) => maskAccount(account, 'u1', true)

  function renderPrivacyRow() {
    return render(
      <Provider mask={realMask}>
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
      </Provider>
    )
  }

  it('masks the author when the row is the current user', () => {
    renderPrivacyRow()
    expect(screen.getByText('You')).toBeTruthy()
    expect(screen.getByText('@you')).toBeTruthy()
    expect(screen.queryByText('Alice')).toBeNull()
    expect(screen.queryByText('@alice')).toBeNull()
  })

  it('leaves other authors untouched', () => {
    const bobPost = { ...ghostPost, account: { id: 'u2', display_name: 'Bob', acct: 'bob', avatar: '', emojis: [] } }
    render(
      <Provider mask={realMask}>
        <PostRow
          post={bobPost}
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
      </Provider>
    )
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.getByText('@bob')).toBeTruthy()
  })

  it('masks the booster line when you boosted the post', () => {
    const boost = { id: 'boost-1', reblog: { ...ghostPost, id: 'inner' }, account: { id: 'u1', display_name: 'Alice', acct: 'alice', emojis: [] } }
    render(
      <Provider mask={realMask}>
        <PostRow
          post={boost}
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
      </Provider>
    )
    expect(screen.getByText(/You boosted/)).toBeTruthy()
    expect(screen.queryByText(/Alice boosted/)).toBeNull()
  })
})
