import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConstraintSet, type Constraint, type EvidenceRow, type Place } from '@relokit/schema'
import { bucket } from './buckets.ts'
import { applyRelaxation, relaxations } from './relax.ts'

const constraints = ConstraintSet.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../fixtures/queries/relocation-san-jose.json', import.meta.url),
      'utf8',
    ),
  ),
).constraints

const hard = constraints.filter((c) => c.hardness === 'hard').map((c) => c.id)

const listing = (id: string): Place => ({
  entity_id: id,
  title: id,
  point: { lat: 37.3, lng: -121.9 },
  price_cents: 250_000,
  price_cents_upper: null,
  attributes: { beds: 1 },
  url: null,
  photo_url: null,
  photos: [],
})

const evidence = (
  entityId: string,
  constraintId: string,
  over: Partial<EvidenceRow> = {},
): EvidenceRow => ({
  entity_id: entityId,
  constraint_id: constraintId,
  constraint_type: constraints.find((c) => c.id === constraintId)!.type,
  verdict: 'pass',
  value_canonical: 1,
  display_value: 'ok',
  source: 'zillow',
  source_url: null,
  fetched_at_ms: 1,
  ttl_seconds: 1,
  expires_at_ms: 2,
  confidence: 1,
  eval_state: 'evaluated',
  capability_id: 'test',
  op_id: 'op',
  ...over,
})

/** A home passing everything except the named constraint, at the given value. */
const blockedBy = (
  id: string,
  constraintId: string,
  value: number,
  over: Partial<EvidenceRow> = {},
) =>
  hard.map((c) =>
    c === constraintId
      ? evidence(id, c, { verdict: 'fail', value_canonical: value, ...over })
      : evidence(id, c),
  )

const run = (rows: EvidenceRow[], ids: string[]) =>
  relaxations(bucket(ids.map(listing), rows, constraints), constraints)

describe('what one change would buy', () => {
  it('offers the smallest looser bound that reaches a home', () => {
    // 26 minutes against a 25 minute limit. One more minute on the bike.
    const options = run(blockedBy('near-miss', 'c3', 1560), ['near-miss'])
    expect(options).toHaveLength(1)
    expect(options[0]!.constraint_id).toBe('c3')
    expect(options[0]!.display_from).toBe('25 min')
    expect(options[0]!.steps[0]).toMatchObject({ display_to: '26 min', unlocks: 1 })
  })

  it('counts every home a bound would reach, not just the nearest', () => {
    const options = run(
      [...blockedBy('a', 'c3', 1560), ...blockedBy('b', 'c3', 1620), ...blockedBy('c', 'c3', 1680)],
      ['a', 'b', 'c'],
    )
    expect(options[0]!.steps.map((s) => s.unlocks)).toEqual([1, 2, 3])
    expect(options[0]!.steps[2]!.entity_ids).toEqual(['a', 'b', 'c'])
  })

  it('will not offer a change that would not actually work', () => {
    // This home failed on proximity with a gym 300m away, inside the 805m
    // radius: the gym was shut, not far. Moving the radius reaches nothing, and
    // offering it would be a false promise.
    const options = run(blockedBy('shut-gym', 'c4', 300), ['shut-gym'])
    expect(options).toHaveLength(0)
  })

  it('ignores a home that more than one thing is standing in front of', () => {
    const both = hard.map((c) =>
      c === 'c3' || c === 'c1'
        ? evidence('far-and-dear', c, { verdict: 'fail', value_canonical: 1560 })
        : evidence('far-and-dear', c),
    )
    expect(run(both, ['far-and-dear'])).toHaveLength(0)
  })

  it('ignores a home nobody could check', () => {
    // Not knowing is not a bound. No change to the question fixes it.
    const unknown = hard.map((c) =>
      c === 'c3'
        ? evidence('unchecked', c, { verdict: 'unknown', eval_state: 'failed' })
        : evidence('unchecked', c),
    )
    expect(run(unknown, ['unchecked'])).toHaveLength(0)
  })

  it('refuses a change that is not small any more', () => {
    // Forty five minutes against twenty five is a different question, not a
    // relaxation of this one.
    expect(run(blockedBy('far', 'c3', 2700), ['far'])).toHaveLength(0)
  })

  it('puts the constraint blocking the most homes first', () => {
    const options = run(
      [
        ...blockedBy('a', 'c1', 290_000),
        ...blockedBy('b', 'c1', 295_000),
        ...blockedBy('c', 'c3', 1560),
      ],
      ['a', 'b', 'c'],
    )
    expect(options.map((o) => o.constraint_id)).toEqual(['c1', 'c3'])
    expect(options[0]!.sole_blocker_count).toBe(2)
  })

  it('offers dropping a requirement that has no number to move', () => {
    const options = run(blockedBy('no-laundry', 'c5', 0, { value_canonical: false }), [
      'no-laundry',
    ])
    expect(options[0]).toMatchObject({ constraint_id: 'c5', kind: 'drop_requirement' })
    expect(options[0]!.steps[0]!.display_to).toBe('without it')
  })

  it('says nothing when there is nothing to say', () => {
    expect(
      run(
        hard.map((c) => evidence('fine', c)),
        ['fine'],
      ),
    ).toHaveLength(0)
  })
})

describe('accepting an offer', () => {
  it('moves only the bound that was offered', () => {
    const moved = applyRelaxation(constraints, 'c3', 1560)
    const commute = moved.find((c) => c.id === 'c3')!
    expect(commute.type === 'commute' && commute.max_seconds).toBe(1560)
    expect(moved.filter((c) => c.id !== 'c3')).toEqual(constraints.filter((c) => c.id !== 'c3'))
  })

  it('marks the moved requirement as no longer the one that was asked for', () => {
    const moved = applyRelaxation(constraints, 'c1', 300_000)
    expect(moved.find((c) => c.id === 'c1')!.inferred).toBe(true)
  })

  it('leaves a requirement with no number to move alone', () => {
    // In-unit laundry is not something to nudge. Dropping it is a change to the
    // question, not to a bound.
    expect(applyRelaxation(constraints, 'c5', 0)).toEqual(constraints)
  })

  it('does nothing for an id that is not there', () => {
    expect(applyRelaxation(constraints, 'c99', 1)).toEqual(constraints)
  })
})

describe('offers a person could act on', () => {
  it('never offers a change to the number already set', () => {
    // Ten minutes is 600 seconds; 602, 618 and 640 are all shown as ten or
    // eleven minutes, and the page offered to change 10 min to 10 min, three
    // times over, because it told them apart by the seconds nobody sees.
    const constraints = [
      {
        id: 'c1',
        type: 'commute',
        hardness: 'hard',
        weight: 1,
        source_text: '10 min bike to San Jose State University',
        inferred: false,
        destination: { raw: 'San Jose State University' },
        mode: 'bike',
        max_seconds: 600,
      },
    ] as never as Constraint[]

    const blocked = [602, 618, 640, 700].map((seconds, index) => ({
      entity_id: `e${index}`,
      evidence: [
        {
          entity_id: `e${index}`,
          constraint_id: 'c1',
          constraint_type: 'commute',
          verdict: 'fail',
          eval_state: 'evaluated',
          value_canonical: seconds,
        },
      ],
      failed_constraint_ids: ['c1'],
      unknown_constraint_ids: [],
    }))

    const [offer] = relaxations(
      { results: [], unverified: [], rejections: blocked } as never,
      constraints,
    )
    const labels = offer!.steps.map((step) => step.display_to)
    expect(labels).not.toContain(offer!.display_from)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
