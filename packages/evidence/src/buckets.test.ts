import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConstraintSet, type EvidenceRow, type Place } from '@relokit/schema'
import { bucket } from './buckets.ts'

const constraints = ConstraintSet.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../fixtures/queries/relocation-san-jose.json', import.meta.url),
      'utf8',
    ),
  ),
).constraints

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

const allHard = constraints.filter((c) => c.hardness === 'hard').map((c) => c.id)
const passing = (id: string) => allHard.map((c) => evidence(id, c))

describe('bucketing', () => {
  it('verifies a listing only when every hard constraint was actually checked', () => {
    const { results } = bucket([listing('a')], passing('a'), constraints)
    expect(results.map((r) => r.entity_id)).toEqual(['a'])
  })

  it('rejects on a checked failure', () => {
    const rows = passing('a').map((r) =>
      r.constraint_id === 'c3' ? { ...r, verdict: 'fail' as const } : r,
    )
    const { rejections, results } = bucket([listing('a')], rows, constraints)
    expect(results).toHaveLength(0)
    expect(rejections[0]!.failed_constraint_ids).toEqual(['c3'])
  })

  it('does not reject on a failure nobody managed to evaluate', () => {
    // A provider error is not a reason to throw a home away.
    const rows = passing('a').map((r) =>
      r.constraint_id === 'c3'
        ? { ...r, verdict: 'unknown' as const, eval_state: 'failed' as const }
        : r,
    )
    const { rejections, unverified } = bucket([listing('a')], rows, constraints)
    expect(rejections).toHaveLength(0)
    expect(unverified[0]!.unknown_constraint_ids).toEqual(['c3'])
  })

  it('treats a constraint with no evidence at all as unverified, not as passed', () => {
    const rows = passing('a').filter((r) => r.constraint_id !== 'c4')
    const { unverified } = bucket([listing('a')], rows, constraints)
    expect(unverified[0]!.unknown_constraint_ids).toEqual(['c4'])
  })

  it('rejects before it reports unknowns, since one checked failure settles it', () => {
    const rows = passing('a').map((r) =>
      r.constraint_id === 'c3'
        ? { ...r, verdict: 'fail' as const }
        : r.constraint_id === 'c4'
          ? { ...r, verdict: 'unknown' as const }
          : r,
    )
    const { rejections } = bucket([listing('a')], rows, constraints)
    expect(rejections).toHaveLength(1)
  })
})

describe('conflicting sources', () => {
  it('believes the exact measurement over the cluster estimate', () => {
    const rows = [
      ...passing('a').filter((r) => r.constraint_id !== 'c3'),
      evidence('a', 'c3', { verdict: 'unknown', confidence: 0.7, value_canonical: 1700 }),
      evidence('a', 'c3', { verdict: 'pass', confidence: 1, value_canonical: 1200 }),
    ]
    const { results } = bucket([listing('a')], rows, constraints)
    expect(results).toHaveLength(1)
    const commute = results[0]!.evidence.find((e) => e.constraint_id === 'c3')!
    expect(commute.value_canonical).toBe(1200)
  })

  it('shows one row per constraint, not every attempt', () => {
    const rows = [...passing('a'), ...passing('a')]
    const { results } = bucket([listing('a')], rows, constraints)
    expect(results[0]!.evidence).toHaveLength(allHard.length)
  })
})

describe('ranking', () => {
  const cheapAndClose = [
    evidence('cheap', 'c1', { value_canonical: 200_000 }),
    evidence('cheap', 'c3', { value_canonical: 600 }),
    ...allHard.filter((c) => !['c1', 'c3'].includes(c)).map((c) => evidence('cheap', c)),
  ]
  const dearAndFar = [
    evidence('dear', 'c1', { value_canonical: 279_000 }),
    evidence('dear', 'c3', { value_canonical: 1480 }),
    ...allHard.filter((c) => !['c1', 'c3'].includes(c)).map((c) => evidence('dear', c)),
  ]

  it('puts the listing that clears the limits most comfortably first', () => {
    // Both qualify. Cheaper rent and a shorter ride is the better answer.
    const { results } = bucket(
      [listing('dear'), listing('cheap')],
      [...dearAndFar, ...cheapAndClose],
      constraints,
    )
    expect(results.map((r) => r.entity_id)).toEqual(['cheap', 'dear'])
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score)
  })

  it('orders unverified listings by how little is missing', () => {
    const oneMissing = passing('one').filter((r) => r.constraint_id !== 'c3')
    const twoMissing = passing('two').filter((r) => !['c3', 'c4'].includes(r.constraint_id))
    const { unverified } = bucket(
      [listing('two'), listing('one')],
      [...twoMissing, ...oneMissing],
      constraints,
    )
    expect(unverified.map((u) => u.entity_id)).toEqual(['one', 'two'])
  })

  it('is stable, so the same run twice gives the same order', () => {
    const rows = [...cheapAndClose, ...dearAndFar]
    const once = bucket([listing('cheap'), listing('dear')], rows, constraints)
    const twice = bucket([listing('dear'), listing('cheap')], rows, constraints)
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice))
  })
})
