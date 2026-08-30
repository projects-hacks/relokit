/**
 * One building, one card.
 *
 * A multi-unit building arrives as one listing per bedroom count, ids sharing
 * the building with the count appended. Three cards for one address is noise to
 * a reader, so siblings fold under whichever of them the current order put
 * first. Presentation only: every unit keeps its own evidence, verdicts and
 * place in the buckets, and grouping never crosses a bucket.
 */

const SPLIT = '#'

export function buildingOf(entityId: string): string {
  const at = entityId.indexOf(SPLIT)
  return at === -1 ? entityId : entityId.slice(0, at)
}

export interface Grouped<T> {
  primary: T
  /** The building's other units, in the same order the list had them. */
  siblings: T[]
}

export function groupSiblings<T extends { entity_id: string }>(rows: T[]): Grouped<T>[] {
  const byBuilding = new Map<string, Grouped<T>>()
  const out: Grouped<T>[] = []
  for (const row of rows) {
    const building = buildingOf(row.entity_id)
    const seen = row.entity_id.includes(SPLIT) ? byBuilding.get(building) : undefined
    if (seen) {
      seen.siblings.push(row)
      continue
    }
    const group: Grouped<T> = { primary: row, siblings: [] }
    if (row.entity_id.includes(SPLIT)) byBuilding.set(building, group)
    out.push(group)
  }
  return out
}
