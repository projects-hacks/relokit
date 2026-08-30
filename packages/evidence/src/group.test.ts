import { describe, expect, it } from 'vitest'
import { groupSiblings } from './group.ts'

const row = (entity_id: string) => ({ entity_id })

describe('one building, one card', () => {
  it('folds a building’s units under whichever the order put first', () => {
    const grouped = groupSiblings([
      row('zillow:b1#1bed'),
      row('zillow:other'),
      row('zillow:b1#2bed'),
      row('zillow:b1#0bed'),
    ])
    expect(grouped.map((group) => group.primary.entity_id)).toEqual([
      'zillow:b1#1bed',
      'zillow:other',
    ])
    expect(grouped[0]!.siblings.map((sibling) => sibling.entity_id)).toEqual([
      'zillow:b1#2bed',
      'zillow:b1#0bed',
    ])
  })

  it('never groups listings that are not unit splits', () => {
    // Two whole homes are two homes, whatever their ids share.
    const grouped = groupSiblings([row('zillow:19559319'), row('zillow:19559320')])
    expect(grouped).toHaveLength(2)
  })

  it('leaves a lone unit alone', () => {
    const grouped = groupSiblings([row('zillow:b1#2bed')])
    expect(grouped).toEqual([{ primary: row('zillow:b1#2bed'), siblings: [] }])
  })
})
