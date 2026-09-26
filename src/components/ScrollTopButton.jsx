import { useEffect, useState } from 'react'
import { ArrowUpToLine } from 'lucide-react'

// Floating "Back to top" affordance over the main scroll container.
// Appears once you've scrolled past a short travel distance; the wide
// tier uses a headerbar button instead, so the pill hides there.
const SHOW_AFTER = 480

const prefersReducedMotion = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function ScrollTopButton({ scrollEl, tier }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!scrollEl) return undefined
    function onScroll() {
      setVisible(scrollEl.scrollTop > SHOW_AFTER)
    }
    onScroll()
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollEl.removeEventListener('scroll', onScroll)
  }, [scrollEl])

  if (!visible || tier === 'wide') return null

  return (
    <button
      className="scroll-top-btn"
      aria-label="Back to top"
      title="Back to top"
      onClick={() => scrollEl?.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' })}
    >
      <ArrowUpToLine size={18} />
    </button>
  )
}
