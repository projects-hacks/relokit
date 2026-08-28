import type { Capability } from '@relokit/schema'

/**
 * Every candidate count estimate lives here, so the numbers driving the plan are
 * auditable in one file rather than scattered through the planner.
 *
 * These are estimates made before any call has returned. Xano reports the
 * measured entities_out per stage back into the run record, and the UI renders
 * the measurement, never the estimate.
 */

/** Rentals inside the demo bounding box. Measured 28 Aug 2026, not invented. */
export const SEED_REGION_CANDIDATES = 4517

export const ZILLOW_RESULTS_PER_PAGE = 41

/**
 * The fraction of candidates a capability lets through.
 *
 * A capability only eliminates what it can actually answer. Where it returns
 * `unknown` the entity survives, because an unknown is not a failure. So the
 * pass fraction is 1 minus the part it both covers and rejects, and the part it
 * covers and rejects is exactly the numerator of the ordering score.
 */
export function passFraction(capability: Capability): number {
  // A native predicate is applied by the provider, which does not return what
  // fails. There is no unknown left behind to survive on, so coverage here
  // describes how much of what came back we can cite, not how much gets through.
  if (capability.granularity === 'native') return capability.selectivity_prior
  return 1 - eliminationPower(capability.coverage, capability.selectivity_prior)
}

export function eliminationPower(coverage: number, selectivity_prior: number): number {
  return coverage * (1 - selectivity_prior)
}

export function survivors(entities: number, capabilities: Capability[]): number {
  const fraction = capabilities.reduce((acc, c) => acc * passFraction(c), 1)
  return Math.max(1, Math.round(entities * fraction))
}

export function pagesFor(candidates: number): number {
  return Math.max(1, Math.ceil(candidates / ZILLOW_RESULTS_PER_PAGE))
}
