import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScrollTopButton } from './ScrollTopButton.jsx'

// The floating "Back to top" pill: appears past a scroll threshold,
// hides on the wide tier (which has a headerbar button), and smooth-scrolls
// the main container on click.
function setup({ tier = 'medium' } = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  el.scrollTo = vi.fn()
  const utils = render(<ScrollTopButton scrollEl={el} tier={tier} />)
  const scrollTo = (top) => act(() => {
    Object.defineProperty(el, 'scrollTop', { value: top, writable: true, configurable: true })
    el.dispatchEvent(new Event('scroll'))
  })
  return { el, scrollTo, ...utils }
}

describe('ScrollTopButton', () => {
  it('is hidden at the top and appears after scrolling down', () => {
    const { scrollTo } = setup()
    expect(screen.queryByRole('button')).toBeNull()

    scrollTo(1000)
    expect(screen.getByRole('button', { name: 'Back to top' })).toBeTruthy()
  })

  it('hides again when scrolled back to the top', () => {
    const { scrollTo } = setup()
    scrollTo(1000)
    scrollTo(0)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('never renders on the wide tier', () => {
    const { scrollTo } = setup({ tier: 'wide' })
    scrollTo(1000)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('scrolls the container to top on click', async () => {
    const { el, scrollTo } = setup()
    scrollTo(1000)
    await userEvent.click(screen.getByRole('button', { name: 'Back to top' }))
    expect(el.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0 })
    )
  })
})
