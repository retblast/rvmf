import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import net from 'node:net'
import { handleMediaProxy } from './scripts/media-proxy.mjs'
import { MAX_PORT, nextPort, portClimbedNotice } from './src/lib/port-utils.js'

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

// True only when the OS lets us bind `port` on `host` right now. The server
// we create is closed immediately; the check is advisory (there is still a
// tiny race between probe and Vite's real bind), but preview has no
// error-driven climb of its own, so this is the best honest signal we have.
function isPortFree(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, host)
  })
}

async function resolvePreviewPort(previewConfig, host) {
  const wanted = previewConfig.port ?? 4173
  // preview.strictPort: true means the user explicitly asked to fail hard
  // when the port is taken — respect that instead of climbing.
  if (previewConfig.strictPort) return wanted
  let port = wanted
  while (!(await isPortFree(port, host))) {
    const next = nextPort(port)
    if (next === null || next > MAX_PORT) {
      console.error(
        `Port ${port} is in use and no free port is available in the valid range.`
      )
      return wanted
    }
    console.log(portClimbedNotice(port, next))
    port = next
  }
  return port
}

// The dev server auto-increments its port (strictPort: false) and Vite
// prints the resolved address itself, but preview does NOT climb — with an
// occupied port it merely prints the configured URL while the other process
// actually owns the socket. This plugin makes preview behave like dev:
// pre-flight the configured port, climb to a genuinely free one, print a
// notice and the true bound port.
function portNoticePlugin() {
  function attach(server, kind) {
    const httpServer = server.httpServer
    if (!httpServer) return
    httpServer.on('listening', () => {
      const addr = httpServer.address()
      const port = addr && typeof addr === 'object' ? addr.port : null
      console.log(`rvmf ${kind} server listening on http://localhost:${port}`)
    })
  }
  return {
    name: 'port-notice',
    configureServer(server) {
      attach(server, 'dev')
    },
    async configurePreviewServer(server) {
      const resolved = await resolvePreviewPort(
        server.config.preview,
        server.config.preview.host || 'localhost'
      )
      if (resolved !== (server.config.preview.port ?? 4173)) {
        server.config.preview.port = resolved
        console.log(`rvmf preview using port ${resolved}`)
      }
      attach(server, 'preview')
    },
  }
}

export default defineConfig({
  plugins: [react(), mediaProxyPlugin(), portNoticePlugin()],
  server: {
    port: 5173,
    // Auto-climb to the next free port instead of failing hard when 5173 is
    // already taken by a running instance. Vite handles the climb; the
    // plugin above logs which port we landed on.
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
})
