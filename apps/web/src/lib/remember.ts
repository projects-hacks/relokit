import type { AskResult } from '@relokit/client'
import { ConstraintSet, EvidenceRow, Place } from '@relokit/schema'

/**
 * Keeps the last answer across a reload.
 *
 * Rehearsing a demo, or coming back to a decision an hour later, should not mean
 * asking every source again. The run is already stored on the server; this is
 * only so the page can show it immediately instead of blank while it asks.
 *
 * Storage can be unavailable or full, and neither is worth an error: a page that
 * cannot remember still works, it just starts empty.
 */
const KEY = 'relokit.last-run.v1'

export interface Remembered {
  query: string
  at: number
  result: AskResult
}

export function remember(query: string, result: AskResult): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ query, at: Date.now(), result }))
  } catch {
    // Private windows and full quotas both land here. Nothing to do.
  }
}

export function recall(): Remembered | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Remembered
    if (!parsed.result?.buckets) return null
    // Stored by whatever version of the page ran last, so it is held to the
    // real contracts before it is trusted: the schema defaults fill what an
    // older shape never had, and anything that will not fit is let go. An old
    // answer is disposable; a crashed first render is not.
    parsed.result.constraint_set = ConstraintSet.parse(parsed.result.constraint_set)
    parsed.result.entities = parsed.result.entities.map((entity) => Place.parse(entity))
    parsed.result.evidence = parsed.result.evidence.map((row) => EvidenceRow.parse(row))
    return parsed
  } catch {
    return null
  }
}

export function forget(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // As above.
  }
}
