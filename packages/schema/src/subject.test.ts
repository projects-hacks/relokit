import { describe, expect, it } from 'vitest'
import { subjectFromQuery, termFromQuery } from './subject.ts'

describe('what a question asks for, in its own words', () => {
  const term = (q: string) => {
    const subject = subjectFromQuery(q)
    return subject ? termFromQuery(q, subject) : null
  }

  it('keeps the qualifier that decides which places are right', () => {
    // Searched as plain restaurants, this returned an Irish pub.
    expect(term('mexican restaurants near me open past 10pm')).toBe('mexican restaurants')
  })

  it('keeps a qualifier of more than one word', () => {
    expect(term('24 hour gyms in Austin')).toBe('24 hour gyms')
  })

  it('says nothing when only the kind of thing was named', () => {
    expect(term('restaurants in San Jose')).toBeNull()
    expect(term('gyms near me')).toBeNull()
  })

  it('does not mistake the sentence itself for a description', () => {
    // "show me" and "find" describe the asking, not the thing.
    expect(term('show me restaurants near me')).toBeNull()
    expect(term('find a gym in Austin')).toBeNull()
  })

  it('stops at the words that introduce a place', () => {
    // "in San Jose" must not become part of what is searched for.
    expect(term('vegan cafes in San Jose')).toBe('vegan cafes')
  })
})
