import { numberOf, type EvidenceRow, type Place } from '@relokit/schema'

/**
 * Which results actually matter, once everything has been measured.
 *
 * Thirteen verified homes is still thirteen decisions. But if one is dearer,
 * further, and no better rated than another, no reasoning ends with choosing
 * it: it is beaten outright, and saying so is a fact of the evidence, not an
 * opinion. What is left is the efficient set: every result someone could pick
 * without being wrong on every count at once.
 */

export interface Standing {
  status: 'efficient' | 'beaten'
  /** Only on the beaten: who beats it, and on what. */
  beaten_by?: { entity_id: string; title: string; on: string[] }
}

interface Measured {
  entity_id: string
  title: string
  /** Dimension name to value, already oriented so that lower is better. */
  values: Record<string, number>
}

/**
 * One number per dimension per result, oriented so lower always wins. A rating
 * is negated rather than special-cased everywhere below.
 */
function measure(entity: Place, evidence: EvidenceRow[]): Measured {
  const values: Record<string, number> = {}
  if (entity.price_cents !== null) values.price = entity.price_cents

  const rating = numberOf(entity, 'rating')
  if (rating !== null) values.rating = -rating

  for (const row of evidence) {
    if (typeof row.value_canonical !== 'number' || row.eval_state !== 'evaluated') continue
    if (row.constraint_type === 'commute')
      values[`commute ${row.constraint_id}`] = row.value_canonical
    if (row.constraint_type === 'proximity' || row.constraint_type === 'nearby_poi') {
      values[`distance ${row.constraint_id}`] = row.value_canonical
    }
  }
  return { entity_id: entity.entity_id, title: entity.title, values }
}

/** How a win on an oriented dimension is said out loud. */
function said(dimension: string): string {
  if (dimension === 'price') return 'cheaper'
  if (dimension === 'rating') return 'better rated'
  if (dimension.startsWith('commute')) return 'quicker to reach'
  return 'closer'
}

/**
 * A beats B only when both were measured on the same dimensions, A is at least
 * as good on all of them, and strictly better on one. A result with an unknown
 * anywhere can never be called beaten: dominance is a claim about evidence,
 * and an absent number is not evidence of anything.
 */
export function frontier(
  entries: { entity_id: string; evidence: EvidenceRow[] }[],
  entities: Place[],
): Map<string, Standing> {
  const byId = new Map(entities.map((entity) => [entity.entity_id, entity]))
  const measured = entries
    .map((entry) => {
      const entity = byId.get(entry.entity_id)
      return entity ? measure(entity, entry.evidence) : null
    })
    .filter((entry): entry is Measured => entry !== null)

  const standings = new Map<string, Standing>()
  for (const candidate of measured) {
    const dimensions = Object.keys(candidate.values)
    let verdict: Standing = { status: 'efficient' }
    if (dimensions.length >= 2) {
      for (const rival of measured) {
        if (rival === candidate) continue
        if (!dimensions.every((d) => rival.values[d] !== undefined)) continue
        const wins = dimensions.filter((d) => rival.values[d]! < candidate.values[d]!)
        const losses = dimensions.filter((d) => rival.values[d]! > candidate.values[d]!)
        if (losses.length === 0 && wins.length > 0) {
          verdict = {
            status: 'beaten',
            beaten_by: {
              entity_id: rival.entity_id,
              title: rival.title,
              on: wins.map(said).filter((label, index, all) => all.indexOf(label) === index),
            },
          }
          break
        }
      }
    }
    standings.set(candidate.entity_id, verdict)
  }
  return standings
}
