import { useCallback, useEffect, useRef, useState } from 'react'
import { ask, httpTransport, type AskEvent, type AskResult } from '@relokit/client'
import type { ConstraintSet } from '@relokit/schema'
import { forget, recall, remember } from './lib/remember.ts'

/**
 * One question, and everything that happened on the way to answering it.
 *
 * The events arrive as the run proceeds, so the interface can show the plan
 * before any call has been made and the narrowing as each stage reports. What is
 * shown is always what has actually happened, never an animation towards a
 * number already known.
 */
export interface AskState {
  status: 'idle' | 'running' | 'done' | 'failed'
  events: AskEvent[]
  result: AskResult | null
  /** What is being asked right now, so the question stays on screen while it
   * runs, wherever it was typed. */
  query: string | null
  error: string | null
  /** True while showing an answer from a previous visit rather than this one. */
  restored: { query: string; at: number } | null
}

const api = '/api'
const orgKey = ''

export function useAsk() {
  // ?demo restores the committed fixture run instead of asking anything, so
  // every screen can be shown with no backend reachable at all.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('demo')) return
    fetch('/demo-run.json')
      .then((response) => response.json())
      .then(({ query, result }: { query: string; result: AskResult }) =>
        setState({
          status: 'done',
          events: [],
          result,
          query,
          error: null,
          restored: { query, at: Date.now() },
        }),
      )
      .catch(() => {
        // The fixture is optional; without it the page just starts empty.
      })
  }, [])

  // The last answer comes back on a reload. Coming back to a decision an hour
  // later should not mean asking every source again.
  const [state, setState] = useState<AskState>(() => {
    const previous = recall()
    return previous
      ? {
          status: 'done',
          events: [],
          result: previous.result,
          query: previous.query,
          error: null,
          restored: { query: previous.query, at: previous.at },
        }
      : { status: 'idle', events: [], result: null, query: null, error: null, restored: null }
  })

  const controller = useRef<AbortController | null>(null)

  const run = useCallback(async (query: string, constraints?: ConstraintSet) => {
    controller.current?.abort()
    const own = new AbortController()
    controller.current = own
    setState({ status: 'running', events: [], result: null, query, error: null, restored: null })
    try {
      const result = await ask(httpTransport(api, orgKey), query, {
        onProgress: (event) =>
          setState((previous) => ({ ...previous, events: [...previous.events, event] })),
        signal: own.signal,
        ...(constraints ? { constraints } : {}),
      })
      remember(query, result)
      setState((previous) => ({ ...previous, status: 'done', result }))
    } catch (error) {
      // Stopping is the reader's act, not a failure to report.
      if (own.signal.aborted) return
      setState((previous) => ({
        ...previous,
        status: 'failed',
        error: friendlyError(error),
      }))
    }
  }, [])

  // Back to quiet. Everything already fetched stays in the ledger, so asking
  // again later starts from where this left off.
  const stop = useCallback(() => {
    controller.current?.abort()
    setState({ status: 'idle', events: [], result: null, query: null, error: null, restored: null })
  }, [])

  // Throwing away the previous answer is a deliberate act, not a side effect of
  // arriving on the page.
  const dismiss = useCallback(() => {
    forget()
    setState({ status: 'idle', events: [], result: null, query: null, error: null, restored: null })
  }, [])

  return { ...state, run, stop, dismiss }
}

/**
 * Failures stay specific. "The search allowance for this month is used up" says
 * what happened and what to do; a generic retry line says neither, and being
 * plain about what could not be done is the point of the product. Only the
 * transport's own noise is translated.
 */
function friendlyError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  const body = detail.match(/returned \d+: (.*)$/s)?.[1]
  if (body) {
    try {
      const message = (JSON.parse(body) as { message?: string }).message
      if (message) return message
    } catch {
      // Not JSON. Markup is a gateway page, not a sentence anyone wrote.
      if (body.trimStart().startsWith('<')) {
        return 'The search service stumbled mid-run. Ask again; what was already fetched is kept.'
      }
    }
  }
  if (/Failed to fetch|NetworkError|fetch failed|ECONNREFUSED/.test(detail)) {
    return 'The search service could not be reached. Check the connection and try again.'
  }
  return detail
}
