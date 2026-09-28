import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// escapeStack keeps module-level state (the registry, the listener), so
// each test re-imports a fresh copy. Handlers registered by previous
// tests must be unregistered so their stale window listeners no-op.
async function freshStack() {
  vi.resetModules()
  return import('./escapeStack.js')
}

function pressEscape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
}

describe('escape stack', () => {
  let stack
  const cleanups = []

  beforeEach(async () => {
    stack = await freshStack()
  })

  afterEach(() => {
    while (cleanups.length) cleanups.pop()()
  })

  it('routes Escape to the highest-priority handler only', () => {
    const onClosePanel = vi.fn()
    const onCloseMenu = vi.fn()
    const onCloseMedia = vi.fn()
    cleanups.push(stack.registerEscapeHandler(stack.ESCAPE_PRIORITY.panel, onClosePanel))
    cleanups.push(stack.registerEscapeHandler(stack.ESCAPE_PRIORITY.menu, onCloseMenu))
    cleanups.push(stack.registerEscapeHandler(stack.ESCAPE_PRIORITY.media, onCloseMedia))

    const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    window.dispatchEvent(e)

    expect(onCloseMedia).toHaveBeenCalledTimes(1)
    expect(onCloseMenu).not.toHaveBeenCalled()
    expect(onClosePanel).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(true)
  })

  it('breaks priority ties toward the most recently registered handler', () => {
    const first = vi.fn()
    const second = vi.fn()
    cleanups.push(stack.registerEscapeHandler(stack.ESCAPE_PRIORITY.menu, first))
    cleanups.push(stack.registerEscapeHandler(stack.ESCAPE_PRIORITY.menu, second))

    pressEscape()

    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('ignores presses already consumed by an earlier handler', () => {
    const handler = vi.fn()
    cleanups.push(stack.registerEscapeHandler(stack.ESCAPE_PRIORITY.media, handler))

    // Simulate a text-area affordance (emoji autocomplete) consuming the
    // press during the capture/bubble path before it reaches the window
    // listener.
    const consumer = (e) => e.preventDefault()
    window.addEventListener('keydown', consumer, true)
    pressEscape()
    window.removeEventListener('keydown', consumer, true)

    expect(handler).not.toHaveBeenCalled()
  })

  it('stops handling after unregistering', () => {
    const handler = vi.fn()
    const unregister = stack.registerEscapeHandler(stack.ESCAPE_PRIORITY.media, handler)
    unregister()
    unregister() // idempotent

    pressEscape()

    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores keys other than Escape', () => {
    const handler = vi.fn()
    cleanups.push(stack.registerEscapeHandler(stack.ESCAPE_PRIORITY.menu, handler))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    expect(handler).not.toHaveBeenCalled()
  })
})
