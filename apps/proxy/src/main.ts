import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { configFromEnv, relay } from './relay.ts'

/*
 * The whole product as one process.
 *
 * The org key authorises spending, so it lives here and never in a bundle
 * anyone can read. In development Vite forwards /api here; in production this
 * also serves the built app itself, so deploying is running this one file
 * anywhere Node runs.
 */

const port = Number(process.env.RELOKIT_PROXY_PORT ?? 8787)
const config = configFromEnv(process.env)
const dist = join(process.cwd(), 'apps/web/dist')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

function reply(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function serveStatic(pathname: string, response: import('node:http').ServerResponse): boolean {
  if (!existsSync(dist)) return false
  // Everything without an extension is a page, and every page is the app.
  const clean = normalize(pathname).replace(/^\/+/, '')
  const target = join(dist, clean === '' || !extname(clean) ? 'index.html' : clean)
  if (!target.startsWith(dist) || !existsSync(target) || !statSync(target).isFile()) {
    return false
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
    'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400',
  })
  createReadStream(target).pipe(response)
  return true
}

createServer(async (request, response) => {
  const method = request.method ?? 'GET'
  const incoming = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (!incoming.pathname.startsWith('/api')) {
    if (method === 'GET' && serveStatic(incoming.pathname, response)) return
    reply(response, 404, { error: 'Not found.' })
    return
  }

  try {
    let bodyText: string | undefined
    if (method !== 'GET') {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        // A question is a few kilobytes; anything near this is not one.
        if (size > 1_000_000) {
          reply(response, 413, { error: 'The request is too large.' })
          return
        }
        chunks.push(Buffer.from(chunk))
      }
      bodyText = Buffer.concat(chunks).toString('utf8')
    }
    const answer = await relay(config, {
      method,
      path: incoming.pathname.replace(/^\/api\/?/, ''),
      search: incoming.searchParams,
      bodyText,
    })
    response.writeHead(answer.status, { 'content-type': answer.contentType })
    response.end(answer.body)
  } catch {
    reply(response, 502, {
      error: 'The search service is temporarily unavailable. Please try again.',
    })
  }
}).listen(port, process.env.RELOKIT_PROXY_HOST ?? '127.0.0.1', () => {
  console.log(`Relokit web proxy listening at http://127.0.0.1:${port}`)
})
