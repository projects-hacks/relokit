import type { AttributeConstraint } from './constraints.ts'

/**
 * Words people use for how good and how dear a place is.
 *
 * The model is asked for these too and forgets under load, exactly as it forgot
 * mexican. What someone literally typed can be read off the sentence, and a
 * sentence cannot forget, so this runs as well and its findings are kept.
 *
 * Price level is counted the way a provider counts money signs, one to four.
 */
const PHRASES: {
  pattern: RegExp
  measure: AttributeConstraint['measure']
  min?: number
  max?: number
}[] = [
  {
    pattern: /\b(cheap|budget|inexpensive|affordable|low[- ]cost)\b/i,
    measure: 'price_level',
    max: 2,
  },
  { pattern: /\b(mid[- ]range|moderately priced)\b/i, measure: 'price_level', max: 3 },
  {
    pattern: /\b(upscale|high[- ]end|fine dining|fancy|expensive)\b/i,
    measure: 'price_level',
    min: 3,
  },
  { pattern: /\$\$\$\$/, measure: 'price_level', min: 4 },
  { pattern: /\$\$\$(?!\$)/, measure: 'price_level', min: 3, max: 3 },
  { pattern: /(?<!\$)\$\$(?!\$)/, measure: 'price_level', min: 2, max: 2 },
  { pattern: /\b(highly|well|top)[- ]?(rated|reviewed)\b/i, measure: 'rating', min: 4 },
  { pattern: /\b(best|great|excellent) reviews?\b/i, measure: 'rating', min: 4.3 },
  { pattern: /\bpopular\b/i, measure: 'reviews', min: 200 },
]

/** "4 stars", "4.5+ rating", "at least 4 stars". */
const STARS = /\b(\d(?:\.\d)?)\s*\+?\s*(?:stars?\b|star\b|out of 5\b|\+?\s*rating\b)/i

export function measuresFromQuery(query: string, nextId: (index: number) => string) {
  const found: AttributeConstraint[] = []
  const add = (
    measure: AttributeConstraint['measure'],
    bounds: { min?: number; max?: number },
    text: string,
  ) => {
    if (found.some((c) => c.measure === measure)) return
    found.push({
      id: nextId(found.length),
      type: 'attribute',
      hardness: 'hard',
      weight: 1,
      source_text: text,
      inferred: true,
      measure,
      ...bounds,
    })
  }

  const stars = query.match(STARS)
  if (stars) add('rating', { min: Number(stars[1]) }, stars[0].trim())

  for (const { pattern, measure, min, max } of PHRASES) {
    const hit = query.match(pattern)
    if (!hit) continue
    add(
      measure,
      { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) },
      hit[0].trim(),
    )
  }
  return found
}
