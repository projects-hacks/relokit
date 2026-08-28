import type { BBox, ClusterSpec, GeoPoint, Meters, TravelMode } from '@relokit/schema'

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

/**
 * Textbook haversine. Duplicated in the evidence package rather than shared,
 * because the planner is allowed exactly one dependency and eight lines of
 * arithmetic is a smaller price than that rule.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): Meters {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)))
}

/**
 * Clusters over where the listings actually are, rather than over the box that
 * contains them.
 *
 * This matters more than it sounds. A grid across a 23 km box gives cells five
 * kilometres wide, and a cell that wide forces twenty minutes of slack on a
 * twenty five minute commute, so nothing can ever be ruled out and the whole
 * tier costs calls for no pruning. Listings sit in neighbourhoods, so clustering
 * on them gives cells small enough for the slack to be worth paying.
 *
 * Deterministic: seeds are taken at even intervals through a sorted list and
 * Lloyd's iterations are run to a fixed count, so the same listings always give
 * the same cells.
 */
export function refineClusters(points: GeoPoint[], count: number): ClusterSpec[] {
  if (points.length === 0) return []
  const k = Math.max(1, Math.min(count, points.length))

  const sorted = [...points].sort((a, b) => a.lat - b.lat || a.lng - b.lng)
  let centroids = Array.from({ length: k }, (_, i) => sorted[Math.floor((i * sorted.length) / k)]!)

  let members: GeoPoint[][] = []
  for (let pass = 0; pass < 20; pass++) {
    members = Array.from({ length: k }, () => [] as GeoPoint[])
    for (const point of sorted) members[nearest(point, centroids)]!.push(point)

    const moved = centroids.map((centroid, i) => {
      const group = members[i]!
      if (group.length === 0) return centroid
      return {
        lat: round6(group.reduce((sum, p) => sum + p.lat, 0) / group.length),
        lng: round6(group.reduce((sum, p) => sum + p.lng, 0) / group.length),
      }
    })
    if (moved.every((c, i) => c.lat === centroids[i]!.lat && c.lng === centroids[i]!.lng)) break
    centroids = moved
  }

  return centroids
    .map((centroid, i) => ({
      cluster_id: `k${i}`,
      centroid,
      // The radius is the furthest listing in the cell, which is exactly the
      // error a centroid answer can carry, and so exactly the slack to allow.
      radius_m: (members[i] ?? []).reduce(
        (max, point) => Math.max(max, haversineMeters(centroid, point)),
        0,
      ),
    }))
    .filter((_, i) => (members[i] ?? []).length > 0)
}

function nearest(point: GeoPoint, centroids: GeoPoint[]): number {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < centroids.length; i++) {
    const distance = haversineMeters(point, centroids[i]!)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}
