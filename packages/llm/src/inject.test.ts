import { describe, expect, it } from 'vitest'
import { normalizeConstraintSet } from './normalize.ts'

const meta = { query_id: 'q', parser_version: 'parse.v1.md', parsed_at_ms: 1_756_000_000_000 }

describe('what a question says about how good and how dear', () => {
  it('reaches the constraint set even when the model does not mention it', () => {
    const { constraint_set } = normalizeConstraintSet(
      { subject: 'restaurant', location: 'San Jose', constraints: [] },
      'cheap mexican restaurants in San Jose open past 10pm',
      meta,
    )
    const measures = constraint_set.constraints.filter((c) => c.type === 'attribute')
    expect(measures).toHaveLength(1)
    expect(measures[0]).toMatchObject({ measure: 'price_level', max: 2, inferred: true })
  })

  it('adds nothing to a question that mentioned neither', () => {
    const { constraint_set } = normalizeConstraintSet(
      { subject: 'restaurant', location: 'San Jose', constraints: [] },
      'restaurants in San Jose',
      meta,
    )
    expect(constraint_set.constraints.filter((c) => c.type === 'attribute')).toHaveLength(0)
  })
})

describe('a guess beside a reading', () => {
  it('drops what the model filed elsewhere under the same words', () => {
    // With nowhere to put "cheap", a model files it as neighbourhood news,
    // which costs a search to answer badly.
    const { constraint_set } = normalizeConstraintSet(
      {
        subject: 'restaurant',
        location: 'San Jose',
        constraints: [
          {
            id: 'c1',
            type: 'area_signal',
            hardness: 'soft',
            weight: 0.5,
            source_text: 'cheap',
            topic: 'development',
            polarity: 'positive',
            lookback_days: 90,
          },
        ],
      },
      'cheap restaurants in San Jose',
      meta,
    )
    expect(constraint_set.constraints.map((c) => c.type)).toEqual(['attribute'])
  })
})

describe('a reading must not delete itself', () => {
  it('keeps what it read while dropping the guess at the same words', () => {
    // Asking whether a constraint was of some kind removed the readings too,
    // because a reading matches its own words.
    const { constraint_set } = normalizeConstraintSet(
      { subject: 'restaurant', location: 'San Jose', constraints: [] },
      'cheap restaurants in San Jose, not a chain',
      meta,
    )
    const types = constraint_set.constraints.map((c) => c.type).sort()
    expect(types).toEqual(['attribute', 'descriptor'])
  })
})
