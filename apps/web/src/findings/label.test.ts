import { describe, expect, it } from 'vitest'
import type { Buckets } from '@relokit/evidence'
import type { EvidenceRow } from '@relokit/schema'

/**
 * What the tab over the results is allowed to claim.
 *
 * The old test was whether any requirement was marked hard, which called a
 * question found even after its facts had been checked, contradicting the tick
 * shown on every card underneath.
 */
function verified(buckets: Buckets): boolean {
  return [...buckets.results, ...buckets.unverified, ...buckets.rejections].some((entry) =>
    entry.evidence.some((row: EvidenceRow) => row.eval_state === 'evaluated'),
  )
}

const row = (state: EvidenceRow['eval_state']) => ({ eval_state: state }) as EvidenceRow
const buckets = (results: EvidenceRow[][]): Buckets =>
  ({
    results: results.map((evidence, index) => ({ entity_id: `e${index}`, evidence })),
    unverified: [],
    rejections: [],
  }) as unknown as Buckets

describe('found or verified', () => {
  it('says found when a question settled nothing', () => {
    // Only a place was named, so nothing was ever checked.
    expect(verified(buckets([[], []]))).toBe(false)
  })

  it('says verified once any fact has been settled', () => {
    // Applied inside the provider's own search, but checked all the same.
    expect(verified(buckets([[row('evaluated')]]))).toBe(true)
  })

  it('does not count a check that failed to complete', () => {
    expect(verified(buckets([[row('failed'), row('skipped')]]))).toBe(false)
  })
})
