// OS/browser accent integration.
//
// The web platform's only window into the OS accent is the CSS system
// color keyword 'AccentColor'. Its weakness: browsers happily answer
// with their own hard-coded default blue when no accent propagates
// (Chromium on Linux without GTK theme integration, Windows before its
// accent is exposed to apps, ...). Applying that is worse than useless
// — it paints over our palette with a different default blue. So known
// defaults are treated as "no accent detected".

const DEFAULT_ACCENT_KEYS = new Set([
  '0,117,255', // Chromium default
  '0,120,215', // Windows 10
  '0,95,184', // Windows 11
  '0,99,229', // Edge
  '0,102,204', // Safari/macOS
])

function normalizeRgb(color) {
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color)
  if (!m) return null
  return `${Number(m[1])},${Number(m[2])},${Number(m[3])}`
}

function detectOsAccent() {
  try {
    const probe = document.createElement('span')
    probe.style.color = 'AccentColor'
    probe.style.display = 'none'
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    probe.remove()
    // Unsupported browsers yield '' or plain black — neither is an accent.
    if (!computed || computed === 'rgb(0, 0, 0)' || computed === 'rgba(0, 0, 0, 0)') {
      return null
    }
    return computed
  } catch {
    return null
  }
}

function foregroundFor(color) {
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color)
  if (!m) return '#ffffff'
  const [, r, g, b] = m.map(Number)
  // WCAG relative luminance approximation
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1b1b1b' : '#ffffff'
}

// Applies or removes the platform accent. Returns true when a real
// (non-default) accent was applied.
export function applyOsAccent(enabled) {
  const root = document.documentElement
  if (!enabled) {
    root.classList.remove('os-accent')
    root.style.removeProperty('--os-accent')
    root.style.removeProperty('--os-accent-fg')
    return false
  }
  const accent = detectOsAccent()
  const key = accent && normalizeRgb(accent)
  if (!key || DEFAULT_ACCENT_KEYS.has(key)) {
    root.classList.remove('os-accent')
    return false
  }
  root.classList.add('os-accent')
  root.style.setProperty('--os-accent', accent)
  root.style.setProperty('--os-accent-fg', foregroundFor(accent))
  return true
}

export function osAccentPreferred() {
  try {
    return localStorage.getItem('mitra-use-os-accent') !== 'false'
  } catch {
    return true
  }
}
