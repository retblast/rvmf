import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  installGifHoverAnimator,
  playAnimatableIn,
  pauseAnimatableIn,
} from './hoverAnimator.js'

// Real per-instance spies (not prototype mocks) so calls on one video
// never bleed into assertions about another.
function spyVideos(root = document) {
  const spies = new Map()
  for (const video of root.querySelectorAll('video')) {
    const play = vi.spyOn(video, 'play').mockResolvedValue()
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {})
    spies.set(video, { play, pause })
  }
  return spies
}

describe('hover animator', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('plays only data-rvmf-animatable videos inside the hovered container', () => {
    document.body.innerHTML = `
      <div class="post-row">
        <video data-rvmf-animatable></video>
        <video></video>
      </div>`
    const row = document.querySelector('.post-row')
    const spies = spyVideos(row)
    const [animatable, plain] = row.querySelectorAll('video')

    playAnimatableIn(row)
    expect(spies.get(animatable).play).toHaveBeenCalled()
    expect(spies.get(plain).play).not.toHaveBeenCalled()
  })

  it('pauses videos inside a container on exit', () => {
    document.body.innerHTML = `
      <div class="reply-row"><video data-rvmf-animatable></video></div>`
    const row = document.querySelector('.reply-row')
    const video = row.querySelector('video')
    const spies = spyVideos(row)

    pauseAnimatableIn(row)
    expect(spies.get(video).pause).toHaveBeenCalled()
  })

  it('delegates mouseover/mouseout at the document level', () => {
    const uninstall = installGifHoverAnimator()
    document.body.innerHTML = `
      <div class="post-row" id="row1"><video data-rvmf-animatable></video></div>
      <div class="post-row" id="row2"><video data-rvmf-animatable></video></div>`
    const row1 = document.querySelector('#row1')
    const row2 = document.querySelector('#row2')
    const spies = spyVideos()
    const v1 = row1.querySelector('video')
    const v2 = row2.querySelector('video')

    v1.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(spies.get(v1).play).toHaveBeenCalled()

    // Mouseout on the first row pauses it.
    v1.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    expect(spies.get(v1).pause).toHaveBeenCalled()

    // Entering a second row pauses everything first (v1 gets its second
    // pause-all), then plays its own.
    v2.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(spies.get(v1).pause).toHaveBeenCalledTimes(3)
    expect(spies.get(v2).play).toHaveBeenCalled()

    uninstall()
    v2.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    // Still exactly the two pause-all calls (one per mouseover); the
    // mouseout no longer reaches the listener.
    expect(spies.get(v2).pause).toHaveBeenCalledTimes(2)
  })

  it('ignores hover outside known containers', () => {
    installGifHoverAnimator()
    document.body.innerHTML = `<div class="unrelated"><video data-rvmf-animatable></video></div>`
    const video = document.querySelector('video')
    const spies = spyVideos()
    video.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(spies.get(video).play).not.toHaveBeenCalled()
  })
})