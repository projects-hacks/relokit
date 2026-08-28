import type { SearchParams } from './engines.ts'

/** Parameter names that carry a credential, under any engine. */
export const SECRET_PARAMS = new Set(['api_key', 'serpapi_api_key', 'key'])

export function redactParams(params: SearchParams): SearchParams {
  const out: SearchParams = {}
  for (const [k, v] of Object.entries(params)) {
    if (!SECRET_PARAMS.has(k)) out[k] = v
  }
  return out
}

/**
 * Fixtures are committed, so a key left in one is a public key. SerpApi echoes
 * the request back inside search_metadata and hands out callback URLs that carry
 * the key in a query string, so both the parameters and the body need stripping.
 */
export function redactBody(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(redactBody)
  if (body && typeof body === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (SECRET_PARAMS.has(k)) continue
      out[k] = typeof v === 'string' ? redactUrl(v) : redactBody(v)
    }
    return out
  }
  return body
}

function redactUrl(value: string): string {
  if (!value.includes('?')) return value
  const [base, query] = value.split('?', 2)
  if (!query) return value
  const kept = query
    .split('&')
    .filter((pair) => !SECRET_PARAMS.has(decodeURIComponent(pair.split('=')[0] ?? '')))
  return kept.length === query.split('&').length ? value : [base, kept.join('&')].join('?')
}
