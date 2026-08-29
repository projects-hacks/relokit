import { useCallback, useState } from 'react'
import { ask, httpTransport, type AskEvent, type AskResult } from '@relokit/client'
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
  error: string | null
  /** True while showing an answer from a previous visit rather than this one. */
  restored: { query: string; at: number } | null
}

const api = import.meta.env.VITE_RELOKIT_API ?? ''
const orgKey = import.meta.env.VITE_RELOKIT_ORG_KEY ?? ''

export function useAsk() {
  // The last answer comes back on a reload. Coming back to a decision an hour
  // later should not mean asking every source again.
  const [state, setState] = useState<AskState>(() => {
    const previous = recall()
    return previous
      ? {
          status: 'done',
          events: [],
          result: previous.result,
          error: null,
          restored: { query: previous.query, at: previous.at },
        }
      : { status: 'idle', events: [], result: null, error: null, restored: null }
  })

  const run = useCallback(async (query: string) => {
    setState({ status: 'running', events: [], result: null, error: null, restored: null })
    try {
      const result = await ask(httpTransport(api, orgKey), query, {
        onProgress: (event) =>
          setState((previous) => ({ ...previous, events: [...previous.events, event] })),
      })
      remember(query, result)
      setState((previous) => ({ ...previous, status: 'done', result }))
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [])

  // Throwing away the previous answer is a deliberate act, not a side effect of
  // arriving on the page.
  const dismiss = useCallback(() => {
    forget()
    setState({ status: 'idle', events: [], result: null, error: null, restored: null })
  }, [])

  return { ...state, run, dismiss, configured: api !== '' && orgKey !== '' }
}
