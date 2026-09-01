import { useEffect, useState } from 'react'

/**
 * Whether the rail is a column beside the answer rather than a stack above it.
 *
 * The breakpoint is the one in the stylesheet, and it decides where tracking is
 * rendered rather than how it looks: beside the method on a wide screen, and
 * after the answer on a phone, where anything above the results is something
 * the reader has to scroll past before seeing what they asked for.
 */
export function useWide(query = '(min-width: 900px)'): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(query)
    const settle = () => setWide(media.matches)
    settle()
    media.addEventListener('change', settle)
    return () => media.removeEventListener('change', settle)
  }, [query])

  return wide
}
