/**
 * The one implementation of the passage to Xano.
 *
 * The Node server and the serverless function both call this, so what is
 * allowed through and how the key is attached can never drift between the two
 * ways of deploying.
 */
// Grown twice by the same failure: a new endpoint that is not named here
// 404s at the door, and the run falls back to the burst this passage exists
// to prevent. Add the name with the endpoint, always.
const allowed = new Set(['parse', 'run', 'runs', 'op', 'ops', 'jobs', 'ingest', 'changes', 'watch'])

export interface RelayConfig {
  instance: string
  group: string
  orgKey: string
  /** How long to wait upstream. Must stay under the host's own limit. */
  patienceMs: number
}

/**
 * Under a serverless function's ceiling, deliberately.
 *
 * This waited three minutes while the platform running it gives sixty seconds,
 * so a slow call could never return anything: the function was killed and the
 * browser got an unreadable gateway page instead of an error the app could
 * explain. Give up first, and the caller is told what happened in its own
 * terms. Raise the host's limit before raising this.
 */
export const DEFAULT_PATIENCE_MS = 50_000

export function configFromEnv(env: Record<string, string | undefined>): RelayConfig {
  const instance = (env.XANO_INSTANCE_URL ?? '').replace(/\/+$/, '').replace(/\/workspace$/, '')
  const orgKey = env.RELOKIT_ORG_KEY ?? ''
  if (!instance || !orgKey) {
    throw new Error('XANO_INSTANCE_URL and RELOKIT_ORG_KEY are required')
  }
  const patience = Number(env.RELOKIT_UPSTREAM_TIMEOUT_MS ?? DEFAULT_PATIENCE_MS)
  return {
    instance,
    group: env.XANO_API_GROUP ?? 'vZQqb3Je',
    orgKey,
    patienceMs: Number.isFinite(patience) && patience > 0 ? patience : DEFAULT_PATIENCE_MS,
  }
}

export async function relay(
  config: RelayConfig,
  request: {
    method: string
    /** The path after /api, e.g. "parse". */
    path: string
    search: URLSearchParams
    bodyText?: string
  },
): Promise<{ status: number; contentType: string; body: string }> {
  const endpoint = request.path.split('/')[0] ?? ''
  if (!allowed.has(endpoint) || !['GET', 'POST'].includes(request.method)) {
    return { status: 404, contentType: 'application/json', body: '{"error":"Not found."}' }
  }

  const target = new URL(`${config.instance}/api:${config.group}/${request.path}`)
  for (const [key, value] of request.search) {
    if (key !== 'org_key') target.searchParams.set(key, value)
  }

  let body: string | undefined
  if (request.method === 'GET') {
    target.searchParams.set('org_key', config.orgKey)
  } else {
    const parsed = JSON.parse(request.bodyText || '{}') as Record<string, unknown>
    // Tenant authority belongs to the server, never to the browser.
    body = JSON.stringify({ ...parsed, org_key: config.orgKey })
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: request.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
      body,
      signal: AbortSignal.timeout(config.patienceMs),
    })
  } catch (error) {
    // Said in the app's own words rather than as a gateway page, and said
    // while there is still time to say it.
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      status: timedOut ? 504 : 502,
      contentType: 'application/json',
      body: JSON.stringify({
        error: timedOut
          ? 'The source took too long to answer, so this one was left unchecked.'
          : 'The search service could not be reached for this one.',
      }),
    }
  }
  return {
    status: upstream.status,
    contentType: upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
    body: await upstream.text(),
  }
}
