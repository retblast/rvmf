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
          const ct = proxyRes.headers.get('content-type') || 'application/octet-stream'
          res.writeHead(proxyRes.status, {
            'Content-Type': ct,
            'Access-Control-Allow-Origin': '*',
          })
          const body = await proxyRes.arrayBuffer()
          res.end(Buffer.from(body))
        } catch {
          res.writeHead(502, { 'Content-Type': 'text/plain' })
          res.end('Proxy fetch failed')
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
