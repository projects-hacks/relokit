import { describe, expect, it } from 'vitest'
import type { EvidenceRow, Place } from '@relokit/schema'

/**
 * The rule the executor applies when a search hands back a place it has already
 * seen, which paging makes routine: ask again from a later offset and any
 * overlap arrives twice.
 */
function absorb(
  entities: Place[],
  evidence: EvidenceRow[],
  mapped: { entities: Place[]; evidence: EvidenceRow[] },
) {
  const known = new Set(entities.map((entity) => entity.entity_id))
  const fresh = mapped.entities.filter((entity) => {
    if (known.has(entity.entity_id)) return false
    known.add(entity.entity_id)
    return true
  })
  const kept = new Set(fresh.map((entity) => entity.entity_id))
  entities.push(...fresh)
  evidence.push(...mapped.evidence.filter((row) => kept.has(row.entity_id)))
}

const place = (id: string) => ({ entity_id: id, title: id }) as Place
const fact = (id: string) => ({ entity_id: id, constraint_id: 'c1' }) as EvidenceRow

describe('a place seen twice', () => {
  it('is kept once, however many pages return it', () => {
    // The same restaurant filled the list several times over, and the counts
    // above the buckets counted it every time.
    const entities: Place[] = []
    const evidence: EvidenceRow[] = []
    absorb(entities, evidence, { entities: [place('a'), place('b')], evidence: [fact('a')] })
    absorb(entities, evidence, { entities: [place('b'), place('c')], evidence: [fact('b')] })
    expect(entities.map((e) => e.entity_id)).toEqual(['a', 'b', 'c'])
  })

  it('does not double the facts about it', () => {
    const entities: Place[] = []
    const evidence: EvidenceRow[] = []
    absorb(entities, evidence, { entities: [place('a')], evidence: [fact('a')] })
    absorb(entities, evidence, { entities: [place('a')], evidence: [fact('a')] })
    expect(evidence).toHaveLength(1)
  })

  it('still takes everything the first time', () => {
    const entities: Place[] = []
    const evidence: EvidenceRow[] = []
    absorb(entities, evidence, {
      entities: [place('a'), place('b')],
      evidence: [fact('a'), fact('b')],
    })
    expect(entities).toHaveLength(2)
    expect(evidence).toHaveLength(2)
  })
})
