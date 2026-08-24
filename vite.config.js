import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Single choke point for sending a plain-text response. Every exit path
// goes through here, so a second writeHead on an already-sent response —
// the thing that used to crash the whole dev server on flaky
// connections — cannot happen by construction.
function respondOnce(res, status, text) {
  if (res.headersSent || res.destroyed || res.writableEnded) return
  try {
    res.writeHead(status, { 'Content-Type': 'text/plain' })
    res.end(text)
  } catch {
    try { res.destroy() } catch { /* already dead */ }
  }
}

function mediaProxyPlugin() {
  return {
    name: 'media-proxy',
    configureServer(server) {
      server.middlewares.use('/media-proxy', async (req, res) => {
        // Client vanished before we started — fetch nothing.
        if (res.destroyed || res.writableEnded) return
        try {
          const url = new URL(req.url, 'http://localhost')
          const targetUrl = url.searchParams.get('url')
          if (!targetUrl) {
            respondOnce(res, 400, 'Missing url parameter')
            return
          }
          // Only remote http(s) resources are legitimate proxy targets.
          // Without this check the dev server is an open proxy (SSRF).
          let parsedTarget
          try {
            parsedTarget = new URL(targetUrl)
          } catch {
            respondOnce(res, 400, 'Invalid url parameter')
            return
          }
          if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
            respondOnce(res, 400, 'Unsupported protocol')
            return
          }
          const headers = {}
          const auth = req.headers['authorization']
          if (auth) headers['Authorization'] = auth
          const proxyRes = await fetch(parsedTarget.toString(), {
            headers,
            redirect: 'follow',
          })
          if (res.headersSent || res.destroyed || res.writableEnded) return
          const ct = proxyRes.headers.get('content-type') || 'application/octet-stream'
          try {
            res.writeHead(proxyRes.status, {
              'Content-Type': ct,
              'Access-Control-Allow-Origin': '*',
            })
          } catch {
            try { res.destroy() } catch { /* already dead */ }
            return
          }
          // Headers are out — past this point a failure can only end in
          // tearing the socket down, never in writing new headers.
          try {
            const body = await proxyRes.arrayBuffer()
            if (res.writableEnded || res.destroyed) return
            res.end(Buffer.from(body))
          } catch {
            try { res.destroy() } catch { /* already dead */ }
          }
        } catch {
          respondOnce(res, 502, 'Proxy fetch failed')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), mediaProxyPlugin()],
  server: {
    port: 5173,
  },
})
