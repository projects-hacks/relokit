import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { NearbyPoiConstraint } from '@relokit/schema'
import { normalizeConstraintSet } from './normalize.ts'

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../fixtures/llm/parse-relocation-mistral-nemotron.json', import.meta.url),
    'utf8',
  ),
)

const meta = {
  query_id: 'q_test',
  parser_version: 'parse.v1.md',
  parsed_at_ms: 1_756_400_000_000,
}

const { constraint_set, repairs } = normalizeConstraintSet(fixture.raw, fixture.query, meta)
const byId = Object.fromEntries(constraint_set.constraints.map((c) => [c.id, c]))
const poi = (id: string) => byId[id] as NearbyPoiConstraint

describe('a real model answer', () => {
  it('keeps every constraint it found', () => {
    expect(constraint_set.constraints.map((c) => c.type)).toEqual([
      'budget',
      'unit_attribute',
      'commute',
      'nearby_poi',
      'listing_feature',
      'nearby_poi',
    ])
  })

  it('validates, which the raw answer did not', () => {
    // The model returned a bare string for the destination and 804.672 meters.
    expect(constraint_set.constraints).toHaveLength(6)
  })
})

describe('the mistakes the schema cannot see', () => {
  it('moves "open before 6am" to the field about opening', () => {
    // The model filed it under closes_after_s, which asks for a gym that shuts
    // before six in the morning.
    expect(fixture.raw.constraints[3].open_window).toEqual({ closes_after_s: 21600 })
    expect(poi('c4').open_window).toEqual({ opens_by_s: 21_600 })
  })

  it('reads "past 10pm" as ten at night', () => {
    // The model answered 36000, which is ten in the morning, and put it under
    // opening rather than closing.
    expect(fixture.raw.constraints[5].open_window).toEqual({ opens_by_s: 36000 })
    expect(poi('c6').open_window).toEqual({ closes_after_s: 79_200 })
  })

  it('says what it changed and why', () => {
    const windows = repairs.filter((r) => r.field === 'open_window')
    expect(windows).toHaveLength(2)
    expect(windows[0]!.why).toContain('opens')
    expect(windows[1]!.why).toContain('closes')
  })
})

describe('the mistakes the schema would have caught anyway', () => {
  it('turns half a mile into whole meters', () => {
    expect(fixture.raw.constraints[3].radius_m).toBe(804.672)
    expect(poi('c4').radius_m).toBe(805)
  })

  it('turns a bare address into a place reference', () => {
    const commute = byId.c3!
    expect(typeof fixture.raw.constraints[2].destination).toBe('string')
    expect(commute.type === 'commute' && commute.destination.raw).toBe('2788 San Tomas Expressway')
  })
})

describe('numbers the query never stated', () => {
  it('marks an invented radius as an assumption', () => {
    // "grocery open past 10pm" names no distance, so the radius is ours.
    expect(poi('c6').inferred).toBe(true)
    expect(poi('c6').radius_m).toBe(1600)
  })

  it('leaves a number the user did write alone', () => {
    expect(poi('c4').inferred).toBe(false)
    expect(byId.c1!.inferred).toBe(false)
  })
})

describe('robustness', () => {
  it('renumbers so ids stay contiguous when something is dropped', () => {
    const withJunk = {
      constraints: [
        { type: 'nonsense', source_text: 'x' },
        fixture.raw.constraints[0],
        fixture.raw.constraints[1],
      ],
    }
    const result = normalizeConstraintSet(withJunk, fixture.query, meta)
    expect(result.constraint_set.constraints.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(result.dropped).toHaveLength(1)
  })

  it('keeps a constraint whose numbers the model got right', () => {
    const result = normalizeConstraintSet(
      { constraints: [fixture.raw.constraints[2]] },
      fixture.query,
      meta,
    )
    const commute = result.constraint_set.constraints[0]!
    expect(commute.type === 'commute' && commute.max_seconds).toBe(1500)
  })

  it('does not invent an opening window where the phrase has none', () => {
    const result = normalizeConstraintSet(
      { constraints: [{ ...fixture.raw.constraints[3], source_text: 'gym within half a mile' }] },
      fixture.query,
      meta,
    )
    expect(
      (result.constraint_set.constraints[0] as NearbyPoiConstraint).open_window,
    ).toBeUndefined()
  })
})

describe('two models, one answer', () => {
  // The point of re-reading numbers from the query is that the answer should not
  // depend on which model produced it. These two disagreed on almost everything
  // numeric; after repair they agree.
  const gemini = JSON.parse(
    readFileSync(
      new URL('../../../fixtures/llm/parse-relocation-xano-gemini.json', import.meta.url),
      'utf8',
    ),
  )

  const repaired = (fx: { raw: unknown; query: string }) =>
    normalizeConstraintSet(fx.raw, fx.query, meta).constraint_set.constraints

  it('produces the same constraints from either model', () => {
    expect(JSON.stringify(repaired(gemini))).toBe(JSON.stringify(repaired(fixture)))
  })

  it('needed far less repairing of the better one', () => {
    // Gemini put the opening time under opening and the closing time under
    // closing. The fallback got both backwards.
    const geminiRepairs = normalizeConstraintSet(gemini.raw, gemini.query, meta).repairs
    expect(geminiRepairs.filter((r) => r.field === 'open_window')).toHaveLength(0)
    expect(repairs.filter((r) => r.field === 'open_window')).toHaveLength(2)
  })

  it('still corrects the rounding neither model got right', () => {
    // Half a mile is 805 metres. One model said 804, the other 804.672.
    const gymRadius = (repaired(gemini).find((c) => c.id === 'c4') as NearbyPoiConstraint).radius_m
    expect(gymRadius).toBe(805)
  })
})

describe('how far to look', () => {
  it('carries a stated radius onto the search anchor', () => {
    const { constraint_set } = normalizeConstraintSet(
      { location: 'San Jose State University', radius_m: 3218, constraints: [] },
      'show me 2 bedroom apartments within 2 miles of San Jose State University',
      meta,
    )
    expect(constraint_set.search_anchor).toEqual({
      raw: 'San Jose State University',
      radius_m: 3218,
    })
  })

  it('leaves the radius off when the question gives none', () => {
    const { constraint_set } = normalizeConstraintSet(
      { location: 'San Jose', constraints: [] },
      'apartments in San Jose',
      meta,
    )
    expect(constraint_set.search_anchor).toEqual({ raw: 'San Jose' })
  })
})

describe('a place the question names', () => {
  it('becomes a proximity constraint with the distance read from the words', () => {
    const { constraint_set } = normalizeConstraintSet(
      {
        location: 'San Jose',
        constraints: [
          {
            id: 'c1',
            type: 'proximity',
            hardness: 'hard',
            weight: 1,
            source_text: 'within 2 km of Diridon Station',
            place: { raw: 'Diridon Station' },
          },
        ],
      },
      '1 bed within 2 km of Diridon Station, in San Jose',
      meta,
    )
    expect(constraint_set.constraints[0]).toMatchObject({
      type: 'proximity',
      place: { raw: 'Diridon Station' },
      radius_m: 2000,
    })
  })

  it('drops one that names no place, because there is nothing to measure from', () => {
    const { constraint_set } = normalizeConstraintSet(
      {
        location: 'San Jose',
        constraints: [
          { id: 'c1', type: 'proximity', hardness: 'hard', weight: 1, source_text: 'nearby' },
        ],
      },
      'somewhere nearby',
      meta,
    )
    expect(constraint_set.constraints).toHaveLength(0)
  })
})

describe('a bedroom count given as one end of a range', () => {
  it('fills in the other end, so the provider filter is not left with a hole', () => {
    const { constraint_set } = normalizeConstraintSet(
      {
        location: 'San Jose',
        constraints: [
          {
            id: 'c1',
            type: 'unit_attribute',
            hardness: 'hard',
            weight: 1,
            source_text: '1 bed',
            attribute: 'beds',
            min: 1,
          },
        ],
      },
      '1 bed in San Jose',
      meta,
    )
    expect(constraint_set.constraints[0]).toMatchObject({ min: 1, max: 1 })
  })
})

describe('what the question is asking for', () => {
  const parse = (raw: object, query: string) => normalizeConstraintSet(raw, query, meta)

  it('reads the subject from the opening noun when the model omits it', () => {
    const { constraint_set } = parse(
      {
        location: 'downtown Austin',
        constraints: [
          {
            id: 'c1',
            type: 'nearby_poi',
            hardness: 'hard',
            weight: 1,
            source_text: 'gyms within 1 mile',
            category: 'gym',
            radius_m: 1609,
          },
        ],
      },
      'gyms within 1 mile of downtown Austin that open before 6am',
    )
    expect(constraint_set.subject).toBe('gym')
    // A question asking for gyms must not also require each gym to be near one.
    expect(constraint_set.constraints).toHaveLength(0)
  })

  it('keeps opening times the question asked for rather than dropping them', () => {
    const { constraint_set } = parse(
      {
        location: 'downtown Austin',
        constraints: [
          {
            id: 'c1',
            type: 'nearby_poi',
            hardness: 'hard',
            weight: 1,
            source_text: 'gyms that open before 6am',
            category: 'gym',
            radius_m: 1609,
            open_window: { opens_by_s: 21600 },
          },
        ],
      },
      'gyms in downtown Austin that open before 6am',
    )
    expect(constraint_set.subject).toBe('gym')
    expect(constraint_set.constraints[0]).toMatchObject({ type: 'opening_hours' })
  })

  it('keeps a requirement that is not the thing being counted', () => {
    const { constraint_set } = parse(
      {
        subject: 'rental',
        location: 'Austin',
        constraints: [
          {
            id: 'c1',
            type: 'nearby_poi',
            hardness: 'hard',
            weight: 1,
            source_text: 'near a gym',
            category: 'gym',
            radius_m: 1609,
          },
        ],
      },
      'flats in Austin near a gym',
    )
    expect(constraint_set.subject).toBe('rental')
    expect(constraint_set.constraints).toHaveLength(1)
  })
})

describe('when the model and the sentence disagree', () => {
  it('believes the noun the question opens with', () => {
    // Asked for gyms, a model will still answer rental, because a gym is also
    // something a home can be near.
    const { constraint_set } = normalizeConstraintSet(
      { subject: 'rental', location: 'Austin', constraints: [] },
      'gyms in downtown Austin open before 6am',
      meta,
    )
    expect(constraint_set.subject).toBe('gym')
  })

  it('still reads flats as flats when a gym is only a requirement', () => {
    const { constraint_set } = normalizeConstraintSet(
      { subject: 'rental', location: 'Austin', constraints: [] },
      'flats in Austin near a gym',
      meta,
    )
    expect(constraint_set.subject).toBe('rental')
  })
})

describe('a stated search radius', () => {
  it('is also measured per result, whatever the model omitted', () => {
    // Bounded silently, the reader cannot tell held-by-construction from
    // dropped. The constraint is made here because models skip it however
    // they are asked.
    const { constraint_set } = normalizeConstraintSet(
      { location: 'San Jose State University', radius_m: 3218, constraints: [] },
      '2 bed flats within 2 miles of San Jose State University under 3800',
      meta,
    )
    const near = constraint_set.constraints.find((c) => c.type === 'proximity')
    expect(near).toMatchObject({
      place: { raw: 'San Jose State University' },
      radius_m: 3218,
      source_text: 'within 2 miles of San Jose State University',
    })
    expect(constraint_set.search_anchor).toMatchObject({ radius_m: 3218 })
  })

  it('does not double one the model already made', () => {
    const { constraint_set } = normalizeConstraintSet(
      {
        location: 'San Jose State University',
        radius_m: 3218,
        constraints: [
          {
            id: 'c1',
            type: 'proximity',
            hardness: 'hard',
            weight: 1,
            source_text: 'within 2 miles of San Jose State University',
            place: { raw: 'San Jose State University' },
            radius_m: 3218,
          },
        ],
      },
      'flats within 2 miles of San Jose State University',
      meta,
    )
    expect(constraint_set.constraints.filter((c) => c.type === 'proximity')).toHaveLength(1)
  })
})

describe('the distance unit', () => {
  const locale = (query: string) =>
    normalizeConstraintSet({ location: 'San Jose', constraints: [] }, query, meta).constraint_set
      .locale.distance_unit

  it('is read from the words of the question', () => {
    expect(locale('flats within 3 km of the station')).toBe('km')
    expect(locale('flats within 2 miles of the station')).toBe('mi')
    // Both mentioned: miles win, because that is what the answers compare to.
    expect(locale('within 2 miles, gym within 500 km')).toBe('mi')
    expect(locale('flats in San Jose')).toBe('mi')
  })
})

describe('the words a question uses for what it wants', () => {
  it('keeps the qualifier that decides which places are right', () => {
    // Searched as plain restaurants, this came back with an Irish pub.
    const { constraint_set } = normalizeConstraintSet(
      {
        subject: 'restaurant',
        subject_term: 'mexican restaurants',
        location: 'San Jose',
        constraints: [],
      },
      'mexican restaurants near me open past 10pm',
      meta,
    )
    expect(constraint_set.subject_term).toBe('mexican restaurants')
  })

  it('leaves it out when only the kind of thing was named', () => {
    const { constraint_set } = normalizeConstraintSet(
      { subject: 'restaurant', location: 'San Jose', constraints: [] },
      'restaurants in San Jose',
      meta,
    )
    expect(constraint_set.subject_term).toBeUndefined()
  })
})
