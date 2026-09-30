import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTimeline } from './useTimeline.js'

vi.mock('./lib/mitra', () => ({
  default: {},
  fetchHomeTimeline: vi.fn(),
  updateMarker: vi.fn(() => Promise.resolve()),
}))

import * as mitra from './lib/mitra'

const SESSION = { instanceUrl: 'https://x.example', token: 'tk' }

function status(id, reblogId = null) {
  return { id, reblog: reblogId ? { id: reblogId } : null }
}

beforeEach(() => {
  mitra.fetchHomeTimeline.mockReset()
})

describe('useTimeline pagination dedupe', () => {
  it('does not append rows already mounted (by id or reblog target)', async () => {
    // First page: a plain post and a boost wrapper
    mitra.fetchHomeTimeline.mockResolvedValueOnce([status('p1'), status('b1', 'p9')])
    const { result } = renderHook(() => useTimeline(SESSION, { view: 'home', tier: 'narrow' }))
    await waitFor(() => expect(result.current.timeline).toHaveLength(2))

    // Second page re-serves p1 (shifted back into range) plus a boost of
    // the already-mounted p9 and one genuinely new post.
    mitra.fetchHomeTimeline.mockResolvedValueOnce([status('p1'), status('b2', 'p9'), status('p2')])
    await act(async () => { await result.current.loadMoreTimeline() })

    const ids = result.current.timeline.map((s) => s.id)
    expect(ids).toEqual(['p1', 'b1', 'p2'])
  })

  it('keeps the pagination cursor on the raw last status even when dedupe drops rows', async () => {
    // Pages must be 10+ rows: a short page legitimately marks the feed
    // end (hasMore=false) and further loadMore calls are guarded out.
    const pad = (n) => Array.from({ length: n }, (_, i) => status(`filler-${i}`))
    mitra.fetchHomeTimeline.mockResolvedValueOnce([status('p1'), ...pad(9)])
    const { result } = renderHook(() => useTimeline(SESSION, { view: 'home', tier: 'narrow' }))
    await waitFor(() => expect(result.current.timeline).toHaveLength(10))

    mitra.fetchHomeTimeline.mockResolvedValueOnce([status('p1'), status('p2'), ...pad(8)])
    await act(async () => { await result.current.loadMoreTimeline() })
    // p1 dropped as a duplicate; the cursor still moved to the page's
    // true last row. A third page pages forward from there, not from
    // what survived dedupe.
    mitra.fetchHomeTimeline.mockResolvedValueOnce([status('p3'), ...pad(9)])
    await act(async () => { await result.current.loadMoreTimeline() })
    const ids = result.current.timeline.map((s) => s.id)
    expect(ids).toContain('p2')
    expect(ids).toContain('p3')
  })
})
