import { describe, it, expect } from 'vitest'
import { handleMediaProxy } from './media-proxy.mjs'

// The proxy renders responses on the rvmf origin, so its response
// headers are the XSS boundary: scriptable content types must never be
// navigable, and every response carries nosniff + a sandboxing CSP.

function mockRes() {
  return {
    headersSent: false, destroyed: false, writableEnded: false,
    status: null, headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true },
    end(body) { this.body = body; this.writableEnded = true },
    destroy() { this.destroyed = true },
  }
}

function mockReq(target) {
  return {
    url: '/media-proxy?url=' + encodeURIComponent(target),
    headers: {},
  }
}

function fetchReturning(status, contentType, body = 'x') {
  return async () => ({
    status,
    headers: new Map(Object.entries({ 'content-type': contentType })),
    async arrayBuffer() { return new TextEncoder().encode(body).buffer },
  })
}

const PUBLIC_TARGET = 'http://93.184.216.34/media/pic.png'

async function proxyHeaders(target, fetchImpl) {
  const res = mockRes()
  await handleMediaProxy(mockReq(target), res, { fetchImpl })
  return res
}

describe('media proxy response hardening', () => {
  it('forces a download for text/html — no same-origin render', async () => {
    const res = await proxyHeaders(PUBLIC_TARGET, fetchReturning(200, 'text/html; charset=utf-8', '<script>1</script>'))
    expect(res.headers['Content-Disposition']).toMatch(/^attachment/)
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(res.headers['Content-Security-Policy']).toContain('sandbox')
  })

  it('forces a download for SVG despite the image/ prefix — SVG carries scripts', async () => {
    const res = await proxyHeaders(PUBLIC_TARGET, fetchReturning(200, 'image/svg+xml', '<svg/>'))
    expect(res.headers['Content-Disposition']).toMatch(/^attachment/)
  })

  it('forces a download for XML and plain text too', async () => {
    for (const ct of ['application/xml', 'text/plain', 'application/json']) {
      const res = await proxyHeaders(PUBLIC_TARGET, fetchReturning(200, ct))
      expect(res.headers['Content-Disposition']).toMatch(/^attachment/)
    }
  })

  it('keeps renderable media inline, with save-as filename when derivable', async () => {
    const res = await proxyHeaders('http://93.184.216.34/original/cat.png', fetchReturning(200, 'image/png'))
    expect(res.headers['Content-Disposition']).toContain('attachment; filename="cat.png"')
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
  })

  it('leaves renderable media without a filename undispositioned', async () => {
    const res = await proxyHeaders('http://93.184.216.34/avatar', fetchReturning(200, 'image/jpeg'))
    expect(res.headers['Content-Disposition']).toBeUndefined()
  })

  it('still applies nosniff + CSP to renderable media', async () => {
    const res = await proxyHeaders('http://93.184.216.34/avatar', fetchReturning(200, 'image/jpeg'))
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'none'")
  })
})
