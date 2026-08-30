/**
 * The one implementation of the passage to Xano.
 *
 * The Node server and the serverless function both call this, so what is
 * allowed through and how the key is attached can never drift between the two
 * ways of deploying.
 */
const allowed = new Set(['parse', 'run', 'runs', 'op', 'ingest', 'changes', 'watch'])

export interface RelayConfig {
  instance: string
  group: string
  orgKey: string
}

export function configFromEnv(env: Record<string, string | undefined>): RelayConfig {
  const instance = (env.XANO_INSTANCE_URL ?? '').replace(/\/+$/, '').replace(/\/workspace$/, '')
  const orgKey = env.RELOKIT_ORG_KEY ?? ''
  if (!instance || !orgKey) {
    throw new Error('XANO_INSTANCE_URL and RELOKIT_ORG_KEY are required')
  }
  return { instance, group: env.XANO_API_GROUP ?? 'vZQqb3Je', orgKey }
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

  const upstream = await fetch(target, {
    method: request.method,
    headers: request.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body,
    // A search can honestly take minutes; a hung one should not hold a socket.
    signal: AbortSignal.timeout(180_000),
  })
  return {
    status: upstream.status,
    contentType: upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
    body: await upstream.text(),
  }
}
