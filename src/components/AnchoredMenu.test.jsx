import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { AnchoredMenu } from './AnchoredMenu.jsx'

// The menu's whole job is placement: it portals to <body> (out of reach
// of every overflow:hidden ancestor), picks the roomier side, and
// clamps into the viewport. These tests drive the geometry with mocked
// anchor rects against jsdom's default 1024x768 viewport.

const TRIGGER = { current: null }

function renderOpenMenuWithRect(rect) {
  const spy = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    top: rect.top, bottom: rect.bottom, left: rect.left ?? 0,
    right: (rect.left ?? 0) + 40, width: 40,
    height: rect.bottom - rect.top, x: rect.left ?? 0, y: rect.top, toJSON: () => rect,
  }))
  render(<div ref={(el) => { TRIGGER.current = el }} data-testid="anchor" />)
  render(
    <AnchoredMenu anchorRef={TRIGGER} open onClose={() => {}}>
      <button type="button">item</button>
    </AnchoredMenu>
  )
  return spy
}

function menuEl() {
  return document.body.querySelector('.boost-dropdown')
}

let originalRect

beforeEach(() => {
  originalRect = Element.prototype.getBoundingClientRect
})

// RTL's auto-cleanup unmounts the portals correctly; clearing
// body.innerHTML manually first would rip the portal nodes out from
// under React and blow up the unmount.
afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect
})

describe('AnchoredMenu placement', () => {
  it('opens below when the anchor sits near the top', () => {
    renderOpenMenuWithRect({ top: 20, bottom: 44 })
    expect(menuEl().style.top).toBe('48px') // bottom + gap
  })

  it('opens above when the anchor sits near the bottom', () => {
    renderOpenMenuWithRect({ top: 700, bottom: 724 })
    expect(Number(menuEl().style.top.replace('px', ''))).toBeLessThan(700)
  })

  it('clamps left into the viewport when the anchor starts off screen', () => {
    renderOpenMenuWithRect({ top: 20, bottom: 44, left: -60 })
    expect(menuEl().style.left).toBe('8px')
  })

  it('clamps right into the viewport', () => {
    renderOpenMenuWithRect({ top: 20, bottom: 44, left: 2000 })
    expect(menuEl().style.left).toBe('1016px') // 1024 - width(0) - 8
  })

  it('portals to the body, outside every clipping ancestor', () => {
    renderOpenMenuWithRect({ top: 20, bottom: 44 })
    expect(menuEl().closest('.timeline-list')).toBeNull()
    expect(menuEl().style.position).toBe('fixed')
    expect(menuEl().style.zIndex).toBe('95')
  })

  it('follows its anchor through scrolls instead of detaching', async () => {
    let rect = { top: 500, bottom: 524, left: 100 }
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      top: rect.top, bottom: rect.bottom, left: rect.left,
      right: rect.left + 40, width: 40, height: 24, x: rect.left, y: rect.top, toJSON: () => rect,
    }))
    render(<div ref={(el) => { TRIGGER.current = el }} data-testid="anchor" />)
    render(
      <AnchoredMenu anchorRef={TRIGGER} open onClose={() => {}}>
        <button type="button">item</button>
      </AnchoredMenu>
    )
    const firstTop = Number(menuEl().style.top.replace('px', ''))

    rect = { top: 300, bottom: 324, left: 100 }
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
      await new Promise((r) => setTimeout(r, 50)) // let the rAF land
    })
    await waitFor(() => {
      const secondTop = Number(menuEl().style.top.replace('px', ''))
      expect(secondTop).not.toBe(firstTop)
      expect(secondTop).toBeLessThan(firstTop)
    })
  })
})
