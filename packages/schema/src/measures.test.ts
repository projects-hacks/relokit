import { describe, expect, it } from 'vitest'
import { measuresFromQuery } from './measures.ts'

const read = (q: string) =>
  measuresFromQuery(q, (i) => `c${i + 1}`, 'restaurant').map((c) => ({
    measure: c.measure,
    min: c.min,
    max: c.max,
  }))

describe('how good and how dear, read from the sentence', () => {
  it('says nothing about a kind of thing that has no such measure', () => {
    // A flat has no star rating and no price bracket, so asking put every
    // listing into "couldn't verify" and verified nothing at all.
    expect(measuresFromQuery('cheap flats in San Jose', (i) => `c${i + 1}`, 'rental')).toEqual([])
  })

  it('reads budget as a cap when a number follows it', () => {
    // "budget 3800 dollars" is what someone will spend, not a word for cheap.
    expect(
      measuresFromQuery(
        '2 bed near Seattle, budget 3800 dollars',
        (i) => `c${i + 1}`,
        'restaurant',
      ),
    ).toEqual([])
  })

  it('reads a price bracket from the ordinary word for it', () => {
    expect(read('cheap mexican restaurants in San Jose')).toEqual([
      { measure: 'price_level', min: undefined, max: 2 },
    ])
  })

  it('reads the other end of the scale', () => {
    expect(read('upscale dinner near Santana Row')).toEqual([
      { measure: 'price_level', min: 3, max: undefined },
    ])
  })

  it('understands money signs the way a provider counts them', () => {
    expect(read('$$ restaurants nearby')).toEqual([{ measure: 'price_level', min: 2, max: 2 }])
  })

  it('reads a rating floor said in words', () => {
    expect(read('well reviewed gyms in Austin')).toEqual([
      { measure: 'rating', min: 4, max: undefined },
    ])
  })

  it('reads a rating floor said in numbers', () => {
    expect(read('restaurants with 4.5 stars near me')).toEqual([
      { measure: 'rating', min: 4.5, max: undefined },
    ])
  })

  it('takes both when both were said', () => {
    expect(read('cheap well reviewed cafes')).toHaveLength(2)
  })

  it('finds nothing in a question that asked for neither', () => {
    expect(read('restaurants in San Jose open past 10pm')).toEqual([])
  })
})
