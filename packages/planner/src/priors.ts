import type { Capability, ConstraintSet, ObservationRow, PriorBasis } from '@relokit/schema'
import { stableHash } from './params.ts'

/** Below this many decisive answers a measurement is noise and the guess stands. */
export const DECISIVE_THRESHOLD = 10

/**
 * Where this search happens, hashed. Text is the only place signal that exists
 * at plan time, and the anchor is an address somebody typed, so what is stored
 * and served back is a hash of it: enough to recognise the same place twice,
 * and nothing a stranger could read. Null when no place was named, or when the
 * anchor is the reader's own location, which must never pool different readers
 * under one key.
 */
export function regionKey(set: ConstraintSet): string | null {
  const raw = (set.search_anchor?.raw ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
  return raw === '' || raw === 'your location' ? null : stableHash(raw)
}

interface Tally {
  answered: number
  decisive: number
  passed: number
}

function sum(rows: ObservationRow[], capability_id: string, region: string | null): Tally {
  const tally: Tally = { answered: 0, decisive: 0, passed: 0 }
  for (const row of rows) {
    if (row.capability_id !== capability_id) continue
    if (region !== null && row.region !== region) continue
    tally.answered += row.answered
    tally.decisive += row.decisive
    tally.passed += row.passed
  }
  return tally
}

const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * The honesty ladder. A capability's numbers are measured in this place if
 * enough runs answered decisively here, measured anywhere if enough did at
 * all, and otherwise stay the registry's labelled guess. Nothing in between:
 * every number the planner sees is a measurement with its n, or an assumption
 * that says so. Priors route spend only; verdicts never read them.
 */
export function applyObservations(
  registry: Capability[],
  rows: ObservationRow[],
  region: string | null,
): Capability[] {
  return registry.map((capability) => {
    const here = region === null ? null : sum(rows, capability.capability_id, region)
    const anywhere = sum(rows, capability.capability_id, null)
    const enough = (tally: Tally) => tally.decisive >= DECISIVE_THRESHOLD && tally.answered > 0
    const chosen: { tally: Tally; basis: PriorBasis } | null =
      here !== null && enough(here)
        ? { tally: here, basis: 'measured_here' }
        : enough(anywhere)
          ? { tally: anywhere, basis: 'measured' }
          : null
    if (chosen === null) return { ...capability, prior_basis: 'assumed', observation_n: 0 }
    return {
      ...capability,
      selectivity_prior: round2(chosen.tally.passed / chosen.tally.decisive),
      coverage: round2(chosen.tally.decisive / chosen.tally.answered),
      prior_basis: chosen.basis,
      observation_n: chosen.tally.decisive,
    }
  })
}
