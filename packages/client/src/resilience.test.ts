import { describe, expect, it } from 'vitest'
import { ask } from './index.ts'
import { QUERY, RENTAL_QUERY, backend, impatient } from './fake.ts'

/**
 * What a stranger gets when the backend is having a bad minute.
 *
 * The hosted instance does not fail cleanly under a burst. The heaviest call
 * starts returning a gateway page while reads still answer, then everything
 * refuses for a few minutes, then it recovers. A run is dozens of calls, so it
 * meets that, and the question is only ever what the reader is left holding.
 *
 * These drive the whole of ask() against a backend behaving badly on purpose,
 * because every part of it passed its own tests while the page still said the
 * run had stopped.
 */

describe('a run that meets a backend having a bad minute', () => {
  it('asks a metered call once, however badly it fails', async () => {
    // A search that fails after the provider answered has been paid for, so
    // asking again pays twice. Measured live: forty six planned, fifty spent.
    //
    // The handover is refused here, which is what drops a run back to asking
    // one call at a time. That fallback is the path with no queue behind it,
    // so it is the one that must never repeat a call.
    const { transport, posts } = backend({ '/jobs': { times: 99 }, '/op': { times: 1 } })
    const result = await ask(transport, QUERY, { retry: impatient })
    const asked = posts
      .filter((post) => post.path === '/op')
      .map((post) => (post.body as { op_id?: string }).op_id)
    expect(asked.length).toBeGreaterThan(0)
    // No call travelled twice, including the one that failed, and including
    // when the caller asked for patience on the calls that cost nothing.
    expect(new Set(asked).size).toBe(asked.length)
    // The run still ends, and says what it could not do rather than stopping.
    expect(result.problems.length).toBeGreaterThan(0)
  })

  it('waits and asks again for the calls that cost nothing', async () => {
    // The parse is free to repeat, so a bad minute there is worth sitting out.
    const { transport, seen } = backend({ '/parse': { times: 2 } })
    await ask(transport, QUERY, { retry: impatient })
    expect(seen.filter((path) => path === '/parse').length).toBe(3)
  })

  it('still answers when the answer cannot be filed', async () => {
    // Keeping the record is not what the reader asked for.
    const { transport } = backend({ '/ingest': { times: 99 } })
    const result = await ask(transport, QUERY, { retry: impatient })
    expect(result.entities.length).toBeGreaterThan(0)
    expect(result.problems.map((problem) => problem.op_id)).toContain('keeping')
  })

  it('says so, rather than pretending the filing worked', async () => {
    const { transport } = backend({ '/ingest': { times: 99 } })
    const result = await ask(transport, QUERY, { retry: impatient })
    expect(result.problems.find((problem) => problem.op_id === 'keeping')?.detail).toMatch(
      /could not be filed/,
    )
  })

  it('still answers when the tallies cannot be read back', async () => {
    const { transport } = backend({ '/runs': { times: 99 } })
    const result = await ask(transport, QUERY, { retry: impatient })
    expect(result.entities.length).toBeGreaterThan(0)
    // Falls back to what was counted here rather than showing a blank.
    expect(result.cost.naive_units).toBeGreaterThan(0)
  })

  it('stops when the question itself could never be answered', async () => {
    // Not everything is worth surviving: with no parse there is nothing to run.
    const { transport } = backend({ '/parse': { times: 99 } })
    await expect(ask(transport, QUERY, { retry: impatient })).rejects.toThrow(/502/)
  })
})

describe('a stage handed to the queue', () => {
  it('one poisoned job fails alone; its neighbours keep their answers', async () => {
    // One of the four ride calls dies on every attempt. It must come back as a
    // problem on the answer, not as a reason to re-ask the whole group, and its
    // neighbours in the same handover must keep what they were told.
    const { transport } = backend({}, [5])
    const result = await ask(transport, RENTAL_QUERY, { retry: impatient })
    expect(result.entities.length).toBeGreaterThan(0)
    expect(result.problems.some((problem) => /could not settle/.test(problem.detail))).toBe(true)
    // The neighbours were answered: at least one home carries a measured ride.
    expect(
      result.evidence.some((row) => row.constraint_type === 'commute' && row.verdict !== 'unknown'),
    ).toBe(true)
  })

  it('a poll that dies loses nothing; the next one carries on', async () => {
    const { transport, seen } = backend({ '/jobs/run': { times: 1 } })
    const result = await ask(transport, RENTAL_QUERY, { retry: impatient })
    expect(result.entities.length).toBeGreaterThan(0)
    expect(
      seen.filter((path) => path === '/jobs/run').length,
      `paths seen: ${JSON.stringify([...new Set(seen)])} | entities ${result.entities.length} | evidence kinds ${JSON.stringify([...new Set(result.evidence.map((r) => r.constraint_type))])}`,
    ).toBeGreaterThan(1)
  })
})
