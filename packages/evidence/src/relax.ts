import type { Constraint, EvidenceRow, RejectedEntity, UnverifiedEntity } from '@relokit/schema'
import type { Buckets } from './buckets.ts'
import { formatDistance } from './distance.ts'

/**
 * What one small change to the question would buy.
 *
 * Every fact in a finished run has already been paid for, so asking "and if the
 * ride could be twenty eight minutes?" costs nothing at all: the routes are
 * already measured and the answer is a comparison against a different number.
 *
 * This only ever reports homes blocked by exactly one thing. A home failing two
 * constraints is not unlocked by relaxing one of them, and offering it would be
 * the same false promise as counting an unknown as a pass.
 */

export interface RelaxationStep {
  /** The new bound, in the constraint's canonical unit. */
  to: number
  display_to: string
  /** Homes that would move into the verified bucket at this bound. */
  unlocks: number
  entity_ids: string[]
}

export interface Relaxation {
  constraint_id: string
  constraint_type: Constraint['type']
  kind: 'raise_bound' | 'drop_requirement'
  from: number | null
  display_from: string
  source_text: string
  /** Homes this constraint is the only thing standing in front of. */
  sole_blocker_count: number
  steps: RelaxationStep[]
}

export interface RelaxOptions {
  /** How many alternative bounds to offer per constraint. */
  max_steps?: number
  /** Ignore a change larger than this share of the current bound. */
  max_stretch?: number
}

export function relaxations(
  buckets: Buckets,
  constraints: Constraint[],
  options: RelaxOptions = {},
): Relaxation[] {
  const maxSteps = options.max_steps ?? 3
  const maxStretch = options.max_stretch ?? 0.5
  const byId = new Map(constraints.map((c) => [c.id, c]))

  // Only rejections are considered. An unverified home is not blocked by a
  // number, it is blocked by not knowing, and no change to the question fixes
  // that.
  const soleBlocked = new Map<string, { entity_id: string; evidence: EvidenceRow[] }[]>()
  for (const rejected of buckets.rejections) {
    if (rejected.failed_constraint_ids.length !== 1) continue
    const id = rejected.failed_constraint_ids[0]!
    const bucket = soleBlocked.get(id) ?? []
    bucket.push({ entity_id: rejected.entity_id, evidence: rejected.evidence })
    soleBlocked.set(id, bucket)
  }

  const result: Relaxation[] = []

  for (const [constraintId, blocked] of soleBlocked) {
    const constraint = byId.get(constraintId)
    if (!constraint) continue

    const bound = boundOf(constraint)
    const base = {
      constraint_id: constraintId,
      constraint_type: constraint.type,
      source_text: constraint.source_text,
      sole_blocker_count: blocked.length,
    }

    if (bound === null) {
      // Nothing to move. Dropping the requirement is the only lever.
      result.push({
        ...base,
        kind: 'drop_requirement',
        from: null,
        display_from: constraint.source_text,
        steps: [
          {
            to: 0,
            display_to: 'without it',
            unlocks: blocked.length,
            entity_ids: blocked.map((b) => b.entity_id).sort(),
          },
        ],
      })
      continue
    }

    // Each blocked home has a measured value. Sorted, they are the only bounds
    // worth offering: any number between two of them unlocks the same homes.
    //
    // Only values that actually exceed the bound count. A home can fail a
    // proximity constraint with a gym well inside the radius, because the gym
    // was shut rather than far, and moving the radius would not reach it. The
    // measured distance is not always the reason it failed.
    const values = blocked
      .map((entry) => ({
        entity_id: entry.entity_id,
        value: numericValue(entry.evidence, constraintId),
      }))
      .filter((entry): entry is { entity_id: string; value: number } => entry.value !== null)
      .filter((entry) => entry.value > bound)
      .sort((a, b) => a.value - b.value)

    const steps: RelaxationStep[] = []
    for (const { value } of values) {
      if (steps.some((step) => step.to === value)) continue
      if ((value - bound) / bound > maxStretch) break
      const unlocked = values.filter((v) => v.value <= value)
      steps.push({
        to: value,
        display_to: format(constraint, value),
        unlocks: unlocked.length,
        entity_ids: unlocked.map((v) => v.entity_id).sort(),
      })
      if (steps.length === maxSteps) break
    }

    if (steps.length === 0) continue
    result.push({
      ...base,
      kind: 'raise_bound',
      from: bound,
      display_from: format(constraint, bound),
      steps,
    })
  }

  // The constraint standing in front of the most homes is the one worth asking
  // about first.
  return result.sort(
    (a, b) =>
      b.sole_blocker_count - a.sole_blocker_count || (a.constraint_id < b.constraint_id ? -1 : 1),
  )
}

/** The number a constraint could be moved, or null when it is not a number. */
function boundOf(constraint: Constraint): number | null {
  switch (constraint.type) {
    case 'budget':
      return constraint.max_cents ?? null
    case 'commute':
      return constraint.max_seconds
    case 'nearby_poi':
      return constraint.radius_m
    default:
      return null
  }
}

function numericValue(evidence: EvidenceRow[], constraintId: string): number | null {
  const row = evidence.find((e) => e.constraint_id === constraintId)
  return typeof row?.value_canonical === 'number' ? row.value_canonical : null
}

function format(constraint: Constraint, value: number): string {
  switch (constraint.type) {
    case 'budget':
      return `$${Math.round(value / 100).toLocaleString('en-US')}`
    case 'commute':
      return `${Math.round(value / 60)} min`
    case 'nearby_poi':
      return formatDistance(value)
    default:
      return String(value)
  }
}

/** Homes that no single change would reach, so nothing pretends otherwise. */
export function beyondReach(buckets: Buckets): (RejectedEntity | UnverifiedEntity)[] {
  return buckets.rejections.filter((r) => r.failed_constraint_ids.length > 1)
}

/**
 * The inverse of an offer: the same question with one bound moved.
 *
 * Only the named requirement changes, and it is marked inferred, because the
 * number stopped being the one the person wrote the moment they accepted a
 * different one.
 */
export function applyRelaxation(
  constraints: Constraint[],
  constraintId: string,
  to: number,
): Constraint[] {
  return constraints.map((constraint) => {
    if (constraint.id !== constraintId) return constraint
    switch (constraint.type) {
      case 'budget':
        return { ...constraint, max_cents: Math.round(to), inferred: true }
      case 'commute':
        return { ...constraint, max_seconds: Math.round(to), inferred: true }
      case 'nearby_poi':
        return { ...constraint, radius_m: Math.round(to), inferred: true }
      default:
        // Nothing else has a number to move. A requirement without one is
        // dropped in the question rather than nudged here.
        return constraint
    }
  })
}
