import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { AppSettingsContext } from '../hooks'
import { MediaGrid } from './Media.jsx'

// Isolated from Media.test.jsx so the Avatar suite keeps the real hooks.
// Here we spy on the download path: a right-click that starts a download
// (or preventDefaults, killing the native menu) is a regression.
const mocks = vi.hoisted(() => ({
  useClientMedia: vi.fn(),
  downloadAttachment: vi.fn(),
}))
vi.mock('../hooks', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    useClientMedia: mocks.useClientMedia,
    downloadAttachment: mocks.downloadAttachment,
  }
})

const IMAGE = {
  id: 'att-1',
  type: 'image',
  url: 'https://files.example/original/photo.jpg',
  preview_url: 'https://files.example/preview/photo.jpg',
  description: 'A photo',
  meta: { mime_type: 'image/jpeg' },
}

function renderGrid(overrides = {}) {
  const context = {
    fetchClientMedia: false,
    instanceUrl: 'https://x.example',
    token: 'tok',
    alwaysSensitive: false,
    peekSpoilerMedia: false,
    gifConversionEnabled: false,
    gifIncludeLarge: false,
    gifHoverAnimate: false,
    ...overrides,
  }
  return render(
    <AppSettingsContext.Provider value={context}>
      <MediaGrid attachments={[IMAGE]} onOpenLightbox={vi.fn()} />
    </AppSettingsContext.Provider>
  )
}

beforeEach(() => {
  mocks.useClientMedia.mockReset()
  mocks.downloadAttachment.mockReset()
  mocks.downloadAttachment.mockResolvedValue(true)
})

describe('MediaGrid right-click', () => {
  it('keeps the native context menu on HTTP-sourced images', () => {
    mocks.useClientMedia.mockReturnValue({ blobUrl: null, loading: false, error: false })
    const { container } = renderGrid()
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img.src.startsWith('blob:')).toBe(false)

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    img.dispatchEvent(evt)

    expect(evt.defaultPrevented).toBe(false)
    expect(mocks.downloadAttachment).not.toHaveBeenCalled()
  })

  it('keeps the native context menu on blob-sourced images (fetch-client-media on)', () => {
    mocks.useClientMedia.mockReturnValue({ blobUrl: 'blob:media-1', loading: false, error: false })
    const { container } = renderGrid({ fetchClientMedia: true })
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img.src.startsWith('blob:')).toBe(true)

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    img.dispatchEvent(evt)

    // The old intercept fired downloadAttachment and preventDefault on the
    // default (blob) path; this must never come back.
    expect(evt.defaultPrevented).toBe(false)
    expect(mocks.downloadAttachment).not.toHaveBeenCalled()
  })
})
