import type { AttributeConstraint, DescriptorConstraint } from './constraints.ts'
import type { Subject } from './subject.ts'

/**
 * Kinds of thing that state these about themselves.
 *
 * A rental has no star rating and no price bracket, so a floor on either can
 * only ever come back unknown, and asking put every flat in the world into
 * "couldn't verify".
 */
const MEASURED: Subject[] = [
  'restaurant',
  'cafe',
  'bar',
  'gym',
  'grocery',
  'pharmacy',
  'park',
  'school',
  'university',
  'hotel',
]

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
  // Budget is a cap when a number follows it and a word for cheap when one does
  // not: "budget 3800 dollars" is what somebody will spend, and reading it as a
  // preference for cheap places put every flat into "couldn't verify".
  { pattern: /\bbudget\b(?!\s*(?:of\s*)?[$£€]?\d)/i, measure: 'price_level', max: 2 },
  {
    pattern: /\b(cheap|inexpensive|affordable|low[- ]cost)\b/i,
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

export function measuresFromQuery(
  query: string,
  nextId: (index: number) => string,
  subject: Subject | null,
) {
  if (subject === null || !MEASURED.includes(subject)) return []
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

/**
 * How far people say a thing is when they do not say a number.
 *
 * Nobody types 1200 metres. They say walking distance, and a default radius
 * chosen for the kind of thing then quietly ignores what they told us. These
 * are deliberately generous: too tight discards the right answer before
 * anything has looked at it, and the later checks are what prune.
 */
const REACH: [RegExp, number][] = [
  [/\b(a )?(short|quick|two|five|ten) minute walk\b/i, 800],
  [/\bwalking distance\b/i, 1200],
  [/\b(walkable|on foot)\b/i, 1200],
  [/\b(just|right)? ?(around the corner|down the road|next door)\b/i, 600],
  [/\b(a )?(short|quick) (drive|ride)\b/i, 5000],
  [/\b(nearby|close by|near here|round the corner)\b/i, 2000],
]

export function reachFromQuery(query: string): { meters: number; text: string } | null {
  for (const [pattern, meters] of REACH) {
    const hit = query.match(pattern)
    if (hit) return { meters, text: hit[0].trim() }
  }
  return null
}

/** Ways of refusing a kind of place, and of asking for one. */
// The words that end a description have to be whole words with a space before
// them, or the "in" inside "chain" ends it and the refusal becomes "cha".
const STOP = String.raw`(?=\s*[,.]|\s*$|\s+(?:and|or|but|in|near|within|open|that|which|with|for)\b)`
const WITHOUT = new RegExp(
  String.raw`\b(?:not|no|avoid|except|excluding|other than)\s+(?:a\s+|an\s+|the\s+)?([a-z][a-z' -]{2,24}?)` +
    STOP,
  'gi',
)
const WITH = new RegExp(
  String.raw`\b(?:ideally with|preferably with|that has|having|with)\s+(?:a\s+|an\s+)?([a-z][a-z' -]{2,24}?)` +
    STOP,
  'gi',
)

/** Words that describe the asking rather than the place. */
const NOT_A_DESCRIPTOR = /^(more|less|it|them|one|any|other|of|to|me|us|somewhere|anything)$/i

export function descriptorsFromQuery(
  query: string,
  nextId: (index: number) => string,
): DescriptorConstraint[] {
  const found: DescriptorConstraint[] = []
  const take = (text: string, want: DescriptorConstraint['want'], whole: string) => {
    const clean = text.trim().replace(/\s+/g, ' ')
    if (clean === '' || NOT_A_DESCRIPTOR.test(clean)) return
    if (found.some((c) => c.text === clean)) return
    found.push({
      id: nextId(found.length),
      type: 'descriptor',
      // Refusing is a rule; wanting is only a preference, so it ranks rather
      // than throwing away a place that is otherwise right.
      hardness: want === 'without' ? 'hard' : 'soft',
      weight: want === 'without' ? 1 : 0.6,
      source_text: whole.trim(),
      inferred: true,
      text: clean,
      want,
    })
  }
  for (const hit of query.matchAll(WITHOUT)) take(hit[1] ?? '', 'without', hit[0])
  for (const hit of query.matchAll(WITH)) take(hit[1] ?? '', 'with', hit[0])
  return found
}
