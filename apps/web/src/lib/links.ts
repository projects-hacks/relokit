import type { GeoPoint } from '@relokit/schema'

/**
 * The way from a place we found to a map somebody already has open.
 *
 * Shared, because a place is worth opening from wherever it is shown: the
 * drawer that describes it and the shelf it was kept on. Two copies of these
 * would eventually disagree about which one carries the provider's own id.
 */
interface Openable {
  entity_id: string
  title: string
  point: GeoPoint | null
}

/**
 * Prefer the provider's own id where there is one, since it opens the exact
 * place rather than whatever a search for its name turns up.
 */
export function googleMapsUrl(place: Openable): string | null {
  if (!place.point) return null
  if (place.entity_id.startsWith('places:')) {
    const id = place.entity_id.slice('places:'.length)
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.title)}&query_place_id=${id}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${place.point.lat},${place.point.lng}`
}

export function appleMapsUrl(place: Openable): string | null {
  if (!place.point) return null
  return `https://maps.apple.com/?q=${encodeURIComponent(place.title)}&ll=${place.point.lat},${place.point.lng}`
}
