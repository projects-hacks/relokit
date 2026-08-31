import { useCallback, useEffect, useState } from 'react'
import type { AttributeValue, GeoPoint, Place } from '@relokit/schema'

/**
 * Places worth coming back to.
 *
 * Kept in the browser rather than behind an account, because choosing where to
 * live, or where to eat, takes longer than one sitting and nobody should have to
 * sign up to keep a shortlist. Enough of the place is stored to show it in full
 * later without asking anyone anything.
 */
const KEY = 'relokit.saved.v1'

export interface SavedPlace {
  entity_id: string
  title: string
  price_cents: number | null
  photo_url: string | null
  url: string | null
  /** Where it is, so it can still be opened on a map days later. */
  point: GeoPoint | null
  /** What a source said about it: the rating, the price bracket, the beds. */
  attributes: Record<string, AttributeValue>
  /** The question it was saved from, which is why it is worth keeping. */
  query: string
  saved_at: number
}

function read(): SavedPlace[] {
  try {
    const raw = localStorage.getItem(KEY)
    const stored = raw ? (JSON.parse(raw) as SavedPlace[]) : []
    // Anything kept before a place carried its own facts still opens.
    return stored.map((place) => ({
      ...place,
      attributes: place.attributes ?? {},
      point: place.point ?? null,
    }))
  } catch {
    return []
  }
}

function write(homes: SavedPlace[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(homes))
  } catch {
    // A private window or a full quota. Saving a location is a convenience.
  }
}

export function useSaved(query: string) {
  const [homes, setHomes] = useState<SavedPlace[]>(read)

  useEffect(() => {
    const sync = () => setHomes(read())
    addEventListener('storage', sync)
    return () => removeEventListener('storage', sync)
  }, [])

  const toggle = useCallback(
    (entity: Place) => {
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
                  point: entity.point,
                  attributes: entity.attributes,
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

  // Hands back what was cleared, so the caller can offer it again.
  const clear = useCallback(() => {
    const previous = read()
    write([])
    setHomes([])
    return () => {
      write(previous)
      setHomes(previous)
    }
  }, [])

  const remove = useCallback((entityId: string) => {
    setHomes((current) => {
      const next = current.filter((home) => home.entity_id !== entityId)
      write(next)
      return next
    })
  }, [])

  return {
    homes,
    toggle,
    remove,
    clear,
    isSaved: (id: string) => homes.some((h) => h.entity_id === id),
  }
}
