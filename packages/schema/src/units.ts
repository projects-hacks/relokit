import { z } from 'zod'

/**
 * Canonical units. Every number stored anywhere in Relokit is in one of these.
 * Formatting happens at render time only.
 */

/** US cents. Never dollars, never a formatted string. */
export const Cents = z.number().int().nonnegative()

/** Seconds. Durations, travel times, TTLs. */
export const Seconds = z.number().int().nonnegative()

/** Meters. Straight-line distance unless the field says otherwise. */
export const Meters = z.number().int().nonnegative()

/**
 * Seconds since local midnight. Exceeds 86400 to express a closing time after
 * midnight, so a bar closing at 2am is 93600 and not 7200.
 */
export const SecondsOfDay = z.number().int().min(0).max(172800)

export const Weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

/** Addresses arrive ungeocoded from the parser. Xano fills `point` via a geocode op. */
export const PlaceRef = z.object({
  raw: z.string().min(1),
  point: GeoPoint.optional(),
  place_id: z.string().optional(),
})

export const BBox = z.object({ sw: GeoPoint, ne: GeoPoint })

export type Cents = z.infer<typeof Cents>
export type Seconds = z.infer<typeof Seconds>
export type Meters = z.infer<typeof Meters>
export type SecondsOfDay = z.infer<typeof SecondsOfDay>
export type Weekday = z.infer<typeof Weekday>
export type GeoPoint = z.infer<typeof GeoPoint>
export type PlaceRef = z.infer<typeof PlaceRef>
export type BBox = z.infer<typeof BBox>
