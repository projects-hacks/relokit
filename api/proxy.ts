import type { IncomingMessage, ServerResponse } from 'node:http'
import { configFromEnv, relay } from '../apps/proxy/src/relay.ts'

/**
 * The same passage, as a Vercel function: the static app on the CDN, this
 * holding the key, Xano behind both. vercel.json routes every /api call here.
 *
 * Written to the Node runtime's own shapes rather than the web ones. Vercel
 * hands this an IncomingMessage whose url is a bare path, which no URL
 * constructor will take without a base.
 */
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', `https://${request.headers.host ?? 'localhost'}`)
  const search = url.searchParams
  // The rewrite reports which segments it matched. That is routing, not a
  // parameter Xano ever asked for.
  search.delete('path')

  try {
    let bodyText: string | undefined
    if (request.method !== 'GET') {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += (chunk as Buffer).length
        if (size > 1_000_000) {
          response.writeHead(413, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'The request is too large.' }))
          return
        }
        chunks.push(Buffer.from(chunk as Buffer))
      }
      bodyText = Buffer.concat(chunks).toString('utf8')
    }

    const answer = await relay(configFromEnv(process.env as Record<string, string>), {
      method: request.method ?? 'GET',
      path: url.pathname.replace(/^\/api\/?/, ''),
      search,
      bodyText,
    })
    response.writeHead(answer.status, { 'content-type': answer.contentType })
    response.end(answer.body)
  } catch {
    response.writeHead(502, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({ error: 'The search service is temporarily unavailable. Please try again.' }),
    )
  }
}
