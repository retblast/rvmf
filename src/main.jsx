import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { applyOsAccent, osAccentPreferred } from './lib/osAccent'
import './adwaita.css'

applyOsAccent(osAccentPreferred())

// PWA: register the service worker so the app installs and boots offline.
// Dev stays unregistered so the worker can't interfere with HMR and
// fresh-require cycles; server.mjs serves sw.js no-cache, so production
// picks up worker updates on the browser's own revalidation schedule.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
