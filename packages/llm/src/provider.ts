export interface ProviderOptions {
  nvidiaApiKey?: string
  openRouterApiKey?: string
  model?: string
  fallbackModel?: string
  timeoutMs?: number
}

export interface Completion {
  text: string
  model: string
  provider: 'nvidia' | 'openrouter'
}

/**
 * Not every model listed on the NVIDIA catalogue is provisioned for a given
 * account, and a model that is not returns a 404 naming an internal function id
 * rather than the model. Both providers speak the same request shape, so the
 * fallback is a different base URL and key rather than a different client.
 */
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export const DEFAULT_MODEL = 'mistralai/mistral-nemotron'
export const DEFAULT_FALLBACK_MODEL = 'mistralai/mistral-large'

export async function complete(
  system: string,
  user: string,
  options: ProviderOptions = {},
): Promise<Completion> {
  const nvidiaKey = options.nvidiaApiKey ?? process.env.NVIDIA_API_KEY
  const openRouterKey = options.openRouterApiKey ?? process.env.OPENROUTER_API_KEY

  if (nvidiaKey) {
    try {
      const text = await call(
        NVIDIA_URL,
        nvidiaKey,
        options.model ?? DEFAULT_MODEL,
        system,
        user,
        options.timeoutMs,
      )
      return { text, model: options.model ?? DEFAULT_MODEL, provider: 'nvidia' }
    } catch (error) {
      if (!openRouterKey) throw error
    }
  }

  if (!openRouterKey) throw new Error('no LLM key: set NVIDIA_API_KEY or OPENROUTER_API_KEY')
  const model = options.fallbackModel ?? DEFAULT_FALLBACK_MODEL
  const text = await call(OPENROUTER_URL, openRouterKey, model, system, user, options.timeoutMs)
  return { text, model, provider: 'openrouter' }
}

async function call(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  timeoutMs = 45_000,
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const body = (await response.json()) as {
    choices?: { message?: { content?: string | null; reasoning_content?: string } }[]
    detail?: string
    error?: { message?: string }
  }

  if (!response.ok) {
    throw new Error(
      `${model} returned ${response.status}: ${body.detail ?? body.error?.message ?? ''}`,
    )
  }

  const message = body.choices?.[0]?.message
  // A reasoning model puts its answer in reasoning_content and leaves content
  // null when the token budget runs out mid-thought.
  const text = message?.content ?? message?.reasoning_content
  if (!text) throw new Error(`${model} returned no content`)
  return text
}
