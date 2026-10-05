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

const SAME_INSTANCE_IMAGE = {
  id: 'att-si',
  type: 'image',
  url: 'https://x.example/original/photo.jpg',
  preview_url: 'https://x.example/preview/photo.jpg',
  description: 'Same-instance photo',
  meta: { mime_type: 'image/jpeg' },
}

function renderGrid(overrides = {}, attachments = [IMAGE], props = {}) {
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
      <MediaGrid attachments={attachments} onOpenLightbox={vi.fn()} sensitive={false} {...props} />
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

describe('MediaGrid same-instance proxy', () => {
  it('uses proxy URL for same-instance images (bypasses fetchClientMedia)', () => {
    mocks.useClientMedia.mockReturnValue({ blobUrl: 'blob:media-1', loading: false, error: false })
    const { container } = renderGrid({ fetchClientMedia: true }, [SAME_INSTANCE_IMAGE])
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    // Same-instance media should use proxy URL, not the blob URL
    expect(img.src).toContain('/media-proxy?url=')
    expect(img.src).not.toContain('blob:')
  })

  it('uses blob URL for remote images when fetchClientMedia is on', () => {
    mocks.useClientMedia.mockReturnValue({ blobUrl: 'blob:media-1', loading: false, error: false })
    const { container } = renderGrid({ fetchClientMedia: true })
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img.src).toContain('blob:')
  })
})

describe('MediaGrid CW reveal semantics', () => {
  beforeEach(() => {
    mocks.useClientMedia.mockReturnValue({ blobUrl: null, loading: false, error: false })
  })

  it('blurs sensitive media behind the overlay by default', () => {
    const { container } = renderGrid({}, [IMAGE], { sensitive: true })
    expect(container.querySelector('.media-grid').className).toContain('blurred')
    expect(container.querySelector('.media-cw-overlay')).not.toBeNull()
  })

  it('shows sensitive media without an overlay when the post-level CW gate is open', () => {
    const { container } = renderGrid({}, [IMAGE], { sensitive: true, cwRevealed: true })
    expect(container.querySelector('.media-grid').className).not.toContain('blurred')
    expect(container.querySelector('.media-cw-overlay')).toBeNull()
  })

  it('keeps the blur when the CW gate is open but always-sensitive is on', () => {
    const { container } = renderGrid({ alwaysSensitive: true }, [IMAGE], { sensitive: true, cwRevealed: true })
    expect(container.querySelector('.media-grid').className).toContain('blurred')
    expect(container.querySelector('.media-cw-overlay')).not.toBeNull()
  })
})
