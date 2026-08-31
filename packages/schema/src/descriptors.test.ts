import { describe, expect, it } from 'vitest'
import { descriptorsFromQuery, reachFromQuery } from './measures.ts'

const read = (q: string) =>
  descriptorsFromQuery(q, (i) => `c${i + 1}`).map((c) => ({
    text: c.text,
    want: c.want,
    hardness: c.hardness,
  }))

describe('how far, when nobody gives a number', () => {
  it('reads the phrase people actually use', () => {
    expect(reachFromQuery('restaurants within walking distance of Santana Row')).toEqual({
      meters: 1200,
      text: 'walking distance',
    })
  })

  it('knows a drive is further than a walk', () => {
    expect(reachFromQuery('a short drive from the office')?.meters).toBe(5000)
  })

  it('says nothing when a distance was given properly', () => {
    expect(reachFromQuery('restaurants within 2 miles of Santana Row')).toBeNull()
  })
})

describe('what a place must be, and must not', () => {
  it('reads a refusal as a rule', () => {
    // Dropped in silence until now.
    expect(read('restaurants in San Jose, not a chain')).toEqual([
      { text: 'chain', want: 'without', hardness: 'hard' },
    ])
  })

  it('reads a wish as a preference that only ranks', () => {
    expect(read('cafes with outdoor seating')).toEqual([
      { text: 'outdoor seating', want: 'with', hardness: 'soft' },
    ])
  })

  it('takes both at once', () => {
    const both = read('bars with live music, no sports bar')
    expect(both.map((c) => c.want).sort()).toEqual(['with', 'without'])
  })

  it('stops at the words that introduce a place', () => {
    expect(read('restaurants with outdoor seating in San Jose')).toEqual([
      { text: 'outdoor seating', want: 'with', hardness: 'soft' },
    ])
  })

  it('ignores words that describe the asking rather than the place', () => {
    expect(read('show me more restaurants')).toEqual([])
  })
})
