import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ESCAPE_PRIORITY, registerEscapeHandler } from '../lib/escapeStack.js'
import { ThreadPanelHeader } from './ThreadPanel.jsx'

// The header owns the "cancel reply" affordance, so it also owns the
// Escape registration that cancels the panel's inline composer before
// the panel itself closes. These tests pin the layering against a
// stand-in panel-priority handler (what App registers for the panel).
const STATUS = { id: 's1', account: { id: 'a1', username: 'reika', display_name: 'Reika' }, content: 'hi' }

function renderHeader(panel, onCancelCompose) {
  return render(
    <ThreadPanelHeader
      panel={panel}
      onClose={() => {}}
      onCancelCompose={onCancelCompose}
    />
  )
}

describe('ThreadPanelHeader escape handling', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('cancels the inline reply without closing the panel', () => {
    const onCancelCompose = vi.fn()
    const closePanel = vi.fn()
    const unregister = registerEscapeHandler(ESCAPE_PRIORITY.panel, closePanel)
    try {
      renderHeader({ mode: 'thread', status: STATUS, composingStatusId: 's1' }, onCancelCompose)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(onCancelCompose).toHaveBeenCalledTimes(1)
      expect(closePanel).not.toHaveBeenCalled()
    } finally {
      unregister()
    }
  })

  it('falls through to the panel once the composer is gone', () => {
    const onCancelCompose = vi.fn()
    const closePanel = vi.fn()
    const unregister = registerEscapeHandler(ESCAPE_PRIORITY.panel, closePanel)
    try {
      const { rerender } = renderHeader({ mode: 'thread', status: STATUS, composingStatusId: 's1' }, onCancelCompose)

      // First press cancels the reply; the parent clears composingStatusId.
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onCancelCompose).toHaveBeenCalledTimes(1)

      rerender(
        <ThreadPanelHeader
          panel={{ mode: 'thread', status: STATUS }}
          onClose={() => {}}
          onCancelCompose={onCancelCompose}
        />
      )

      // Second press now belongs to the panel.
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onCancelCompose).toHaveBeenCalledTimes(1)
      expect(closePanel).toHaveBeenCalledTimes(1)
    } finally {
      unregister()
    }
  })

  it('stays out of the way when no inline composer is open', () => {
    const onCancelCompose = vi.fn()
    const closePanel = vi.fn()
    const unregister = registerEscapeHandler(ESCAPE_PRIORITY.panel, closePanel)
    try {
      renderHeader({ mode: 'thread', status: STATUS }, onCancelCompose)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(onCancelCompose).not.toHaveBeenCalled()
      expect(closePanel).toHaveBeenCalledTimes(1)
    } finally {
      unregister()
    }
  })
})
