import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppSettingsContext } from '../hooks'
import { useTranslation } from './Post.jsx'

// The real translate module lazily pulls in Transformers.js (multi-GB model,
// WebGPU) — mock it so the hook's orchestration can be tested without that.
const translateText = vi.fn()
vi.mock('../lib/translate', () => ({
  translateText: (...args) => translateText(...args),
}))

function Provider({ children }) {
  return (
    <AppSettingsContext.Provider value={{ translationEnabled: true, translationProvider: 'nllb-wasm' }}>
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
      <button onClick={() => t.changeSource('fr')}>set-fr</button>
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

function setup(overrides = {}) {
  return render(<Harness status={{ ...status, ...overrides }} />, { wrapper: Provider })
}

beforeEach(() => {
  translateText.mockReset()
  // The hook refuses to run without WebGPU; satisfy that gate in jsdom so the
  // toggle reaches the translator.
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
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

  it('asks for a source language when there is no tag and no script guess', async () => {
    const user = userEvent.setup()
    setup({ language: null }) // Latin-only content -> no script guess

    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('phase').textContent).toBe('needs-source')
    expect(translateText).not.toHaveBeenCalled()
  })

  it('falls back to a script guess when the tag is missing', async () => {
    translateText.mockResolvedValue('ru: …')
    const user = userEvent.setup()
    // No language tag, but Cyrillic content -> should guess ru.
    setup({ language: null, content: '<p>Привет, как дела?</p>' })

    await user.click(screen.getByRole('button', { name: 'toggle' }))
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('done'))
    expect(screen.getByTestId('source').textContent).toBe('ru')
    expect(translateText).toHaveBeenCalledTimes(1)
  })

  it('lets the user override the detected source language', async () => {
    translateText.mockResolvedValue('fr: …')
    const user = userEvent.setup()
    setup({ language: 'es' }) // tag resolves es, but user forces French

    await user.click(screen.getByRole('button', { name: 'toggle' }))
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('done'))
    expect(translateText).toHaveBeenCalledTimes(1)

    // Switching the source while the translated view is up re-translates.
    await user.click(screen.getByRole('button', { name: 'set-fr' }))
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('done'))
    expect(screen.getByTestId('source').textContent).toBe('fr')
    expect(translateText).toHaveBeenCalledTimes(2)
  })
})
