/**
 * Reading numbers out of the words the user actually wrote.
 *
 * A model is good at spotting that a phrase is a budget and poor at turning it
 * into cents. Asked for the canonical demo query it put "open past 10pm" at
 * 36000 seconds, which is ten in the morning, and filed it under the wrong field
 * so the constraint asked for a shop that opens late rather than one that closes
 * late. Nothing in the schema can catch either mistake.
 *
 * So the model decides what kind of constraint a phrase is, and this decides
 * what the numbers in it are.
 */

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  forty_five: 45,
  sixty: 60,
}

function numeric(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/,/g, '')
  if (cleaned === '') return null
  const asNumber = Number(cleaned)
  if (Number.isFinite(asNumber)) return asNumber
  if (cleaned === 'half') return 0.5
  if (cleaned === 'quarter') return 0.25
  return WORD_NUMBERS[cleaned] ?? null
}

/** Words that make a bare number a rent rather than a bedroom count. */
const RENT_CONTEXT = /\b(?:a|per)\s*month\b|\bmonthly\b|\/\s*mo\b|\brent\b|\bbudget\b/i

/** "$2,800", "2800 dollars", "2.8k", or "under 3400 a month" to cents. */
export function moneyCents(text: string): number | null {
  const marked =
    /\$\s*([\d,]+(?:\.\d+)?)\s*(k\b)?|([\d,]+(?:\.\d+)?)\s*(?:k\b)?\s*(?:dollars|usd|bucks)/i.exec(
      text,
    )
  if (marked) {
    const value = numeric(marked[1] ?? marked[3] ?? '')
    if (value === null) return null
    const thousands = marked[2] !== undefined || /\dk\b/i.test(text)
    return Math.round(value * (thousands ? 1000 : 1) * 100)
  }

  // People write a rent without a currency mark more often than not, and the
  // amount is still theirs rather than an assumption of ours. A bare number is
  // only money when the phrase says it is a rent, so "2 bed" never is.
  if (!RENT_CONTEXT.test(text)) return null
  const bare = /\b([\d,]{3,})(k\b)?/i.exec(text)
  if (!bare) return null
  const value = numeric(bare[1]!)
  if (value === null) return null
  return Math.round(value * (bare[2] ? 1000 : 1) * 100)
}

/** "25 minutes", "an hour and a half", "90 min" to seconds. */
export function durationSeconds(text: string): number | null {
  const hours = /(\d+(?:\.\d+)?|half|an?|one|two|three)\s*(?:hours?|hrs?|h\b)/i.exec(text)
  const minutes =
    /(\d+(?:\.\d+)?|half|an?|one|two|three|five|ten|fifteen|twenty|thirty|forty|forty[- ]five|sixty)\s*(?:minutes?|mins?|m\b)/i.exec(
      text,
    )
  if (!hours && !minutes) return null
  const h = hours ? (numeric(hours[1]!.replace('-', '_')) ?? 0) : 0
  const m = minutes ? (numeric(minutes[1]!.replace(/[- ]/, '_')) ?? 0) : 0
  const seconds = Math.round(h * 3600 + m * 60)
  return seconds > 0 ? seconds : null
}

const METERS_PER_MILE = 1609.34

/** "half a mile", "800m", "0.5 miles", "10 blocks" to meters. */
export function distanceMeters(text: string): number | null {
  const miles =
    /(\d+(?:\.\d+)?|half|a quarter|quarter|one|two|three)\s*(?:a\s+)?(?:miles?|mi\b)/i.exec(text)
  if (miles) {
    const value = numeric(miles[1]!.replace('a quarter', 'quarter'))
    if (value !== null) return Math.round(value * METERS_PER_MILE)
  }
  const km = /(\d+(?:\.\d+)?)\s*(?:kilometers?|kilometres?|km\b)/i.exec(text)
  if (km) return Math.round(Number(km[1]) * 1000)
  const meters = /(\d+)\s*(?:meters?|metres?|m\b)/i.exec(text)
  if (meters) return Number(meters[1])
  return null
}

/**
 * "6am", "10 pm", "18:30", "midnight", "noon" to seconds since local midnight.
 * A closing time at or after midnight goes past 86400 rather than wrapping.
 */
export function clockSeconds(text: string): number | null {
  if (/\bmidnight\b/i.test(text)) return 86_400
  if (/\bnoon|midday\b/i.test(text)) return 43_200

  const meridiem = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i.exec(text)
  if (meridiem) {
    const hour12 = Number(meridiem[1])
    if (hour12 < 1 || hour12 > 12) return null
    const minutes = Number(meridiem[2] ?? 0)
    const isPm = meridiem[3]!.toLowerCase() === 'p'
    return ((hour12 % 12) + (isPm ? 12 : 0)) * 3600 + minutes * 60
  }

  const clock = /\b(\d{1,2}):(\d{2})\b/.exec(text)
  if (clock) {
    const hours = Number(clock[1])
    const minutes = Number(clock[2])
    if (hours > 23 || minutes > 59) return null
    return hours * 3600 + minutes * 60
  }
  return null
}

export type WindowSide = 'opens_by' | 'closes_after'

/**
 * Which end of the day a phrase is talking about.
 *
 * "open before 6am" constrains when a place opens. "open past 10pm" constrains
 * when it closes. The words that separate them are small and the model got both
 * backwards, so the preposition decides rather than the model.
 */
export function windowSide(text: string): WindowSide | null {
  if (/\b(past|until|til|till|after|late as|through|to)\b/i.test(text)) return 'closes_after'
  if (/\b(before|by|from|as early as|opens? at)\b/i.test(text)) return 'opens_by'
  return null
}
