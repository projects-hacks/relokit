import { z } from 'zod'

/**
 * What is being looked for. Chooses which sources can produce candidates at all,
 * before any of them compete on cost.
 */
export const Subject = z.enum([
  'rental',
  'home_for_sale',
  'restaurant',
  'cafe',
  'bar',
  'gym',
  'grocery',
  'school',
  'university',
  'park',
  'pharmacy',
  'hotel',
])

export type Subject = z.infer<typeof Subject>

/** Singular and plural, for saying what was found. */
export const SUBJECT_WORDS: Record<Subject, { one: string; many: string }> = {
  rental: { one: 'home', many: 'homes' },
  home_for_sale: { one: 'home', many: 'homes' },
  restaurant: { one: 'restaurant', many: 'restaurants' },
  cafe: { one: 'cafe', many: 'cafes' },
  bar: { one: 'bar', many: 'bars' },
  gym: { one: 'gym', many: 'gyms' },
  grocery: { one: 'shop', many: 'shops' },
  school: { one: 'school', many: 'schools' },
  university: { one: 'university', many: 'universities' },
  park: { one: 'park', many: 'parks' },
  pharmacy: { one: 'pharmacy', many: 'pharmacies' },
  hotel: { one: 'hotel', many: 'hotels' },
}

/** What to type into a place search to find one. */
export const SUBJECT_TERMS: Record<Subject, string> = {
  rental: 'apartments for rent',
  home_for_sale: 'homes for sale',
  restaurant: 'restaurants',
  cafe: 'coffee shops',
  bar: 'bars',
  gym: 'gyms',
  grocery: 'grocery stores',
  school: 'schools',
  university: 'universities',
  park: 'parks',
  pharmacy: 'pharmacies',
  hotel: 'hotels',
}

/** Words a question opens with when it is asking for one of these. */
const NOUNS: [RegExp, Subject][] = [
  [/\b(flats?|apartments?|rentals?|places? to (rent|live))\b/, 'rental'],
  [/\b(houses?|homes?) (for sale|to buy)\b/, 'home_for_sale'],
  [/\b(restaurants?|places? to eat|somewhere to eat|dinner|food)\b/, 'restaurant'],
  [/\b(cafes?|coffee shops?|coffee)\b/, 'cafe'],
  [/\b(bars?|pubs?)\b/, 'bar'],
  [/\b(gyms?|fitness centou?rs?)\b/, 'gym'],
  [/\b(grocery stores?|groceries|supermarkets?)\b/, 'grocery'],
  [/\b(universit(y|ies)|colleges?)\b/, 'university'],
  [/\b(schools?)\b/, 'school'],
  [/\b(parks?)\b/, 'park'],
  [/\b(pharmac(y|ies)|chemists?)\b/, 'pharmacy'],
  [/\b(hotels?|places? to stay)\b/, 'hotel'],
]

/**
 * The kind of thing a question opens by asking for.
 *
 * Several of these words are also things a home can be near, and a model reading
 * "gyms near the park" will sometimes file the gym as a requirement rather than
 * as the thing being counted. What is being asked for is whatever the sentence
 * leads with, so that is read here rather than left to interpretation.
 */
export function subjectFromQuery(query: string): Subject | null {
  const opening = query.toLowerCase().slice(0, 60)
  let best: { at: number; subject: Subject } | null = null
  for (const [pattern, subject] of NOUNS) {
    const at = opening.search(pattern)
    if (at === -1) continue
    if (!best || at < best.at) best = { at, subject }
  }
  return best?.subject ?? null
}
