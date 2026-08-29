import { useCallback, useEffect, useState } from 'react'
import type { ListingSummary } from '@relokit/schema'

/**
 * Homes worth coming back to.
 *
 * Kept in the browser rather than behind an account, because choosing where to
 * live takes days and nobody should have to sign up to keep a shortlist. Enough
 * of the listing is stored to show it again without asking anyone anything.
 */
const KEY = 'relokit.saved.v1'

export interface SavedHome {
  entity_id: string
  title: string
  price_cents: number | null
  photo_url: string | null
  url: string | null
  query: string
  saved_at: number
}

function read(): SavedHome[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SavedHome[]) : []
  } catch {
    return []
  }
}

function write(homes: SavedHome[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(homes))
  } catch {
    // A private window or a full quota. The shortlist is a convenience.
  }
}

export function useSaved(query: string) {
  const [homes, setHomes] = useState<SavedHome[]>(read)

  useEffect(() => {
    const sync = () => setHomes(read())
    addEventListener('storage', sync)
    return () => removeEventListener('storage', sync)
  }, [])

  const toggle = useCallback(
    (entity: ListingSummary) => {
      setHomes((current) => {
        const without = current.filter((home) => home.entity_id !== entity.entity_id)
        const next =
          without.length === current.length
            ? [
                {
                  entity_id: entity.entity_id,
                  title: entity.title,
                  price_cents: entity.price_cents,
                  photo_url: entity.photo_url,
                  url: entity.url,
                  query,
                  saved_at: Date.now(),
                },
                ...current,
              ]
            : without
        write(next)
        return next
      })
    },
    [query],
  )

  const clear = useCallback(() => {
    write([])
    setHomes([])
  }, [])

  return { homes, toggle, clear, isSaved: (id: string) => homes.some((h) => h.entity_id === id) }
}
