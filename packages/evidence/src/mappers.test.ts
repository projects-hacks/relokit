import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConstraintSet, type CommuteConstraint, type NearbyPoiConstraint } from '@relokit/schema'
import type { MapperContext } from './context.ts'
import { mapDirections } from './directions.ts'
import { distanceMeters, formatDistance } from './distance.ts'
import { mapAreaSignal, mapGeocode, mapNearbyPlaces } from './places.ts'

const DIR = new URL('../../../fixtures/serpapi/', import.meta.url)
const load = (prefix: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        readdirSync(DIR).find((f) => f.startsWith(prefix))!,
        DIR,
      ),
      'utf8',
    ),
  ).body

const constraints = ConstraintSet.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../fixtures/queries/relocation-san-jose.json', import.meta.url),
      'utf8',
    ),
  ),
).constraints

const commute = constraints.find((c) => c.type === 'commute') as CommuteConstraint
const gym = constraints.find(
  (c) => c.type === 'nearby_poi' && c.category === 'gym',
) as NearbyPoiConstraint

const context: MapperContext = {
  op_id: 'op_1',
  capability_id: 'test',
  source: 'google_maps',
  fetched_at_ms: 1_756_400_000_000,
  ttl_seconds: 604_800,
}

describe('distance', () => {
  it('measures a known separation', () => {
    // Downtown San Jose to the Santa Clara office, about 12 km apart.
    const meters = distanceMeters(
      { lat: 37.3382, lng: -121.8863 },
      { lat: 37.3726799, lng: -121.9678625 },
    )
    expect(meters).toBeGreaterThan(7_000)
    expect(meters).toBeLessThan(9_000)
  })

  it('formats short distances in meters and long ones in miles', () => {
    expect(formatDistance(80)).toBe('80 m')
    expect(formatDistance(805)).toBe('0.5 mi')
  })
})

describe('commute', () => {
  const route = load('google_maps_directions__bike-to-office__')

  it('takes the fastest route, not the first one listed', () => {
    // 34 min via S Monroe St is listed ahead of 30 min via the creek trail.
    const [evidence] = mapDirections(route, commute, context, { entity_id: 'e1' })
    expect(evidence!.value_canonical).toBe(1821)
    expect(evidence!.display_value).toBe('30 min by bike')
  })

  it('fails a route over the limit', () => {
    // 30 minutes against a 25 minute constraint.
    const [evidence] = mapDirections(route, commute, context, { entity_id: 'e1' })
    expect(evidence!.verdict).toBe('fail')
    expect(evidence!.eval_state).toBe('evaluated')
  })

  it('will not reject from a centroid when the listing might still qualify', () => {
    // Six minutes of slack covers the width of the cluster, so this one is not
    // settled here and goes to the entity tier instead of the rejection list.
    const [evidence] = mapDirections(route, commute, context, {
      entity_id: 'e1',
      slack_seconds: 400,
    })
    expect(evidence!.verdict).toBe('unknown')
    expect(evidence!.confidence).toBe(0.7)
    expect(evidence!.reason).toContain('cluster centre')
  })

  it('rejects from a centroid when even the slack cannot save it', () => {
    const far = { directions: [{ travel_mode: 'Cycling', duration: 4000 }] }
    const [evidence] = mapDirections(far, commute, context, {
      entity_id: 'e1',
      slack_seconds: 400,
    })
    expect(evidence!.verdict).toBe('fail')
  })

  it('ignores routes for a mode nobody asked about', () => {
    const [evidence] = mapDirections(route, { ...commute, mode: 'walk' }, context, {
      entity_id: 'e1',
    })
    // The fixture carries a walking duration in the summary array.
    expect(evidence!.value_canonical).toBe(6858)
  })

  it('reports a missing route as unknown and as failed, never as too far', () => {
    const [evidence] = mapDirections({ directions: [] }, commute, context, { entity_id: 'e1' })
    expect(evidence!.verdict).toBe('unknown')
    expect(evidence!.eval_state).toBe('failed')
  })
})

describe('nearby places', () => {
  const gyms = load('google_maps__san-jose-gyms-maps__')
  // A real listing from the recorded search. The nearest gym in the sample is
  // Elite Pro Fitness, 4,038 m away and open from 4am.
  const origin = { lat: 37.276573, lng: -121.83751 }

  it('names the nearest gym that is open early enough', () => {
    const [evidence] = mapNearbyPlaces(gyms, { ...gym, radius_m: 4500 }, context, {
      entity_id: 'e1',
      origin,
      evaluation_days: ['tue'],
    })
    expect(evidence!.verdict).toBe('pass')
    expect(evidence!.display_value).toBe('2.5 mi to Elite Pro Fitness')
    expect(evidence!.value_canonical).toBe(4038)
  })

  it('fails when nothing is close enough', () => {
    const [evidence] = mapNearbyPlaces(gyms, { ...gym, radius_m: 805 }, context, {
      entity_id: 'e1',
      origin,
      evaluation_days: ['tue'],
    })
    expect(evidence!.verdict).toBe('fail')
    expect(evidence!.display_value).toContain('no gym within')
  })

  it('holds back a result that is only inside the slack band', () => {
    const [evidence] = mapNearbyPlaces(gyms, { ...gym, radius_m: 805 }, context, {
      entity_id: 'e1',
      origin,
      slack_meters: 4000,
      evaluation_days: ['tue'],
    })
    expect(evidence!.verdict).toBe('unknown')
    expect(evidence!.reason).toContain('only just outside')
  })

  it('does not count a gym that opens too late', () => {
    // Elite Pro Fitness opens at 4am, so a window demanding 3am rules it out
    // and the next candidate is beyond the radius.
    const [evidence] = mapNearbyPlaces(
      gyms,
      { ...gym, radius_m: 4500, open_window: { opens_by_s: 3 * 3600 } },
      context,
      { entity_id: 'e1', origin, evaluation_days: ['tue'] },
    )
    expect(evidence!.verdict).toBe('fail')
    expect(evidence!.display_value).toContain('not open when you need it')
  })

  it('says unknown rather than fail when the hours would not parse', () => {
    const unreadable = {
      local_results: [
        {
          title: 'Mystery Gym',
          gps_coordinates: { latitude: 37.2766, longitude: -121.8376 },
          operating_hours: { tuesday: 'Hours might differ' },
        },
      ],
    }
    const [evidence] = mapNearbyPlaces(unreadable, gym, context, {
      entity_id: 'e1',
      origin,
      evaluation_days: ['tue'],
    })
    expect(evidence!.verdict).toBe('unknown')
    expect(evidence!.reason).toContain('could not read')
  })
})

describe('geocode', () => {
  it('turns the office address into a point', () => {
    const geocoded = mapGeocode(load('google_maps__santa-clara-office__'))
    expect(geocoded!.point.lat).toBeCloseTo(37.3727, 3)
    expect(geocoded!.point.lng).toBeCloseTo(-121.9679, 3)
  })

  it('returns nothing rather than a wrong point', () => {
    expect(mapGeocode({})).toBeNull()
  })
})

describe('area signal', () => {
  const news = load('google_news__san-jose-news__')
  const signal = {
    id: 'c7',
    type: 'area_signal',
    hardness: 'soft',
    weight: 0.4,
    source_text: 'construction',
    inferred: false,
    topic: 'construction',
    polarity: 'negative',
    lookback_days: 30,
  } as const

  it('counts recent stories and never rejects on them', () => {
    const [evidence] = mapAreaSignal(news, signal, context, {
      entity_id: 'e1',
      now_ms: Date.parse('2026-08-28T00:00:00Z'),
    })
    expect(evidence!.verdict).toBe('pass')
    expect(typeof evidence!.value_canonical).toBe('number')
    expect(evidence!.display_value).toMatch(/construction/)
  })

  it('drops anything older than the lookback window', () => {
    const [wide] = mapAreaSignal(news, signal, context, {
      entity_id: 'e1',
      now_ms: Date.parse('2026-08-28T00:00:00Z'),
    })
    const [narrow] = mapAreaSignal(news, { ...signal, lookback_days: 1 }, context, {
      entity_id: 'e1',
      now_ms: Date.parse('2026-08-28T00:00:00Z'),
    })
    expect(narrow!.value_canonical).toBeLessThanOrEqual(wide!.value_canonical as number)
  })
})
