import type {
  Constraint,
  EvidenceRow,
  Place,
  RankedEntity,
  RejectedEntity,
  UnverifiedEntity,
} from '@relokit/schema'

export interface Buckets {
  results: RankedEntity[]
  unverified: UnverifiedEntity[]
  rejections: RejectedEntity[]
}

/**
 * Three buckets, never two.
 *
 * A rejection needs verdict `fail` and eval_state `evaluated` on a hard
 * constraint. Everything else that falls short of a full pass is unverified.
 * "We could not check" and "it does not qualify" are different answers, and
 * folding one into the other is where a tool starts lying.
 */
export function bucket(
  entities: Place[],
  evidence: EvidenceRow[],
  constraints: Constraint[],
): Buckets {
  const byEntity = new Map<string, EvidenceRow[]>()
  for (const evidenceRow of evidence) {
    const rows = byEntity.get(evidenceRow.entity_id)
    if (rows) rows.push(evidenceRow)
    else byEntity.set(evidenceRow.entity_id, [evidenceRow])
  }

  const hard = constraints.filter((c) => c.hardness === 'hard')
  const buckets: Buckets = { results: [], unverified: [], rejections: [] }

  for (const entity of entities) {
    const rows = best(byEntity.get(entity.entity_id) ?? [])
    const byConstraint = new Map(rows.map((r) => [r.constraint_id, r]))

    const failed = hard
      .filter((c) => {
        const evidenceRow = byConstraint.get(c.id)
        return evidenceRow?.verdict === 'fail' && evidenceRow.eval_state === 'evaluated'
      })
      .map((c) => c.id)

    if (failed.length > 0) {
      buckets.rejections.push({
        entity_id: entity.entity_id,
        failed_constraint_ids: failed,
        evidence: rows,
      })
      continue
    }

    const unknown = hard
      .filter((c) => {
        const evidenceRow = byConstraint.get(c.id)
        return (
          !evidenceRow || evidenceRow.verdict !== 'pass' || evidenceRow.eval_state !== 'evaluated'
        )
      })
      .map((c) => c.id)

    if (unknown.length > 0) {
      buckets.unverified.push({
        entity_id: entity.entity_id,
        unknown_constraint_ids: unknown,
        evidence: rows,
      })
      continue
    }

    buckets.results.push({
      entity_id: entity.entity_id,
      score: score(rows, constraints, 0),
      evidence: rows,
    })
  }

  buckets.results.sort((a, b) => b.score - a.score || compareIds(a.entity_id, b.entity_id))
  buckets.unverified.sort(
    (a, b) =>
      a.unknown_constraint_ids.length - b.unknown_constraint_ids.length ||
      score(b.evidence, constraints, b.unknown_constraint_ids.length) -
        score(a.evidence, constraints, a.unknown_constraint_ids.length) ||
      compareIds(a.entity_id, b.entity_id),
  )
  buckets.rejections.sort(
    (a, b) =>
      a.failed_constraint_ids.length - b.failed_constraint_ids.length ||
      compareIds(a.entity_id, b.entity_id),
  )

  return buckets
}

/**
 * Two sources can answer the same question about the same listing: a cluster
 * estimate and an exact per-listing measurement. The exact one wins, which is
 * what capability precedence is for. Here it is the later, more confident row.
 */
function best(rows: EvidenceRow[]): EvidenceRow[] {
  const winner = new Map<string, EvidenceRow>()
  for (const row of rows) {
    const incumbent = winner.get(row.constraint_id)
    if (!incumbent || row.confidence > incumbent.confidence) winner.set(row.constraint_id, row)
  }
  return [...winner.values()].sort((a, b) => compareIds(a.constraint_id, b.constraint_id))
}

/**
 * How comfortably a listing clears the limits it was given, not how many boxes
 * it ticks. Rent well under the cap and a short ride beat scraping past both.
 */
export function score(
  rows: EvidenceRow[],
  constraints: Constraint[],
  unknownHardCount: number,
): number {
  const byConstraint = new Map(rows.map((r) => [r.constraint_id, r]))
  let weighted = 0
  let weight = 0

  for (const constraint of constraints) {
    const row = byConstraint.get(constraint.id)
    const w = constraint.weight || 1
    weight += w
    weighted += w * comfort(constraint, row)
  }

  const base = weight === 0 ? 0 : weighted / weight
  // A verified listing outranks an unverified one that looks equally good.
  return round(base * 0.85 ** unknownHardCount)
}

function comfort(constraint: Constraint, row: EvidenceRow | undefined): number {
  // Neutral rather than good or bad. Not knowing is not evidence either way.
  if (!row || typeof row.value_canonical !== 'number') return 0.5

  const value = row.value_canonical
  switch (constraint.type) {
    case 'budget':
      return constraint.max_cents
        ? clamp((constraint.max_cents - value) / constraint.max_cents)
        : 0.5
    case 'commute':
      return clamp((constraint.max_seconds - value) / constraint.max_seconds)
    case 'nearby_poi':
      return clamp((constraint.radius_m - value) / constraint.radius_m)
    case 'area_signal': {
      const density = clamp(value / 10)
      return constraint.polarity === 'negative' ? 1 - density : density
    }
    default:
      return row.verdict === 'pass' ? 1 : 0
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
