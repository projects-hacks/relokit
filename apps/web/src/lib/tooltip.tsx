import { useId, useState, type ReactNode } from 'react'

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
  const id = useId()

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
        <span className="tip" role="tooltip" id={id} data-side={side}>
          {text}
        </span>
      )}
    </span>
  )
}
