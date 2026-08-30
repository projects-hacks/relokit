import { createServer } from 'node:http'

const port = Number(process.env.RELOKIT_PROXY_PORT ?? 8787)
const base = (process.env.XANO_INSTANCE_URL ?? '').replace(/\/+$/, '').replace(/\/workspace$/, '')
const group = process.env.XANO_API_GROUP ?? 'vZQqb3Je'
const orgKey = process.env.RELOKIT_ORG_KEY ?? ''

if (!base || !orgKey) {
  throw new Error('XANO_INSTANCE_URL and RELOKIT_ORG_KEY are required to run the web proxy')
}

const upstream = `${base}/api:${group}`
const allowed = new Set(['parse', 'run', 'runs', 'op', 'ingest', 'changes', 'watch'])

function reply(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

createServer(async (request, response) => {
  const method = request.method ?? 'GET'
  const incoming = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const path = incoming.pathname.replace(/^\/api\/?/, '')
  const endpoint = path.split('/')[0] ?? ''

  if (!allowed.has(endpoint) || !['GET', 'POST'].includes(method)) {
    reply(response, 404, { error: 'Unknown API endpoint.' })
    return
  }

  try {
    const target = new URL(`${upstream}/${path}`)
    for (const [key, value] of incoming.searchParams) {
      if (key !== 'org_key') target.searchParams.set(key, value)
    }

    let body: string | undefined
    if (method === 'GET') {
      target.searchParams.set('org_key', orgKey)
    } else {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
      // Tenant authority belongs to this server, never to the browser.
      body = JSON.stringify({ ...parsed, org_key: orgKey })
    }

    const upstreamResponse = await fetch(target, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
      body,
    })
    const text = await upstreamResponse.text()
    response.writeHead(upstreamResponse.status, {
      'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8',
    })
    response.end(text)
  } catch {
    reply(response, 502, { error: 'The search service is temporarily unavailable. Please try again.' })
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Relokit web proxy listening at http://127.0.0.1:${port}`)
})
