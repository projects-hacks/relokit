import type { BBox, ClusterSpec, GeoPoint, TravelMode } from '@relokit/schema'

/**
 * There is no isochrone. SerpApi has no such endpoint and Zillow takes a
 * rectangle, so what we have is a bounding box derived from a mode speed.
 *
 * Overshoot generously. A prefilter that is too tight discards the right answer
 * before anything has looked at it, and the later stages are what prune.
 */
export const MODE_SPEED_MPS: Record<TravelMode, number> = {
  walk: 1.4,
  bike: 4.2,
  transit: 7.5,
  drive: 11.1,
}

const METERS_PER_DEGREE_LAT = 111_320

export function reachRadiusMeters(
  mode: TravelMode,
  maxSeconds: number,
  overshootFactor: number,
): number {
  return Math.round(MODE_SPEED_MPS[mode] * maxSeconds * overshootFactor)
}

export function boxAround(centre: GeoPoint, radiusMeters: number): BBox {
  const dLat = radiusMeters / METERS_PER_DEGREE_LAT
  const dLng = radiusMeters / (METERS_PER_DEGREE_LAT * Math.cos((centre.lat * Math.PI) / 180))
  return {
    sw: { lat: centre.lat - dLat, lng: centre.lng - dLng },
    ne: { lat: centre.lat + dLat, lng: centre.lng + dLng },
  }
}

/**
 * Entity coordinates do not exist at plan time, so the plan lays a deterministic
 * grid over the search box and Xano snaps each centroid to the listings that
 * actually landed in that cell. The cell count is what the cost model prices.
 */
export function gridClusters(bounds: BBox, count: number): ClusterSpec[] {
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const latStep = (bounds.ne.lat - bounds.sw.lat) / rows
  const lngStep = (bounds.ne.lng - bounds.sw.lng) / cols

  const clusters: ClusterSpec[] = []
  for (let row = 0; row < rows && clusters.length < count; row++) {
    for (let col = 0; col < cols && clusters.length < count; col++) {
      const lat = bounds.sw.lat + latStep * (row + 0.5)
      const lng = bounds.sw.lng + lngStep * (col + 0.5)
      clusters.push({
        cluster_id: `k${row}_${col}`,
        centroid: { lat: round6(lat), lng: round6(lng) },
        radius_m: Math.round(cellRadiusMeters(latStep, lngStep, lat)),
      })
    }
  }
  return clusters
}

function cellRadiusMeters(latStep: number, lngStep: number, lat: number): number {
  const halfHeight = (latStep / 2) * METERS_PER_DEGREE_LAT
  const halfWidth = (lngStep / 2) * METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180)
  return Math.hypot(halfHeight, halfWidth)
}

/**
 * Cluster evidence describes a centroid, not a listing. Prune only when the
 * centroid fails by more than the cell can account for, or a listing nearer the
 * destination than its own centroid is rejected for being far away.
 */
export function slackSeconds(radiusMeters: number, mode: TravelMode): number {
  return Math.ceil(radiusMeters / MODE_SPEED_MPS[mode])
}

export function slackMeters(radiusMeters: number): number {
  return Math.ceil(radiusMeters)
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}
