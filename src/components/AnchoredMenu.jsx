import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// A dropdown that anchors to a trigger element and can never be clipped
// or pushed off screen. The old in-row dropdowns were position:absolute
// inside scrolling, overflow:hidden containers (the timeline list), so a
// menu on the topmost post opened upward straight out of the clip box
// and vanished. This portals to <body> instead (no ancestor can clip
// it), positions itself fixed from the trigger's viewport rect, flips
// above/below based on which side has more room, caps its height to the
// space actually available, clamps horizontally into the viewport, and
// follows the trigger through scrolls and resizes instead of detaching
// from it.
//
// The backdrop rides along in the portal: one click-catcher under the
// menu, above the page.
export function AnchoredMenu({ anchorRef, open, onClose, className = 'boost-dropdown', children }) {
  const menuRef = useRef(null)
  const [style, setStyle] = useState(null)

  const place = useCallback(() => {
    const anchor = anchorRef?.current
    const menu = menuRef.current
    if (!anchor) return
    const a = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 8
    const gap = 4
    const mW = menu ? menu.offsetWidth : 200
    const mH = menu ? menu.offsetHeight : 200

    // Which side has more room wins; ties go below (natural reading).
    let above = a.top > vh - a.bottom
    // Flip if the chosen side can't fit the menu but the other one can.
    const fitsAbove = a.top - gap - mH >= pad
    const fitsBelow = a.bottom + gap + mH <= vh - pad
    if (above && !fitsAbove && fitsBelow) above = false
    if (!above && !fitsBelow && fitsAbove) above = true

    const space = above ? a.top - gap - pad : vh - a.bottom - gap - pad
    const top = above
      ? Math.max(pad, a.top - gap - Math.min(mH, space))
      : a.bottom + gap
    const left = Math.min(Math.max(pad, a.left), Math.max(pad, vw - mW - pad))

    setStyle({
      position: 'fixed',
      top,
      left,
      // The menu classes still carry a legacy "bottom" rule from their
      // pre-portal absolute-anchor layout; under position:fixed an
      // active bottom next to "top" stretches the box to its
      // max-height. Reset it so the menu hugs its content.
      bottom: 'auto',
      maxHeight: Math.max(120, Math.min(480, space)),
      zIndex: 95,
    })
  }, [anchorRef])

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null)
      return undefined
    }
    place()
    // Any scroll (capture — the app scrolls inner containers, not the
    // window) or resize repositions; rAF keeps it to one move per frame.
    let raf = null
    const onMove = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = null; place() })
    }
    window.addEventListener('scroll', onMove, { capture: true })
    window.addEventListener('resize', onMove)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onMove, { capture: true })
      window.removeEventListener('resize', onMove)
    }
  }, [open, place])

  if (!open) return null
  return createPortal(
    <>
      <div className="boost-dropdown-backdrop" onClick={onClose} />
      <div
        ref={menuRef}
        className={className}
        // Hidden until the first placement lands: style is computed in
        // the same commit's layout effect, so this never paints visibly
        // in the wrong place.
        style={style || { visibility: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body
  )
}
