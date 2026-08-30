import { Constraint, type ConstraintSet, type GeoPoint } from '@relokit/schema'

/**
 * "Near me" said honestly.
 *
 * No universal number means near, so the assumed reach follows what is being
 * looked for: dinner is a walk, a home is a neighbourhood. A distance the
 * question stated always wins, and the assumption is carried as an inferred
 * constraint so every result shows its distance and the reader sees what was
 * assumed rather than trusting a silent default.
 */
export const NEAR_ME =
  /\b(?:near me|around me|close to me|(?:from|around|of) my (?:current )?location|my current location)\b/i

const ASSUMED_REACH_M: Record<string, number> = {
  restaurant: 2000,
  cafe: 2000,
  bar: 2000,
  gym: 2000,
  grocery: 2000,
  pharmacy: 2000,
  park: 3000,
  school: 3000,
  university: 5000,
  hotel: 5000,
  rental: 8000,
  home_for_sale: 8000,
}

export function anchorToHere(set: ConstraintSet, here: GeoPoint): ConstraintSet {
  const stated = set.search_anchor?.radius_m
  const radius = stated ?? ASSUMED_REACH_M[set.subject] ?? 3000
  const already = set.constraints.some(
    (constraint) => constraint.type === 'proximity' && NEAR_ME.test(constraint.place.raw),
  )
  return {
    ...set,
    search_anchor: { raw: 'your location', point: here, radius_m: radius },
    constraints: already
      ? set.constraints.map((constraint) =>
          constraint.type === 'proximity' && NEAR_ME.test(constraint.place.raw)
            ? { ...constraint, place: { raw: 'your location', point: here } }
            : constraint,
        )
      : [
          ...set.constraints,
          Constraint.parse({
            id: `c${set.constraints.length + 1}`,
            type: 'proximity',
            hardness: 'hard',
            weight: 1,
            source_text: stated ? 'around your location' : 'near you',
            inferred: stated === undefined,
            place: { raw: 'your location', point: here },
            radius_m: radius,
          }),
        ],
  }
}
