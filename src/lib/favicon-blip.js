const DOT_RADIUS = 4
const DOT_COLOR = '#ff3b30'

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load favicon'))
    img.src = src
  })
}

// Draws a small red dot on the favicon to indicate unread notifications.
// Returns a data: URL of the modified icon, or the original src on failure.
export async function blipFavicon(src, { unread }) {
  if (!unread) return src
  try {
    const img = await loadImage(src)
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const x = img.width - DOT_RADIUS
    const y = img.height - DOT_RADIUS
    // White border for contrast
    ctx.beginPath()
    ctx.arc(x, y, DOT_RADIUS + 1, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
    // Red dot
    ctx.beginPath()
    ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = DOT_COLOR
    ctx.fill()
    return canvas.toDataURL()
  } catch {
    return src
  }
}
