import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleMediaProxy } from './scripts/media-proxy.mjs'

function mediaProxyPlugin() {
  return {
    name: 'media-proxy',
    configureServer(server) {
      server.middlewares.use('/media-proxy', (req, res) => {
        handleMediaProxy(req, res).catch(() => {
          // handleMediaProxy never throws out of its own paths, but guard
          // anyway so a stray rejection can't take the dev server down.
        })
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
