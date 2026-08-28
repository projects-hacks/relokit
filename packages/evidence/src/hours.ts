import type { OpenWindow, Verdict, Weekday } from '@relokit/schema'

/**
 * Opening hours arrive as display strings, one per weekday:
 *
 *   { "friday": "5 AM–11 PM", "sunday": "Closed", "tuesday": "Open 24 hours" }
 *
 * Two characters in there are not the ones they look like. The dash is an en
 * dash (U+2013) and the space before AM or PM is a narrow no-break space
 * (U+202F). A parser written against a hyphen and an ordinary space matches
 * nothing, and every opening hours verdict comes back unknown while looking
 * like a data problem rather than a parser bug.
 */

const DAY_SECONDS = 86_400

/** Any dash, any kind of space. Being generous here costs nothing. */
const RANGE = /^(.+?)\s*[‐-―-]\s*(.+)$/
/**
 * The meridiem is optional because Google drops it from the opening time when
 * both ends share one: "6–11 AM" is six in the morning until eleven, and
 * "4–8:30 PM" is the afternoon. Seven distinct strings in one sample of gyms
 * take that form, and reading them as unparsed loses the constraint quietly.
 */
const CLOCK = /^(\d{1,2})(?::(\d{2}))?(?:\s*([AP])\.?M\.?)?$/i

export interface DayHours {
  /** Seconds since local midnight. */
  opens_s: number
  /**
   * May exceed 86400. A bar closing at 2am closes at 93600, not 7200, or every
   * comparison against a late window silently fails.
   */
  closes_s: number
}

export type ParsedDay = DayHours | 'closed' | 'unparsed'

export function parseDayHours(value: string): ParsedDay {
  const text = value.replace(/ | /g, ' ').trim()
  if (/^closed$/i.test(text)) return 'closed'
  if (/^open\s*24\s*hours$/i.test(text)) return { opens_s: 0, closes_s: DAY_SECONDS }

  const range = RANGE.exec(text)
  if (!range) return 'unparsed'

  // Read the closing time first: it always carries the meridiem, and the
  // opening time borrows it when its own is missing.
  const closing = readClock(range[2]!)
  if (closing === null || closing.meridiem === null) return 'unparsed'
  const opening = readClock(range[1]!, closing.meridiem)
  if (opening === null) return 'unparsed'

  const opens = opening.seconds
  const closes = closing.seconds

  // Midnight as a closing time is the end of this day, not the start of it.
  const closesAdjusted = closes === 0 ? DAY_SECONDS : closes
  return {
    opens_s: opens,
    closes_s: closesAdjusted <= opens ? closesAdjusted + DAY_SECONDS : closesAdjusted,
  }
}

interface Clock {
  seconds: number
  meridiem: 'A' | 'P' | null
}

function readClock(value: string, inherited?: 'A' | 'P'): Clock | null {
  const match = CLOCK.exec(value.trim())
  if (!match) return null
  const hour12 = Number(match[1])
  const minutes = Number(match[2] ?? 0)
  if (hour12 < 1 || hour12 > 12 || minutes > 59) return null

  const meridiem = (match[3]?.toUpperCase() as 'A' | 'P' | undefined) ?? inherited ?? null
  if (meridiem === null) return null
  const hour24 = (hour12 % 12) + (meridiem === 'P' ? 12 : 0)
  return { seconds: hour24 * 3600 + minutes * 60, meridiem }
}

export function parseOperatingHours(
  raw: Record<string, unknown> | undefined,
): Partial<Record<Weekday, ParsedDay>> {
  if (!raw) return {}
  const parsed: Partial<Record<Weekday, ParsedDay>> = {}
  for (const [day, value] of Object.entries(raw)) {
    const weekday = WEEKDAY_BY_NAME[day.toLowerCase()]
    if (weekday && typeof value === 'string') parsed[weekday] = parseDayHours(value)
  }
  return parsed
}

const WEEKDAY_BY_NAME: Record<string, Weekday> = {
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
  saturday: 'sat',
  sunday: 'sun',
}

/**
 * Does a place meet the window on the days that matter?
 *
 * `unknown` is returned whenever the hours could not be read. It is never
 * folded into `fail`: not knowing when a gym opens is a different answer from
 * knowing it opens too late, and only one of them should reject a home.
 */
export function satisfiesWindow(
  hours: Partial<Record<Weekday, ParsedDay>>,
  window: OpenWindow,
  evaluationDays: Weekday[],
): Verdict {
  const days = window.days?.length ? window.days : evaluationDays
  if (days.length === 0) return 'unknown'

  let sawUnknown = false
  for (const day of days) {
    const parsed = hours[day]
    if (parsed === undefined || parsed === 'unparsed') {
      sawUnknown = true
      continue
    }
    // Shut on a day the window covers is a real failure, not a gap.
    if (parsed === 'closed') return 'fail'
    if (window.opens_by_s !== undefined && parsed.opens_s > window.opens_by_s) return 'fail'
    if (window.closes_after_s !== undefined && parsed.closes_s < window.closes_after_s) {
      return 'fail'
    }
  }
  return sawUnknown ? 'unknown' : 'pass'
}
