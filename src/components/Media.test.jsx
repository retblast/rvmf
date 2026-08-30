import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { AppSettingsContext } from '../hooks'
import { ensureGifConverted } from '../lib/gif/convert.js'
import { Avatar } from './Media.jsx'

vi.mock('../lib/gif/convert.js', () => ({
  ensureGifConverted: vi.fn(),
  GIF_LARGE_BYTES: 5 * 1024 * 1024,
}))

const SRC = 'https://x.example/avatar.gif'
const STATIC = 'https://x.example/avatar.png'
const BLOB = new Blob(['webm'], { type: 'video/webm' })

function renderAvatar(props = {}, context = {}) {
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
      <Avatar name="Reka" src={SRC} staticSrc={STATIC} {...props} />
    </AppSettingsContext.Provider>
  )
}

describe('Avatar', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:gif-test')
    URL.revokeObjectURL = vi.fn()
    ensureGifConverted.mockReset()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the plain image when the feature is off', () => {
    const { container } = renderAvatar()
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(ensureGifConverted).not.toHaveBeenCalled()
  })

  it('converts avatars with the master toggle on and autoplays when hover is off', async () => {
    ensureGifConverted.mockResolvedValue({ blob: BLOB })
    const { container } = renderAvatar({}, { gifConversionEnabled: true })
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    const video = container.querySelector('video')
    expect(video.src).toContain('blob:gif-test')
    expect(video.autoplay).toBe(true)
    expect(video.muted).toBe(true)
    expect(video.loop).toBe(true)
    expect(video.hasAttribute('data-rvmf-animatable')).toBe(false)
  })

  it('plays converted avatars on hover when hover mode is on', async () => {
    ensureGifConverted.mockResolvedValue({ blob: BLOB })
    const { container } = renderAvatar(
      {},
      { gifConversionEnabled: true, gifHoverAnimate: true }
    )
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    const video = container.querySelector('video')
    expect(video.autoplay).toBe(false)
    expect(video.getAttribute('data-rvmf-animatable')).toBe('true')
    expect(video.getAttribute('poster')).toBe(STATIC)
  })

  it('remounts the avatar video when hover mode flips so autoplay resumes', async () => {
    ensureGifConverted.mockResolvedValue({ blob: BLOB })
    const { container, rerender } = renderAvatar(
      {},
      { gifConversionEnabled: true, gifHoverAnimate: true }
    )
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    const hoverVid = container.querySelector('video')
    expect(hoverVid.autoplay).toBe(false)

    rerender(
      <AppSettingsContext.Provider
        value={{ fetchClientMedia: false, gifConversionEnabled: true, gifIncludeLarge: false, gifHoverAnimate: false }}
      >
        <Avatar name="Reka" src={SRC} staticSrc={STATIC} />
      </AppSettingsContext.Provider>
    )
    const autoVid = container.querySelector('video')
    expect(autoVid).not.toBeNull()
    expect(autoVid).not.toBe(hoverVid)
    expect(autoVid.autoplay).toBe(true)
    expect(autoVid.hasAttribute('data-rvmf-animatable')).toBe(false)
  })

  it('stays on the static image while conversion is pending or skipped', async () => {
    ensureGifConverted.mockResolvedValue(null)
    const { container } = renderAvatar({}, { gifConversionEnabled: true })
    await waitFor(() => expect(ensureGifConverted).toHaveBeenCalled())
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('video')).toBeNull()
  })

  it('shows initials instead of nothing while a static-less avatar converts', async () => {
    ensureGifConverted.mockImplementation(() => new Promise(() => {}))
    const { container } = renderAvatar(
      { staticSrc: undefined },
      { gifConversionEnabled: true }
    )
    await waitFor(() => expect(ensureGifConverted).toHaveBeenCalled())
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(container.textContent).toContain('R') // initials overlay
  })
})