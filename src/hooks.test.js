import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { attachmentDownloadUrls, filenameForAttachment, downloadAttachment, useComposeDraft, usePullToRefresh, useInstanceFavicon } from './hooks.js'
import { loadDraft, clearDraft } from './lib/drafts.js'

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

  it('uses the original filename extracted from the Mastodon url path', () => {
    const att = {
      id: '111',
      url: 'https://files.example.org/media_attachments/files/111/123/original/57859aede991da25.jpeg',
    }
    expect(filenameForAttachment(att, 'image/jpeg')).toBe('57859aede991da25.jpeg')
  })

  it('uses the real name from server-extended meta.original.file_name', () => {
    const att = {
      id: '111',
      url: 'https://files.example.org/media_attachments/files/111/123/original/abc.jpeg',
      meta: { original: { file_name: 'vacation photo.png' } },
    }
    expect(filenameForAttachment(att, 'image/png')).toBe('vacation photo.png')
  })

  it('prefers server-extended name over the url path filename', () => {
    const att = {
      id: '111',
      url: 'https://files.example.org/media_attachments/files/111/123/original/abc.jpeg',
      file_name: 'sunset.png',
    }
    expect(filenameForAttachment(att, 'image/png')).toBe('sunset.png')
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

  it('uses an existing blob URL without re-fetching', async () => {
    installDownloadDom()
    const blob = new Blob(['bytes'], { type: 'image/jpeg' })
    const blobUrl = 'blob:http://localhost/test'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        blob: async () => blob,
      })
      // No more calls expected — existingBlobUrl should short-circuit.

    const ok = await downloadAttachment(
      { id: '99', url: 'https://inst.example/pic.jpg' },
      { instanceUrl: 'https://inst.example', token: 'abc' },
      blobUrl
    )

    expect(ok).toBe(true)
    // Only the blob URL fetch should have happened; the normal media fetch
    // pipeline should not have been invoked.
    expect(fetchMock.mock.calls.length).toBe(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(blobUrl)
  })
})

// Draft-key switching: when the composer starts addressing a different
// reply/quote/group target mid-flight, the hook must keep the old draft
// under the old key (never clobber the new key with stale text) and load
// whatever belongs to the new key.
describe('useComposeDraft draft-key switching', () => {
  const initial = { text: '', visibility: 'public' }
  const keyA = 'rvmf:draft:reply:a'
  const keyB = 'rvmf:draft:reply:b'

  beforeEach(() => {
    clearDraft(keyA)
    clearDraft(keyB)
  })

  afterEach(() => {
    clearDraft(keyA)
    clearDraft(keyB)
  })

  it('saves the current draft under the old key and resets to the new initial', () => {
    const { result, rerender } = renderHook(({ k }) => useComposeDraft(k, initial), {
      initialProps: { k: keyA },
    })
    const [, setDraft] = result.current
    act(() => setDraft((s) => ({ ...s, text: 'reply to a' })))

    rerender({ k: keyB })

    expect(result.current[0].text).toBe('')
    expect(loadDraft(keyA).text).toBe('reply to a')
  })

  it('does not clobber the new key with the old draft text', () => {
    // The historical bug: the save-on-change effect fired with the stale
    // state under the NEW key. It was debounced, so advance past the
    // 500ms window to make sure nothing stale ever lands.
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ k }) => useComposeDraft(k, initial), {
      initialProps: { k: keyA },
    })
    act(() => result.current[1]((s) => ({ ...s, text: 'reply to a' })))

    rerender({ k: keyB })
    act(() => vi.advanceTimersByTime(1000))

    const storedB = loadDraft(keyB)
    expect(storedB === null || (storedB.text ?? '') === '').toBe(true)
    vi.useRealTimers()
  })

  it('restores an existing draft for the new key', () => {
    const { result, rerender } = renderHook(({ k }) => useComposeDraft(k, initial), {
      initialProps: { k: keyA },
    })
    act(() => result.current[1]((s) => ({ ...s, text: 'reply to a' })))

    rerender({ k: keyB })
    act(() => result.current[1]((s) => ({ ...s, text: 'reply to b' })))

    rerender({ k: keyA })
    expect(result.current[0].text).toBe('reply to a')
    expect(loadDraft(keyB).text).toBe('reply to b')
  })
})

// Wheel pull-to-refresh: fires on upward overscroll at the top
// (deltaY < 0), never on downward scrolling, and a scroll-away cancels a
// pending refresh. Time-based: the fire happens 250ms after the last
// wheel event, so fake timers drive it.
describe('usePullToRefresh wheel gesture', () => {
  const FIRE_DELAY = 250

  function setupHook() {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const onRefresh = vi.fn()
    const { result, unmount } = renderHook(() => usePullToRefresh(el, onRefresh))
    const wheel = (deltaY) => act(() => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }))
    })
    return { el, onRefresh, result, wheel, unmount }
  }

  it('fires after accumulated upward overscroll past the threshold', () => {
    vi.useFakeTimers()
    const { onRefresh, result, wheel } = setupHook()
    for (let i = 0; i < 4; i++) wheel(-100) // 400px of upward pull
    expect(result.current.pull).toBeGreaterThan(0)
    act(() => vi.advanceTimersByTime(FIRE_DELAY + 10))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('ignores downward wheeling at the top', () => {
    vi.useFakeTimers()
    const { onRefresh, result, wheel } = setupHook()
    for (let i = 0; i < 4; i++) wheel(100)
    act(() => vi.advanceTimersByTime(FIRE_DELAY + 10))
    expect(onRefresh).not.toHaveBeenCalled()
    expect(result.current.pull).toBe(0)
    vi.useRealTimers()
  })

  it('ignores upward wheeling when scrolled away from the top', () => {
    vi.useFakeTimers()
    const { el, onRefresh, wheel } = setupHook()
    el.scrollTop = 200
    for (let i = 0; i < 4; i++) wheel(-100)
    act(() => vi.advanceTimersByTime(FIRE_DELAY + 10))
    expect(onRefresh).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('cancels a pending refresh when the user scrolls down after pulling', () => {
    vi.useFakeTimers()
    const { el, onRefresh, wheel } = setupHook()
    wheel(-100)
    wheel(-100)
    el.scrollTop = 50 // user moved on before the fire delay elapsed
    wheel(-50)
    act(() => vi.advanceTimersByTime(FIRE_DELAY + 10))
    expect(onRefresh).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})


describe('useInstanceFavicon privacy mode', () => {
  const SESSION = { instanceUrl: 'https://secret.example', token: 'tk', account: { id: 'u1' } }

  function installFaviconLink() {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.href = '/icons/icon.svg'
    document.head.appendChild(link)
    return link
  }

  beforeEach(() => { document.title = 'rvmf' })

  it('names the instance in the tab by default', () => {
    const link = installFaviconLink()
    renderHook(() => useInstanceFavicon(SESSION, 0))
    expect(document.title).toBe('rvmf on secret.example')
    expect(link.href).toContain('secret.example/favicon.ico')
  })

  it('neutralizes the tab under privacy mode: plain title, app favicon', () => {
    const link = installFaviconLink()
    renderHook(() => useInstanceFavicon(SESSION, 0, true))
    expect(document.title).toBe('rvmf')
    expect(link.href).toContain('/icons/icon.svg')
  })

  it('stays neutral when logged out', () => {
    const link = installFaviconLink()
    renderHook(() => useInstanceFavicon(null, 0))
    expect(document.title).toBe('rvmf')
    expect(link.href).toContain('/icons/icon.svg')
  })
})
