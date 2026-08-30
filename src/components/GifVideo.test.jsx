import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { AppSettingsContext } from '../hooks'
import { ensureGifConverted } from '../lib/gif/convert.js'
import { GifVideo } from './GifVideo.jsx'

vi.mock('../lib/gif/convert.js', () => ({
  ensureGifConverted: vi.fn(),
  GIF_LARGE_BYTES: 5 * 1024 * 1024,
}))

const SRC = 'https://x.example/dance.gif'
const STATIC = 'https://x.example/dance.png'

function renderGifVideo(props = {}, context = {}) {
  return render(
    <AppSettingsContext.Provider
      value={{
        fetchClientMedia: false,
        gifConversionEnabled: false,
        gifIncludeLarge: false,
        gifHoverAnimate: false,
        ...context,
      }}
    >
      <GifVideo src={SRC} staticSrc={STATIC} alt=":dance:" {...props} />
    </AppSettingsContext.Provider>
  )
}

describe('GifVideo', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:gif-test')
    URL.revokeObjectURL = vi.fn()
    ensureGifConverted.mockReset()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the plain image when the feature is off', () => {
    const { container } = renderGifVideo()
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(ensureGifConverted).not.toHaveBeenCalled()
  })

  it('renders an autoplay video once the conversion is ready', async () => {
    ensureGifConverted.mockResolvedValue({ blob: new Blob(['webm'], { type: 'video/webm' }) })
    const { container } = renderGifVideo({}, { gifConversionEnabled: true })
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    const video = container.querySelector('video')
    expect(video.src).toContain('blob:gif-test')
    expect(video.autoplay).toBe(true)
    expect(video.muted).toBe(true)
    expect(video.loop).toBe(true)
    expect(video.hasAttribute('data-rvmf-animatable')).toBe(false)
    ensureGifConverted.mockClear()
  })

  it('renders a paused, hover-animated video in hover mode', async () => {
    ensureGifConverted.mockResolvedValue({ blob: new Blob(['webm'], { type: 'video/webm' }) })
    const { container } = renderGifVideo(
      {},
      { gifConversionEnabled: true, gifHoverAnimate: true }
    )
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    const video = container.querySelector('video')
    expect(video.autoplay).toBe(false)
    expect(video.getAttribute('data-rvmf-animatable')).toBe('true')
    expect(video.getAttribute('poster')).toBe(STATIC)
  })

  it('stays on the static image while conversion is pending or skipped', async () => {
    ensureGifConverted.mockResolvedValue(null)
    const { container } = renderGifVideo({}, { gifConversionEnabled: true })
    await waitFor(() => expect(ensureGifConverted).toHaveBeenCalled())
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('video')).toBeNull()
  })

  it('renders the source image while a static-less conversion awaits', async () => {
    ensureGifConverted.mockResolvedValue(null)
    const { container } = renderGifVideo(
      { staticSrc: undefined },
      { gifConversionEnabled: true, gifHoverAnimate: true }
    )
    await waitFor(() => expect(ensureGifConverted).toHaveBeenCalled())
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toContain('dance.gif')
    expect(container.querySelector('video')).toBeNull()
  })

  it('attempts conversion for every surface even when hover is off', async () => {
    ensureGifConverted.mockResolvedValue(null)
    const { container } = renderGifVideo({}, { gifConversionEnabled: true })
    await waitFor(() => expect(ensureGifConverted).toHaveBeenCalled())
    expect(container.querySelector('img')).not.toBeNull()
  })
})