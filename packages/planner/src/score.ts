import type { Capability, Tier } from '@relokit/schema'
import { eliminationPower } from './cardinality.ts'

/** Free predicates, then region, then cluster, then entity. Never the reverse. */
export const TIER_ORDER: readonly Tier[] = ['native', 'region', 'cluster', 'entity']

export function tierRank(tier: Tier): number {
  return TIER_ORDER.indexOf(tier)
}

export interface ScoreInputs {
  selectivity_prior: number
  coverage: number
  cost_units: number
  entities_requiring_evaluation: number
}

/**
 * Candidates eliminated per call.
 *
 *   ((1 - selectivity_prior) * coverage) / (cost_units * entities_requiring_evaluation)
 *
 * selectivity_prior is the fraction expected to PASS. Getting that direction
 * backwards inverts every plan, which is why it has its own test.
 *
 * Native capabilities cost nothing, so the score is unbounded and meaningless.
 * They are not scored: they run first, ordered by precedence.
 */
export function scoreCapability(input: ScoreInputs): number {
  const denominator = input.cost_units * input.entities_requiring_evaluation
  if (denominator === 0) return Number.POSITIVE_INFINITY
  return eliminationPower(input.coverage, input.selectivity_prior) / denominator
}

export interface Candidate {
  capability: Capability
  constraint_id: string
  tier: Tier
  entities_requiring_evaluation: number
  score: number
  score_rounded: number
}

export function scoreCandidate(
  capability: Capability,
  constraint_id: string,
  entities_requiring_evaluation: number,
): Candidate {
  const score = scoreCapability({
    selectivity_prior: capability.selectivity_prior,
    coverage: capability.coverage,
    cost_units: capability.cost_units,
    entities_requiring_evaluation,
  })
  return {
    capability,
    constraint_id,
    tier: capability.granularity,
    entities_requiring_evaluation,
    score,
    score_rounded: roundScore(score),
  }
}

/**
 * Scores are compared as rounded integers rather than with an epsilon. An epsilon
 * comparator is not transitive, which makes Array.sort order undefined and turns
 * a determinism test into a flaky one.
 */
export function roundScore(score: number): number {
  return Number.isFinite(score) ? Math.round(score * 1e9) : Number.MAX_SAFE_INTEGER
}

export function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    tierRank(a.tier) - tierRank(b.tier) ||
    b.score_rounded - a.score_rounded ||
    a.capability.precedence - b.capability.precedence ||
    (a.capability.capability_id < b.capability.capability_id ? -1 : 1)
  )
}
