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

describe('media proxy SSRF guards', () => {
  it('refuses loopback and private IPv4 targets without fetching', async () => {
    for (const target of [
      'http://127.0.0.1/media/x.png',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://172.16.0.1/',
      'http://100.64.0.1/',
      'http://0.0.0.1/',
    ]) {
      let fetched = false
      const res = await proxyHeaders(target, async () => { fetched = true; throw new Error('should not fetch') })
      expect(res.status, target).toBe(400)
      expect(fetched, target).toBe(false)
    }
  })

  it('refuses private IPv6 targets including v4-mapped', async () => {
    for (const target of ['http://[::1]/x', 'http://[::ffff:127.0.0.1]/x', 'http://[fe80::1]/x', 'http://[fd12::1]/x']) {
      const res = await proxyHeaders(target, async () => { throw new Error('should not fetch') })
      expect(res.status, target).toBe(400)
    }
  })

  it('refuses .localhost names', async () => {
    const res = await proxyHeaders('http://instance.localhost/media/x.png', async () => { throw new Error('should not fetch') })
    expect(res.status).toBe(400)
  })

  it('still proxies public literal IPs', async () => {
    const res = await proxyHeaders('http://93.184.216.34/avatar', fetchReturning(200, 'image/png'))
    expect(res.status).toBe(200)
    expect(res.headers['Content-Type']).toBe('image/png')
  })

  it('allows private targets when the caller opts in (dev server)', async () => {
    const res = mockRes()
    await handleMediaProxy(mockReq('http://127.0.0.1:8383/media/a.png'), res, {
      fetchImpl: fetchReturning(200, 'image/png'),
      allowPrivate: true,
    })
    expect(res.status).toBe(200)
  })

  it('re-validates every redirect hop — a public first hop cannot bounce to a private host', async () => {
    let calls = 0
    const res = await proxyHeaders('http://93.184.216.34/hop', async () => {
      calls++
      if (calls === 1) {
        return {
          status: 302,
          headers: new Map(Object.entries({ location: 'http://169.254.169.254/latest/' })),
        }
      }
      throw new Error('should not fetch the private hop')
    })
    expect(res.status).toBe(400)
    expect(calls).toBe(1)
  })

  it('follows safe redirects and derives the filename from the final URL', async () => {
    let calls = 0
    const res = await proxyHeaders('http://93.184.216.34/hop', async () => {
      calls++
      if (calls === 1) {
        return {
          status: 302,
          headers: new Map(Object.entries({ location: 'http://93.184.216.34/original/cat.png' })),
        }
      }
      return (await fetchReturning(200, 'image/png'))()
    })
    expect(res.status).toBe(200)
    expect(res.headers['Content-Disposition']).toContain('cat.png')
  })

  it('gives up on redirect chains longer than five hops', async () => {
    let calls = 0
    const res = await proxyHeaders('http://93.184.216.34/hop', async () => {
      calls++
      return { status: 302, headers: new Map(Object.entries({ location: 'http://93.184.216.34/hop' })) }
    })
    expect(res.status).toBe(502)
    expect(calls).toBe(6)
  })
})
