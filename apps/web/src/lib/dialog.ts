import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Holds the keyboard inside a dialog while it is open, and gives it back
 * afterwards.
 *
 * Without this, tabbing out of an open drawer lands on the page behind it, where
 * a sighted mouse user sees a dimmed background and a keyboard user is simply
 * lost. The page behind is marked inert rather than merely covered, so it is out
 * of reach of the tab order and of screen readers at the same time.
 */
export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    const previous = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    if (root) root.inert = true

    // Whatever comes first is where the reader would have started reading.
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? dialog).focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const stops = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (stops.length === 0) return
      const edge = event.shiftKey ? stops[0]! : stops[stops.length - 1]!
      if (document.activeElement !== edge) return
      // Past the last stop is back to the first, and the other way around.
      event.preventDefault()
      ;(event.shiftKey ? stops[stops.length - 1]! : stops[0]!).focus()
    }

    dialog.addEventListener('keydown', onKeyDown)
    return () => {
      dialog.removeEventListener('keydown', onKeyDown)
      if (root) root.inert = false
      previous?.focus()
    }
  }, [onClose])

  return ref
}
