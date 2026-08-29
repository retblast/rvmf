// Hover-to-play for converted GIF videos. Rows delegate one document
// listener instead of each video wiring its own mouseenter/mouseleave:
// reconstructed rows never leak handlers, and it stays agnostic to how
// many videos a row contains. Videos opt in via the data-rvmf-animatable
// attribute (set by the components that render hover-mode conversions).
export const GIF_HOVER_CONTAINER_SELECTOR = [
  '.post-row',
  '.reply-row',
  '.notif-row',
  '.dm-row',
  '.search-account-row',
  '.profile-view',
].join(', ')
export const GIF_HOVER_VIDEO_SELECTOR = 'video[data-rvmf-animatable]'

function playVideo(video) {
  // play() on an already-playing video is a no-op; it rejects when the
  // tab is backgrounded or autoplay policy objects. Looping hover videos
  // are a nicety, so swallow that.
  const promise = video.play()
  if (promise && typeof promise.catch === 'function') promise.catch(() => {})
}

function pauseVideo(video) {
  video.pause()
}

export function playAnimatableIn(container) {
  if (!container) return
  container.querySelectorAll(GIF_HOVER_VIDEO_SELECTOR).forEach(playVideo)
}

export function pauseAnimatableIn(container) {
  if (!container) return
  container.querySelectorAll(GIF_HOVER_VIDEO_SELECTOR).forEach(pauseVideo)
}

export function pauseAllAnimatable(root = document) {
  root.querySelectorAll(GIF_HOVER_VIDEO_SELECTOR).forEach(pauseVideo)
}

// Installs the delegation. Returns an uninstall function. Mouseout on the
// container fires before the next container's mouseover, so pausing the
// whole page before playing the entered row can't clobber it.
export function installGifHoverAnimator() {
  if (typeof document === 'undefined') return () => {}

  function onMouseOver(e) {
    const container = e.target && typeof e.target.closest === 'function'
      ? e.target.closest(GIF_HOVER_CONTAINER_SELECTOR)
      : null
    if (!container) return
    pauseAllAnimatable()
    playAnimatableIn(container)
  }

  function onMouseOut(e) {
    const container = e.target && typeof e.target.closest === 'function'
      ? e.target.closest(GIF_HOVER_CONTAINER_SELECTOR)
      : null
    if (!container) return
    pauseAnimatableIn(container)
  }

  document.addEventListener('mouseover', onMouseOver)
  document.addEventListener('mouseout', onMouseOut)
  return () => {
    document.removeEventListener('mouseover', onMouseOver)
    document.removeEventListener('mouseout', onMouseOut)
  }
}