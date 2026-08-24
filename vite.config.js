import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function mediaProxyPlugin() {
  return {
    name: 'media-proxy',
    configureServer(server) {
      server.middlewares.use('/media-proxy', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const targetUrl = url.searchParams.get('url')
          if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Missing url parameter')
            return
          }
          // Only remote http(s) resources are legitimate proxy targets.
          // Without this check the dev server is an open proxy (SSRF).
          let parsedTarget
          try {
            parsedTarget = new URL(targetUrl)
          } catch {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Invalid url parameter')
            return
          }
          if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Unsupported protocol')
            return
          }
          const headers = {}
          const auth = req.headers['authorization']
          if (auth) headers['Authorization'] = auth
          const proxyRes = await fetch(parsedTarget.toString(), {
            headers,
            redirect: 'follow',
          })
          // Client gave up while the upstream request was in flight.
          if (res.headersSent || res.destroyed) return
          const ct = proxyRes.headers.get('content-type') || 'application/octet-stream'
          res.writeHead(proxyRes.status, {
            'Content-Type': ct,
            'Access-Control-Allow-Origin': '*',
          })
          const body = await proxyRes.arrayBuffer()
          res.end(Buffer.from(body))
        } catch {
          // Spotty connections fail anywhere in here — including after
          // headers are already out (upstream dying mid-download).
          // Writing new headers at that point crashes the whole dev
          // server, so only send the 502 when it's still possible, and
          // otherwise just tear the socket down like any dead stream.
          if (res.headersSent || res.destroyed) {
            res.destroy()
            return
          }
          try {
            res.writeHead(502, { 'Content-Type': 'text/plain' })
            res.end('Proxy fetch failed')
          } catch {
            res.destroy()
          }
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
