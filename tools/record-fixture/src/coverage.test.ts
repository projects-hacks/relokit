import { describe, expect, it } from 'vitest'
import { fieldCoverage, findRecords, termHits } from './coverage.ts'

const body = {
  search_metadata: { status: 'Success' },
  properties: [
    { zpid: '1', price: '$2,750/mo', beds: 1, latitude: 37.3, longitude: -121.9 },
    { zpid: '2', price: '$2,900/mo', beds: 1, latitude: 37.31, longitude: -121.91, unit: 'A' },
    { zpid: '3', price: null, beds: 2, latitude: 37.32, longitude: -121.92 },
  ],
}

describe('coverage report', () => {
  it('finds the record array wherever the provider put it', () => {
    expect(findRecords(body)).toMatchObject({ path: 'properties' })
    expect(findRecords(body).records).toHaveLength(3)
  })

  it('reports presence per field, counting null as absent', () => {
    const coverage = fieldCoverage(findRecords(body).records)
    const byKey = Object.fromEntries(coverage.map((c) => [c.key, c.pct]))
    expect(byKey.zpid).toBe(100)
    expect(byKey.price).toBe(67)
    expect(byKey.unit).toBe(33)
  })

  it('counts amenity terms anywhere in the response', () => {
    const hits = termHits({ a: 'In Unit Laundry', b: ['washer/dryer'] }, ['laundry', 'washer'])
    expect(hits).toEqual([
      { term: 'laundry', hits: 1 },
      { term: 'washer', hits: 1 },
    ])
  })
})
