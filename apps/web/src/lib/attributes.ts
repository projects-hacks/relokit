import type { AttributeValue, Place } from '@relokit/schema'

/**
 * How a fact a source recorded is said out loud. A new kind of result adds a
 * line here and nothing else in the interface changes.
 */
const RENDERERS: Record<string, (value: AttributeValue) => string | null> = {
  beds: (v) => (typeof v === 'number' ? `${v} bed` : null),
  baths: (v) => (typeof v === 'number' ? `${v} bath` : null),
  rating: (v) => (typeof v === 'number' ? `${v.toFixed(1)} out of 5` : null),
  reviews: (v) => (typeof v === 'number' ? `${v.toLocaleString('en-US')} reviews` : null),
  price_level: (v) => (typeof v === 'string' ? v : null),
  cuisine: (v) => (typeof v === 'string' ? v : null),
  open_now: (v) => (v === true ? 'Open now' : v === false ? 'Closed now' : null),
}

/** The attributes worth showing, in a stable order, already worded. */
export function described(place: Place): string[] {
  return Object.keys(RENDERERS)
    .filter((key) => key in place.attributes)
    .map((key) => RENDERERS[key]!(place.attributes[key]!))
    .filter((line): line is string => line !== null)
}
