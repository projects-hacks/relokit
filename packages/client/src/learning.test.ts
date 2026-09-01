import { describe, expect, it } from 'vitest'
import { regionKey } from '@relokit/planner'
import { ask } from './index.ts'
import { RENTAL_QUERY, backend, impatient, seed } from './fake.ts'

/**
 * The loop that lets one run teach the next: counts travel out with the
 * evidence, measured priors come back with the parse, and none of it may ever
 * touch what the reader is told about a place.
 */
describe('what a run teaches the next one', () => {
  it('what each source did travels once, small and alone', async () => {
    const { transport, posts } = backend()
    await ask(transport, RENTAL_QUERY, { retry: impatient })

    const carrying = posts.filter(
      (post) => post.path === '/ingest' && 'observations' in (post.body as object),
    )
    expect(carrying).toHaveLength(1)
    const body = carrying[0]!.body as {
      region: string | null
      entities: unknown[]
      evidence: unknown[]
      observations: Record<string, unknown>[]
    }
    // Alone, because the heavy filings are what a winded instance drops.
    expect(body.entities).toHaveLength(0)
    expect(body.evidence).toHaveLength(0)
    expect(body.region).toMatch(/^[0-9a-f]{16}$/)
    expect(body.observations.length).toBeGreaterThan(0)
    for (const row of body.observations) {
      // Counts only. Ratios are derived where they are used, never stored.
      expect(Object.keys(row).sort()).toEqual(['answered', 'capability_id', 'decisive', 'passed'])
      expect(row.answered).toBeGreaterThan(0)
    }
  })

  it('wildly different priors change the spend, never the answer', async () => {
    const first = await ask(backend().transport, RENTAL_QUERY, { retry: impatient })
    // The fixture has to be able to reject, or this passes on a question
    // nothing could fail and pins nothing at all.
    expect(first.buckets.rejections.length).toBeGreaterThan(0)
    expect(first.buckets.results.length + first.buckets.unverified.length).toBeGreaterThan(0)

    const inverted = seed.capabilities.map((capability) => ({
      ...capability,
      selectivity_prior: Math.round((1 - capability.selectivity_prior) * 100) / 100,
    }))
    const second = await ask(backend({}, [], { capabilities: inverted }).transport, RENTAL_QUERY, {
      retry: impatient,
    })

    const ids = (rows: { entity_id: string }[]) => rows.map((row) => row.entity_id).sort()
    expect(ids(second.buckets.results)).toEqual(ids(first.buckets.results))
    expect(ids(second.buckets.rejections)).toEqual(ids(first.buckets.rejections))
  })

  it('measurements move the plan the same way, and still not the answer', async () => {
    const plain = await ask(backend().transport, RENTAL_QUERY, { retry: impatient })
    // Enough decisive answers to take the top rung, saying the source almost
    // never settles anything, which is what reorders the plan.
    const observations = seed.capabilities.map((capability) => ({
      capability_id: capability.capability_id,
      region: regionKey(plain.constraint_set),
      answered: 100,
      decisive: 12,
      passed: 1,
    }))
    const taught = await ask(backend({}, [], { observations }).transport, RENTAL_QUERY, {
      retry: impatient,
    })
    expect(taught.plan.trace.candidates.some((c) => c.prior_basis === 'measured_here')).toBe(true)
    const ids = (rows: { entity_id: string }[]) => rows.map((row) => row.entity_id).sort()
    expect(ids(taught.buckets.rejections)).toEqual(ids(plain.buckets.rejections))
  })

  it('an impossible measurement is ignored rather than believed', async () => {
    // More settled than given. Our executor cannot make one; a corrupted or
    // hostile row would otherwise divide by a number it was never allowed to be
    // and win every ordering forever.
    const observations = [
      { capability_id: 'commute.directions.entity', region: null, answered: 0, decisive: 40, passed: 40 },
    ]
    const result = await ask(backend({}, [], { observations }).transport, RENTAL_QUERY, {
      retry: impatient,
    })
    const traced = result.plan.trace.candidates.find(
      (candidate) => candidate.capability_id === 'commute.directions.entity',
    )
    expect(traced?.prior_basis).toBe('assumed')
    expect(Number.isFinite(traced?.coverage ?? 0)).toBe(true)
  })

  it('the place a question named never travels back as itself', async () => {
    const { transport, posts } = backend()
    await ask(transport, RENTAL_QUERY, { retry: impatient })
    const filed = posts.find(
      (post) => post.path === '/ingest' && 'observations' in (post.body as object),
    )!.body as { region: string }
    expect(filed.region).not.toContain('san jose')
    expect(filed.region).toMatch(/^[0-9a-f]{16}$/)
  })

  it('served measurements reach the plan the reader sees', async () => {
    const plain = await ask(backend().transport, RENTAL_QUERY, { retry: impatient })
    const observations = [
      {
        capability_id: 'commute.directions.entity',
        region: regionKey(plain.constraint_set),
        answered: 16,
        decisive: 12,
        passed: 6,
      },
    ]
    const result = await ask(backend({}, [], { observations }).transport, RENTAL_QUERY, {
      retry: impatient,
    })
    const traced = result.plan.trace.candidates.find(
      (candidate) => candidate.capability_id === 'commute.directions.entity',
    )
    expect(traced).toMatchObject({
      selectivity_prior: 0.5,
      prior_basis: 'measured_here',
      observation_n: 12,
    })
  })
})
