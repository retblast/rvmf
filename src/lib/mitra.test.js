import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchAllPendingFollowAccountIds } from './mitra.js'

// The server publishes the next-page cursor only via the Link header,
// which plain apiFetch discards. These tests confirm the paginating
// helper follows every page and unions the account ids, so a pending
// request beyond the first page is never misread as already-handled.
function mockFetchResponse({ body, link }) {
  const headers = new Headers()
  if (link) headers.set('Link', link)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers,
    json: async () => body,
  }
}

// Capture the requests the helper makes so tests can assert the cursor.
const requests = []
afterEach(() => {
  vi.restoreAllMocks()
  requests.length = 0
})

function installFetchMock(pages) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url) => {
    const url = new URL(String(_url))
    const params = url.searchParams
    requests.push({ max_id: params.get('max_id'), limit: params.get('limit') })
    const idx = requests.length - 1
    const page = pages[Math.min(idx, pages.length - 1)]
    return mockFetchResponse(page)
  })
}

// A real Next-Link only accompanies a full page (Mitra emits it only when
// the page has exactly PAGE_SIZE items), matching the source's get_last_item.
const nextLink = (id) =>
  `<https://x.example/api/v1/follow_requests?limit=80&max_id=${id}>; rel="next"`
const fullPage = (start, n = 80) => Array.from({ length: n }, (_, i) => ({ id: String(start + i) }))

describe('fetchAllPendingFollowAccountIds', () => {
  it('returns ids from a single partial page with no Link header (terminates)', async () => {
    installFetchMock([
      { body: [{ id: 'a' }, { id: 'b' }], link: null },
    ])
    const ids = await fetchAllPendingFollowAccountIds('https://x.example', 'tok')
    expect([...ids].sort()).toEqual(['a', 'b'])
    expect(requests).toHaveLength(1)
    expect(requests[0].max_id).toBeNull()
    expect(requests[0].limit).toBe('80')
  })

  it('walks the Link header to the next page and unions every id', async () => {
    installFetchMock([
      { body: fullPage(1), link: nextLink(80) },
      { body: [{ id: '81' }], link: null },
    ])
    const ids = await fetchAllPendingFollowAccountIds('https://x.example', 'tok')
    expect(ids.size).toBe(81)
    // every id from 1..80 plus 81
    for (let i = 1; i <= 81; i++) expect(ids.has(String(i))).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[0].max_id).toBeNull()
    expect(requests[1].limit).toBe('80')
    expect(requests[1].max_id).toBe('80')
  })

  it('stops cleanly when the last page is short and has no next link', async () => {
    installFetchMock([
      { body: fullPage(1), link: nextLink(80) },
      { body: [{ id: '81' }, { id: '82' }], link: null },
    ])
    const ids = await fetchAllPendingFollowAccountIds('https://x.example', 'tok')
    expect(ids.size).toBe(82)
    expect(requests).toHaveLength(2)
    expect(requests[1].max_id).toBe('80')
  })
})
