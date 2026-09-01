import { describe, expect, it } from 'vitest'
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
    expect(body.region).toBe('san jose')
    expect(body.observations.length).toBeGreaterThan(0)
    for (const row of body.observations) {
      // Counts only. Ratios are derived where they are used, never stored.
      expect(Object.keys(row).sort()).toEqual(['answered', 'capability_id', 'decisive', 'passed'])
      expect(row.answered).toBeGreaterThan(0)
    }
  })

  it('wildly different priors change the spend, never the answer', async () => {
    const first = await ask(backend().transport, RENTAL_QUERY, { retry: impatient })

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

  it('served measurements reach the plan the reader sees', async () => {
    const observations = [
      {
        capability_id: 'commute.directions.entity',
        region: 'san jose',
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
