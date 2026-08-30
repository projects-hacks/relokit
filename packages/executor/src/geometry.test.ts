import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_SPEED_MPS, MODE_SPEED_MPS, floorSeconds } from '@relokit/planner'
import { distanceMeters } from '@relokit/evidence'
import type { TravelMode } from '@relokit/schema'

const MODE: Record<string, TravelMode> = {
  Cycling: 'bike',
  Walking: 'walk',
  Transit: 'transit',
  Driving: 'drive',
}

interface Route {
  mode: TravelMode
  line: number
  road: number
  seconds: number
}

/** Every journey any provider has actually described to us. */
const routes: Route[] = readdirSync(new URL('../../../fixtures/serpapi', import.meta.url))
  .filter((name) => name.startsWith('google_maps_directions__'))
  .flatMap((name) => {
    const file = JSON.parse(
      readFileSync(new URL(`../../../fixtures/serpapi/${name}`, import.meta.url), 'utf8'),
    )
    const ends = [file.params?.start_coords, file.params?.end_coords].map((raw: string) => {
      const [lat, lng] = String(raw ?? '')
        .split(',')
        .map(Number)
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat!, lng: lng! } : null
    })
    const [from, to] = ends
    if (!from || !to) return []
    return (file.body?.directions ?? [])
      .filter((route: { travel_mode?: string; duration?: number; distance?: number }) =>
        Boolean(MODE[route.travel_mode ?? ''] && route.duration && route.distance),
      )
      .map((route: { travel_mode: string; duration: number; distance: number }) => ({
        mode: MODE[route.travel_mode]!,
        line: distanceMeters(from, to),
        road: route.distance,
        seconds: route.duration,
      }))
  })

describe('the shortest a journey could be', () => {
  it('has routes to check against', () => {
    expect(routes.length).toBeGreaterThan(50)
  })

  it('never measures a straight line longer than the road that follows it', () => {
    // If this fails the distance calculation is wrong, and every bound built on
    // it is wrong in the direction that rejects real answers.
    for (const route of routes) expect(route.line).toBeLessThanOrEqual(route.road + 1)
  })

  it('is admissible against every recorded route', () => {
    // The whole safety property in one line: the floor we would reject on must
    // never exceed a journey somebody actually made.
    for (const route of routes) {
      expect(floorSeconds(route.mode, route.line)).toBeLessThanOrEqual(route.seconds)
    }
  })

  it('keeps room in hand rather than sitting on the fastest route seen', () => {
    // Calibrated, not fitted. The quickest recorded ride covers its straight
    // line at 4.33 m/s and the bound allows 6, so a route half again as quick
    // as anything measured would still not be rejected.
    const quickest = Math.max(...routes.map((route) => route.line / route.seconds))
    expect(quickest).toBeLessThan(MAX_SPEED_MPS.bike / 1.3)
  })

  it('is optimistic about every mode, or the bound could reject the reachable', () => {
    for (const mode of ['walk', 'bike', 'transit', 'drive'] as const) {
      expect(MAX_SPEED_MPS[mode]).toBeGreaterThan(MODE_SPEED_MPS[mode])
    }
  })
})
