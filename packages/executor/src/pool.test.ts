import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  mapNearbyPlaces,
  nearestQualifying,
  readNearbyPois,
  type PoiCandidate,
} from '@relokit/evidence'
import type { NearbyPoiConstraint, Weekday } from '@relokit/schema'

/**
 * A search answers about a point, but the places it describes are where they
 * are whoever asked. These pin the one property that makes reusing them safe:
 * the pool may only ever settle a requirement in favour of a listing, never
 * against it, because a pool that found nothing has not proved anything.
 */

const DAYS: Weekday[] = ['tue']

const gym = (over: Partial<NearbyPoiConstraint> = {}): NearbyPoiConstraint =>
  ({
    id: 'c4',
    type: 'nearby_poi',
    hardness: 'hard',
    weight: 1,
    source_text: 'gym within half a mile',
    inferred: false,
    category: 'gym',
    radius_m: 805,
    min_count: 1,
    ...over,
  }) as NearbyPoiConstraint

/** Every nearby search any provider has actually answered for us. */
const searches = readdirSync(new URL('../../../fixtures/serpapi', import.meta.url))
  .filter((name) => name.startsWith('google_maps__'))
  .map((name) =>
    JSON.parse(readFileSync(new URL(`../../../fixtures/serpapi/${name}`, import.meta.url), 'utf8')),
  )
  .map((file) => file.body ?? file)
  .filter((body) => Array.isArray(body?.local_results) && body.local_results.length > 0)

const context = {
  op_id: 'op_probe',
  capability_id: 'nearby_poi.maps.entity',
  source: 'google_maps' as const,
  fetched_at_ms: Date.parse('2026-08-28T12:00:00Z'),
  ttl_seconds: 2592000,
  distance_unit: 'mi' as const,
}

/** Addresses spread across the recorded search area. */
const addresses = [
  { lat: 37.3382, lng: -121.8863 },
  { lat: 37.2766, lng: -121.8375 },
  { lat: 37.3688, lng: -121.9165 },
  { lat: 37.4043, lng: -121.945 },
]

describe('places an earlier search already found', () => {
  it('has recorded searches to check against', () => {
    expect(searches.length).toBeGreaterThan(4)
  })

  it('agrees with the paid answer on every recorded search', () => {
    // The safety property in one line: what the pool concludes from a body has
    // to be what a search of that same body concluded for the same address.
    // Anything else means the two rules have drifted apart.
    let compared = 0
    for (const body of searches) {
      const pois = readNearbyPois(body)
      for (const point of addresses) {
        const constraint = gym({ radius_m: 4500 })
        const pooled = nearestQualifying(pois, constraint, point, DAYS)
        const [paid] = mapNearbyPlaces(body, constraint, context, {
          entity_id: 'e1',
          origin: point,
          evaluation_days: DAYS,
        })
        if (paid?.verdict === 'pass') {
          expect(pooled).not.toBeNull()
          expect(pooled!.meters).toBe(paid.value_canonical)
          compared += 1
        } else if (paid?.verdict === 'fail') {
          // A paid fail is either nothing in range or nothing open. The pool
          // agrees there is nothing to certify either way.
          expect(pooled).toBeNull()
          compared += 1
        }
      }
    }
    expect(compared).toBeGreaterThan(20)
  })

  it('never certifies a place further away than was asked for', () => {
    for (const body of searches) {
      for (const point of addresses) {
        const constraint = gym()
        const found = nearestQualifying(readNearbyPois(body), constraint, point, DAYS)
        if (found) expect(found.meters).toBeLessThanOrEqual(constraint.radius_m)
      }
    }
  })

  it('measures from the address, with none of the slack a centroid earns', () => {
    const body = searches.find((b) => readNearbyPois(b).length > 0)!
    const pois = readNearbyPois(body)
    const nearest = pois
      .map((p: PoiCandidate) => p.point)
      .map((p) => Math.hypot(p.lat - addresses[0]!.lat, p.lng - addresses[0]!.lng))
      .sort((a, b) => a - b)[0]!
    // A radius that cannot reach the closest place must not be widened.
    const tiny = gym({ radius_m: 1 })
    expect(nearestQualifying(pois, tiny, addresses[0]!, DAYS)).toBeNull()
    expect(nearest).toBeGreaterThan(0)
  })

  it('will not count one shop twice toward a count of two', () => {
    const body = searches.find((b) => readNearbyPois(b).length === 1)
    if (!body) return
    const pois = readNearbyPois(body)
    expect(nearestQualifying(pois, gym({ radius_m: 50000, min_count: 2 }), addresses[0]!, DAYS)).toBeNull()
  })
})
