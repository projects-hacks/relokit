# Provider smoke test, 28 August 2026

Five recorded calls against San Jose. Every claim below is asserted in
`packages/serpapi/src/coverage.test.ts`, so a provider change shows up as a red
test rather than as empty pins on the map on Sunday.

Read this before touching the registry.

## 1. In-unit laundry is free

`amenities=in_unit_laundry` is a native Zillow rental filter. It costs nothing
because it applies inside a search we were making anyway.

`listing_feature.zillow.native` stays enabled and
`listing_feature.zillow.entity` stays disabled.

The catch: the response never restates the amenity per listing. Zillow guarantees
the survivors match, but there is no field to cite. So the evidence row is
provider asserted: `verdict: pass`, `confidence: 0.8`, `source_url` pointing at
the search rather than at the listing body. Enabling the entity row upgrades that
to a directly read fact at one call per survivor, and that is a real choice
someone can make from a registry row rather than a deploy.

## 2. The free predicates prune two orders of magnitude, and pay for the search

|                                                   | results | pages |
| ------------------------------------------------- | ------- | ----- |
| San Jose rentals, bounded box only                | 4,517   | 20    |
| plus price under $2,800, one bed, in-unit laundry | 56      | 1     |

The page count matters as much as the candidate count. Candidate generation costs
one call per page, so the native predicates cut the cost of the search itself from
20 calls to 1. `candidates.zillow.region` is now priced per page and the planner
emits one op per page.

## 3. A fifth of rental results are buildings, not units

80 percent of unfiltered results have no `beds`, no `price` and no `zpid`. They
carry `units[]` instead:

```json
{
  "building_name": "Lynhaven",
  "min_base_rent": 3184,
  "max_base_rent": 5119,
  "units": [
    { "price": "$3,227+", "beds": "1" },
    { "price": "$5,162+", "beds": "2" }
  ]
}
```

Two consequences.

An entity is one bed count at one building, not one search result. The mapper
expands `units[]` into entities.

`"$3,227+"` is a floor, not a price. A budget cap sitting above the floor settles
nothing, so the verdict is `unknown` with the band in `display_value`, never a
guess. `budget.zillow.native` coverage drops to 0.80 for this reason. This is the
main reason the unverified bucket exists and it is a common case, not an edge one.

Coordinates are present on 100 percent of unfiltered results and 95 percent of
filtered ones, so clustering has something to work with either way.

## 4. google_local ignores `ll`

Asked for gyms at `@37.3382,-121.8863,14z`, `google_local` returned Workout
Anytime in Seymour and in Decatur. Not one result was inside San Jose.

`google_maps` with `type=search` honours `ll` and returns real San Jose gyms.
`nearby_poi` now uses `google_maps:search`. The `google_local` rows are gone.

## 5. Opening hours are structured per weekday

Better than expected. Alongside the display string in `hours`, every result
carries `operating_hours`:

```json
{ "friday": "5 AM–11 PM", "saturday": "7 AM–7 PM", "sunday": "Closed", "tuesday": "Open 24 hours" }
```

100 percent coverage on the sample. Three forms to handle: a range, `Open 24
hours`, and `Closed`.

**The separators are not ASCII.** The dash is an en dash (U+2013) and the space
before AM or PM is a narrow no-break space (U+202F). A parser written against a
hyphen and a normal space matches nothing, and every opening hours verdict comes
back `unknown` while looking like a data problem rather than a parser bug.

`"5 AM–12 AM"` closes at midnight, which is 86400 seconds of day and not 0.

`nearby_poi` coverage is raised to 0.95.

## 6. Geocoding is clean

`2788 San Tomas Expressway, Santa Clara, CA` resolves in one call to
`place_results.gps_coordinates`, 37.3726799 / -121.9678625, with no ambiguity to
resolve.

## What changed in the registry

`registry_version` 2026-08-28.1 to 2026-08-28.2.

| capability                      | change                                                  |
| ------------------------------- | ------------------------------------------------------- |
| `candidates.zillow.region`      | priced per page rather than as a flat 8                 |
| `budget.zillow.native`          | coverage 0.97 to 0.80, price bands                      |
| `unit_attribute.zillow.native`  | coverage 0.99 to 0.80, beds live inside `units[]`       |
| `listing_feature.zillow.native` | coverage 0.55 to 1.0, the filter is authoritative       |
| `nearby_poi.local.*`            | replaced by `nearby_poi.maps.*` on `google_maps:search` |
| `nearby_poi.maps.*`             | coverage 0.85 to 0.95, hours are structured             |

Priors are set so their product matches the measured 4,517 to 56. The split
between the three is provisional until each filter is recorded on its own, and
`selectivity_observed` will overwrite all of it once runs start.

## Still open

- Pagination parameter for Zillow past page 1. The filtered demo query fits in one
  page, so this is not on the demo path, but Watch over a wider box will need it.
- Whether `google_maps_directions` accepts `start_coords` as `lat,lng` in the form
  the registry template assumes. First thing to record on Saturday.
- Yelp and Google News are unrecorded. Both are on the cut list, so that is fine.
