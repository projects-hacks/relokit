/**
 * Asking again, politely, when the backend is the thing that failed.
 *
 * A run asks the backend once per operation, dozens of times, as fast as the
 * network allows. A hosted instance survives that steadily and not in a burst:
 * the heaviest call starts returning 502 from the gateway while reads still
 * answer, then everything returns 503 within a fifth of a second, and it comes
 * back on its own several minutes later. Under that, one refused call left
 * every listing it covered permanently unchecked, and a refused write ended the
 * whole run.
 *
 * The answer is to wait and ask again, and to wait longer each time. The wait
 * is randomised across its whole range rather than fixed, because the point of
 * backing off is to stop arriving together, and a fixed wait simply moves the
 * pile-up later.
 */
export interface RetryPolicy {
  attempts: number
  /** First wait, doubled each time. */
  base_ms: number
  /** However long the doubling says, never longer than this. */
  cap_ms: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

export const PATIENT: RetryPolicy = { attempts: 4, base_ms: 400, cap_ms: 6000 }

/** Nothing to gain by asking again: the request itself is what it objects to. */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'Refused'
  }
}

/**
 * A gateway that could not reach the application, a service saying it is
 * unavailable, a timeout, or too many requests. Anything the caller could fix
 * by changing the request is not one of these.
 */
export function worthRetrying(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600)
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function withRetry<T>(
  attempt: (tries: number) => Promise<T>,
  policy: RetryPolicy = PATIENT,
): Promise<T> {
  const sleep = policy.sleep ?? wait
  const random = policy.random ?? Math.random
  let last: unknown

  for (let tries = 0; tries < policy.attempts; tries += 1) {
    try {
      return await attempt(tries)
    } catch (error) {
      last = error
      // A refusal of the request will be refused again however long we wait.
      if (error instanceof Refused) throw error
      if (tries === policy.attempts - 1) break
      const ceiling = Math.min(policy.cap_ms, policy.base_ms * 2 ** tries)
      const after = error instanceof Waiting ? error.after_ms : null
      // Anywhere in the range, not the end of it: waiting the same length as
      // everybody else only moves the crowd along.
      await sleep(after ?? Math.round(random() * ceiling))
    }
  }
  throw last
}

/** A refusal that named its own wait, which is better than any guess. */
export class Waiting extends Error {
  constructor(
    message: string,
    readonly after_ms: number,
  ) {
    super(message)
    this.name = 'Waiting'
  }
}

/** Seconds, or an HTTP date. Ignored when it asks for longer than a minute. */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
  return ms > 0 && ms <= 60_000 ? Math.round(ms) : null
}
