import { describe, expect, it } from 'vitest'
import { Refused, Waiting, retryAfterMs, withRetry, worthRetrying } from './retry.ts'

/** No real waiting: the delays are recorded so they can be read. */
function recorder() {
  const waited: number[] = []
  return {
    waited,
    policy: {
      attempts: 4,
      base_ms: 400,
      cap_ms: 6000,
      sleep: async (ms: number) => void waited.push(ms),
      // The middle of the range, so a doubling is visible rather than random.
      random: () => 0.5,
    },
  }
}

describe('asking again when the backend was the thing that failed', () => {
  it('gets an answer once the instance comes back', async () => {
    const { policy, waited } = recorder()
    let tries = 0
    const answer = await withRetry(async () => {
      tries += 1
      if (tries < 3) throw new Error('/op returned 502: <html>')
      return 'the answer'
    }, policy)
    expect(answer).toBe('the answer')
    expect(tries).toBe(3)
    expect(waited).toEqual([200, 400])
  })

  it('waits longer each time, and never longer than the cap', async () => {
    const { policy, waited } = recorder()
    await withRetry(async () => {
      throw new Error('502')
    }, policy).catch(() => {})
    // Half of 400, 800, 1600. Doubling, and bounded.
    expect(waited).toEqual([200, 400, 800])
    expect(Math.max(...waited)).toBeLessThanOrEqual(policy.cap_ms)
  })

  it('spreads the waiting across its range rather than fixing it', async () => {
    // Every caller waiting the same length only moves the pile-up later.
    const seen = new Set<number>()
    for (const value of [0, 0.25, 0.9]) {
      const waited: number[] = []
      await withRetry(
        async () => {
          throw new Error('503')
        },
        {
          attempts: 2,
          base_ms: 1000,
          cap_ms: 6000,
          sleep: async (ms) => void waited.push(ms),
          random: () => value,
        },
      ).catch(() => {})
      seen.add(waited[0]!)
    }
    expect(seen.size).toBe(3)
  })

  it('does not argue with a refusal of the request itself', async () => {
    const { policy, waited } = recorder()
    let tries = 0
    await expect(
      withRetry(async () => {
        tries += 1
        throw new Refused('/op returned 400: no such capability', 400)
      }, policy),
    ).rejects.toThrow(/400/)
    // Asked once. A bad request is bad however long anyone waits.
    expect(tries).toBe(1)
    expect(waited).toEqual([])
  })

  it('waits as long as it was asked to', async () => {
    const { policy, waited } = recorder()
    let tries = 0
    await withRetry(async () => {
      tries += 1
      if (tries === 1) throw new Waiting('429', 1500)
      return 'ok'
    }, policy)
    expect(waited).toEqual([1500])
  })

  it('gives up eventually rather than asking forever', async () => {
    const { policy } = recorder()
    let tries = 0
    await expect(
      withRetry(async () => {
        tries += 1
        throw new Error('502')
      }, policy),
    ).rejects.toThrow(/502/)
    expect(tries).toBe(4)
  })
})

describe('which failures are worth asking again about', () => {
  it('takes a gateway that could not reach the application', () => {
    for (const status of [500, 502, 503, 504]) expect(worthRetrying(status)).toBe(true)
  })

  it('takes being told to slow down', () => {
    expect(worthRetrying(429)).toBe(true)
    expect(worthRetrying(408)).toBe(true)
  })

  it('leaves anything the caller would have to fix', () => {
    for (const status of [400, 401, 403, 404]) expect(worthRetrying(status)).toBe(false)
  })
})

describe('a wait the server named itself', () => {
  it('reads seconds', () => expect(retryAfterMs('2')).toBe(2000))
  it('ignores nonsense', () => expect(retryAfterMs('soon')).toBeNull())
  it('ignores nothing at all', () => expect(retryAfterMs(null)).toBeNull())
  it('ignores a wait longer than anyone would sit through', () =>
    expect(retryAfterMs('600')).toBeNull())
})
