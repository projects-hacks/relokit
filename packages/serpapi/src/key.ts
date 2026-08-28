import { createHash } from 'node:crypto'
import type { Engine, SearchParams } from './engines.ts'
import { redactParams } from './redact.ts'

/**
 * Fixture identity. Parameter order must not matter, or reordering a template
 * silently misses the cache and spends a credit.
 */
export function paramsHash(engine: Engine, params: SearchParams): string {
  const stable = Object.entries(redactParams(params))
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return createHash('sha256')
    .update(JSON.stringify([engine, stable]))
    .digest('hex')
    .slice(0, 16)
}

export function fixtureKey(engine: Engine, params: SearchParams, slug?: string): string {
  const parts = [engine, slug, paramsHash(engine, params)].filter(Boolean)
  return parts.join('__')
}
