import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { applyOsAccent, osAccentPreferred } from './lib/osAccent'
import './adwaita.css'

applyOsAccent(osAccentPreferred())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
