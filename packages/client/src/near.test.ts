import { describe, expect, it } from 'vitest'
import { ConstraintSet } from '@relokit/schema'
import { NEAR_ME, anchorToHere } from './near.ts'

const HERE = { lat: 37.33, lng: -121.89 }

const set = (subject: string, radius?: number) =>
  ConstraintSet.parse({
    query_id: 'q',
    raw_query: 'x near me',
    subject,
    locale: { tz: 'America/Los_Angeles', currency: 'USD' },
    search_anchor: { raw: 'near me', ...(radius ? { radius_m: radius } : {}) },
    constraints: [],
    parser_version: 'parse.v1.md',
    parsed_at_ms: 1_756_400_000_000,
  })

describe('near me', () => {
  it('recognises the ways people say it, and not a nearby gym', () => {
    for (const phrase of [
      'mexican restaurants near me',
      'coffee around me',
      'gyms close to me',
      'flats within 2 miles of my location',
      'parks around my current location',
    ]) {
      expect(NEAR_ME.test(phrase)).toBe(true)
    }
    // A gym nearby is a requirement about the home, not about the reader.
    expect(NEAR_ME.test('flats in Austin with a gym nearby')).toBe(false)
  })

  it('assumes a walk for dinner and a neighbourhood for a home', () => {
    expect(anchorToHere(set('restaurant'), HERE).search_anchor?.radius_m).toBe(2000)
    expect(anchorToHere(set('rental'), HERE).search_anchor?.radius_m).toBe(8000)
  })

  it('never overrides a distance the question stated', () => {
    const near = anchorToHere(set('restaurant', 3218), HERE)
    expect(near.search_anchor?.radius_m).toBe(3218)
    const measured = near.constraints.find((c) => c.type === 'proximity')
    expect(measured).toMatchObject({ inferred: false, place: { point: HERE } })
  })

  it('carries the assumption as a constraint the reader can see', () => {
    const near = anchorToHere(set('cafe'), HERE)
    const measured = near.constraints.find((c) => c.type === 'proximity')
    expect(measured).toMatchObject({
      inferred: true,
      source_text: 'near you',
      radius_m: 2000,
      place: { raw: 'your location', point: HERE },
    })
  })
})
