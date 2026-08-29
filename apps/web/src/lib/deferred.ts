import { useEffect, useRef, useState } from 'react'

/**
 * Whether a wait is worth showing.
 *
 * A run answered entirely from the ledger comes back in a few hundred
 * milliseconds, and a placeholder that appears and vanishes inside that reads as
 * a flicker rather than as progress. Nothing is shown until the wait is long
 * enough to notice, and once shown it stays long enough to have been read, even
 * when the answer beat it.
 */
export function useDeferred(active: boolean, showAfter = 200, minimum = 400): boolean {
  const [shown, setShown] = useState(false)
  const since = useRef(0)

  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        since.current = Date.now()
        setShown(true)
      }, showAfter)
      return () => clearTimeout(timer)
    }
    if (!shown) return
    const left = minimum - (Date.now() - since.current)
    if (left <= 0) {
      setShown(false)
      return
    }
    const timer = setTimeout(() => setShown(false), left)
    return () => clearTimeout(timer)
  }, [active, shown, showAfter, minimum])

  return shown
}
