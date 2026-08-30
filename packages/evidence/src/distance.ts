import type { GeoPoint, Meters } from '@relokit/schema'

const EARTH_RADIUS_M = 6_371_000

/** Straight line distance. Walking distance is longer, which is why radii overshoot. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): Meters {
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)))
}

export type DistanceUnit = 'mi' | 'km'

/** Answered in the unit the question used: kilometres asked, kilometres said. */
export function formatDistance(meters: Meters, unit: DistanceUnit = 'mi'): string {
  if (unit === 'km') {
    return meters < 100 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
  }
  const miles = meters / 1609.34
  return miles < 0.1 ? `${Math.round(meters)} m` : `${miles.toFixed(1)} mi`
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}
