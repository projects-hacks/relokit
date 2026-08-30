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
