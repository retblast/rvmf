import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './adwaita.css'

// Reads the OS/browser accent through the CSS Level-4 system color
// keyword 'AccentColor' (Chromium maps it to GTK/Windows settings,
// Firefox to the OS accent). Returns null when the platform doesn't
// expose one — the stylesheet defaults stay in charge.
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

// Pick readable foreground for buttons/badges drawn on the accent.
function foregroundFor(color) {
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color)
  if (!m) return '#ffffff'
  const [, r, g, b] = m.map(Number)
  // WCAG relative luminance approximation
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1b1b1b' : '#ffffff'
}

const osAccent = detectOsAccent()
if (osAccent) {
  const root = document.documentElement
  root.classList.add('os-accent')
  root.style.setProperty('--os-accent', osAccent)
  root.style.setProperty('--os-accent-fg', foregroundFor(osAccent))
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
