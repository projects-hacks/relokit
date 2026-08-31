import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AskResult } from '@relokit/client'

/**
 * What must be true of any answer before a person reads it.
 *
 * Every fault found by hand so far was of one kind: something the engine
 * computed correctly and the interface then said badly. An offer to change ten
 * minutes to ten minutes, a restaurant under a heading about rent, the same
 * place drawn four times. None of them break a unit test of the part that made
 * them, because each part was right on its own.
 *
 * So these are checked against a whole answer, in the shape the screen gets it,
 * and each one is a sentence a reader would complain about if it were false.
 */
/**
 * Two answers of different kinds, because most of these faults appeared on the
 * newer path: somewhere to live, from a listing site, and somewhere to eat,
 * from a place search. What holds for one has to hold for the other.
 */
const load = (file: string) =>
  (
    JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', file), 'utf8')) as {
      result: AskResult
    }
  ).result

describe.each([
  ['somewhere to live', load('demo-run.json')],
  ['somewhere to eat', load('demo-places.json')],
])('an answer about %s, as a reader receives it', (_name, result) => {
  const entries = [
    ...result.buckets.results,
    ...result.buckets.unverified,
    ...result.buckets.rejections,
  ]

  it('names every result it lists', () => {
    // A bucket entry with no place behind it is a card with no name.
    const known = new Set(result.entities.map((entity) => entity.entity_id))
    expect(entries.filter((entry) => !known.has(entry.entity_id))).toEqual([])
  })

  it('lists no place twice', () => {
    // Paging returned the same restaurant repeatedly, and every count above the
    // buckets was inflated by it.
    const ids = result.entities.map((entity) => entity.entity_id)
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('puts each result in exactly one bucket', () => {
    const ids = entries.map((entry) => entry.entity_id)
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('shows a fact for every check it displays', () => {
    const empty = entries.flatMap((entry) =>
      entry.evidence.filter((row) => !row.display_value || row.display_value.trim() === ''),
    )
    expect(empty).toEqual([])
  })

  it('says where every fact came from and when', () => {
    const unsourced = entries.flatMap((entry) =>
      entry.evidence.filter((row) => !row.source || !row.fetched_at_ms),
    )
    expect(unsourced).toEqual([])
  })

  it('never writes an undefined or a NaN onto the screen', () => {
    const shown = entries.flatMap((entry) =>
      entry.evidence.flatMap((row) => [row.display_value, row.reason ?? '']),
    )
    expect(shown.filter((text) => /undefined|NaN|\[object/.test(text))).toEqual([])
  })

  it('offers no change to the number already set', () => {
    // "10 min → 10 min, adds 1" was on screen for a real question.
    const same = result.relaxations.flatMap((offer) =>
      offer.steps.filter((step) => step.display_to === offer.display_from),
    )
    expect(same).toEqual([])
  })

  it('offers each change once', () => {
    for (const offer of result.relaxations) {
      const labels = offer.steps.map((step) => step.display_to)
      expect(new Set(labels).size).toBe(labels.length)
    }
  })

  it('promises more with every further step', () => {
    // A longer stretch that reaches fewer places is arithmetic nobody believes.
    for (const offer of result.relaxations) {
      const counts = offer.steps.map((step) => step.unlocks)
      expect([...counts].sort((a, b) => a - b)).toEqual(counts)
    }
  })

  it('rules nothing out on a check that could not be made', () => {
    // The rule the whole product rests on: not knowing and not qualifying are
    // different answers.
    const wrong = result.buckets.rejections.filter(
      (entry) =>
        !entry.evidence.some((row) => row.verdict === 'fail' && row.eval_state === 'evaluated'),
    )
    expect(wrong).toEqual([])
  })

  it('counts what it claims to have looked at', () => {
    expect(entries.length).toBeLessThanOrEqual(result.entities.length)
  })
})
