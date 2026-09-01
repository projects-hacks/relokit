import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A tooltip explains, it does not label. Anything a control needs in order to be
 * understood belongs in the control itself; this is for the sentence behind it.
 *
 * It follows focus as well as the pointer, because a control that only explains
 * itself to a mouse explains itself to some people and not others.
 */
export function Tip({
  text,
  side = 'right',
  children,
}: {
  text: string
  side?: 'right' | 'left' | 'above'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [nudge, setNudge] = useState(0)
  const bubble = useRef<HTMLSpanElement>(null)
  const id = useId()

  // Kept on screen wherever its anchor sits. A sentence pinned to a mark in a
  // narrow column runs off one edge, and the same sentence on a phone runs off
  // the other; either way it is clipped, and a clipped explanation explains
  // nothing. Measured once on opening, then moved by however much it missed by.
  useLayoutEffect(() => {
    if (!open || !bubble.current) {
      setNudge(0)
      return
    }
    const box = bubble.current.getBoundingClientRect()
    const margin = 8
    let shift = 0
    if (box.right > window.innerWidth - margin) shift = window.innerWidth - margin - box.right
    if (box.left + shift < margin) shift = margin - box.left
    setNudge(shift)
  }, [open])

  return (
    <span
      className="tip-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span
          className="tip"
          role="tooltip"
          id={id}
          data-side={side}
          ref={bubble}
          style={nudge === 0 ? undefined : { marginLeft: `${nudge}px` }}
        >
          {text}
        </span>
      )}
    </span>
  )
}
