import { describe, it, expect, vi, afterEach } from 'vitest'
import { attachmentDownloadUrls, filenameForAttachment, downloadAttachment } from './hooks.js'

// Media downloads reuse the dev media proxy and the same credential guard
// as the display pipeline. These tests pin down the URL precedence, the
// derived file names, and that HTML error bodies are never saved.

function mockFetchResponse({ ok, contentType, body, status = 200 }) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: {
      get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    blob: async () => new Blob([body], { type: contentType }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

// Install the minimal mocks a download touches. jsdom builds real anchor
// elements fine, so only the object-URL lifecycle is stubbed to keep the
// harness simple; the download itself (a real anchor click in jsdom) is left
// to the browser-path the production code relies on.
function installDownloadDom() {
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => `blob:${blob && blob.type}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
}

describe('attachmentDownloadUrls', () => {
  it('prefers the display url, then origin, then Mitra fallback', () => {
    const urls = attachmentDownloadUrls({
      url: 'https://inst.example/file.jpg',
      remote_url: 'https://origin.example/file.jpg',
      _remote_fallback: 'https://origin.example/mirror.jpg',
    })
    expect(urls).toEqual([
      'https://inst.example/file.jpg',
      'https://origin.example/file.jpg',
      'https://origin.example/mirror.jpg',
    ])
  })

  it('drops empty candidates and dedupes, preserving order', () => {
    const urls = attachmentDownloadUrls({
      url: 'https://inst.example/a.jpg',
      remote_url: 'https://inst.example/a.jpg',
    })
    expect(urls).toEqual(['https://inst.example/a.jpg'])
  })
})

describe('filenameForAttachment', () => {
  it('maps a known mime to its extension', () => {
    expect(filenameForAttachment({ id: '123' }, 'image/png')).toBe('123.png')
  })

  it('falls back to the attachment type extension for unknown media', () => {
    expect(filenameForAttachment({ id: '1', type: 'image' }, 'image/x-unknown')).toBe('1.jpg')
    expect(filenameForAttachment({ id: '2', type: 'video' }, 'video/whatever')).toBe('2.bin')
  })

  it('sanitizes ids with unsafe characters', () => {
    expect(filenameForAttachment({ id: 'a/b:c' }, 'image/jpeg')).toBe('a_b_c.jpg')
  })

  it('falls back to a neutral base when no id is present', () => {
    expect(filenameForAttachment({}, 'image/webp')).toBe('media.webp')
  })
})

describe('downloadAttachment', () => {
  it('saves the blob through the media proxy', async () => {
    installDownloadDom()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ ok: true, contentType: 'image/jpeg', body: 'bytes' })
    )

    const ok = await downloadAttachment(
      { id: '99', url: 'https://inst.example/pic.jpg' },
      { instanceUrl: 'https://inst.example', token: 'abc' }
    )

    expect(ok).toBe(true)
    // Goes through the proxy, not the raw url.
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/media-proxy\?url=/)
    // Sends the bearer only to the user's own instance.
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer abc')
  })

  it('does not leak the token to third-party hosts', async () => {
    installDownloadDom()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ ok: true, contentType: 'image/jpeg', body: 'bytes' })
    )

    const ok = await downloadAttachment(
      // remote post: url is on their host, not ours
      { id: '9', url: 'https://origin.example/pic.jpg' },
      { instanceUrl: 'https://inst.example', token: 'abc' }
    )

    expect(ok).toBe(true)
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.Authorization).toBeUndefined()
  })

  it('refuses to save an HTML error body and tries the next url', async () => {
    installDownloadDom()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockFetchResponse({ ok: true, contentType: 'text/html', body: '<html></html>' }))
      .mockResolvedValueOnce(mockFetchResponse({ ok: true, contentType: 'image/jpeg', body: 'bytes' }))

    const ok = await downloadAttachment(
      {
        id: '5',
        url: 'https://inst.example/broken.jpg',
        _remote_fallback: 'https://origin.example/real.jpg',
      },
      { instanceUrl: 'https://inst.example', token: 'abc' }
    )

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns false when every candidate url fails', async () => {
    installDownloadDom()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ ok: false, contentType: 'text/plain', status: 404 })
    )

    const ok = await downloadAttachment(
      { id: '7', url: 'https://inst.example/missing.jpg' },
      { instanceUrl: 'https://inst.example', token: 'abc' }
    )

    expect(ok).toBe(false)
  })
})
