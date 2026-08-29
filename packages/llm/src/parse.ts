import { readFileSync } from 'node:fs'
import { complete, type ProviderOptions } from './provider.ts'
import { normalizeConstraintSet, type NormalizeResult } from './normalize.ts'

export const PARSER_VERSION = 'parse.v1.md'

export function parsePrompt(): string {
  return readFileSync(new URL('./prompts/parse.v1.md', import.meta.url), 'utf8')
}

export interface ParseOptions extends ProviderOptions {
  query_id: string
  now_ms: number
  tz?: string
}

/**
 * One call, then a repair pass. If the answer is not JSON at all it is asked
 * once more with the failure quoted back, and after that it is a structured form
 * rather than a third attempt.
 */
export async function parseQuery(
  query: string,
  options: ParseOptions,
): Promise<NormalizeResult & { model: string; attempts: number }> {
  const system = parsePrompt()
  let lastError = ''

  for (let attempt = 1; attempt <= 2; attempt++) {
    const user =
      attempt === 1
        ? query
        : `${query}\n\nYour last answer could not be read: ${lastError}\nReturn only JSON.`
    const completion = await complete(system, user, options)
    const parsed = readJson(completion.text)
    if (!parsed) {
      lastError = 'it was not valid JSON'
      continue
    }
    const result = normalizeConstraintSet(parsed, query, {
      query_id: options.query_id,
      parser_version: PARSER_VERSION,
      parsed_at_ms: options.now_ms,
      ...(options.tz ? { tz: options.tz } : {}),
    })
    if (result.constraint_set.constraints.length === 0) {
      lastError = 'it contained no usable constraint'
      continue
    }
    return { ...result, model: completion.model, attempts: attempt }
  }

  throw new Error(`could not parse the query: ${lastError}`)
}

/** Models fence their JSON however they feel like, so take the outermost braces. */
function readJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}
