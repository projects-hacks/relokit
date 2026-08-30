import { configFromEnv, relay } from '../apps/proxy/src/relay.ts'

/**
 * The same passage, as a Vercel function: the static app on the CDN, this
 * holding the key, Xano behind both. vercel.json routes every /api call here.
 */
export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  try {
    const bodyText = request.method === 'GET' ? undefined : await request.text()
    if (bodyText && bodyText.length > 1_000_000) {
      return Response.json({ error: 'The request is too large.' }, { status: 413 })
    }
    const answer = await relay(configFromEnv(process.env as Record<string, string>), {
      method: request.method,
      path: url.pathname.replace(/^\/api\/?/, ''),
      search: url.searchParams,
      bodyText,
    })
    return new Response(answer.body, {
      status: answer.status,
      headers: { 'content-type': answer.contentType },
    })
  } catch {
    return Response.json(
      { error: 'The search service is temporarily unavailable. Please try again.' },
      { status: 502 },
    )
  }
}
