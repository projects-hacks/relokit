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
