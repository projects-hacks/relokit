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

A fourth form turned up once the parser met the whole sample: when both ends
share a meridiem Google drops it from the opening time, so `"6–11 AM"` is six in
the morning until eleven and `"4–8:30 PM"` is the afternoon. Seven strings in one
sample of twenty gyms take that shape. Reading them as unparsed would have lost
the constraint quietly rather than loudly.

`nearby_poi` coverage is raised to 0.95.

## 6. Directions takes an integer for the mode

`travel_mode` is not a word. It is `0` driving, `1` cycling, `2` walking, `3`
transit. The registry was sending `"bike"`, which the engine accepts without
complaint and answers as driving. Every commute verdict in the demo would have
been wrong, and wrong in the direction that makes listings look closer than they
are.

Fixed by a derived constraint field, `travel_mode_code`. See the resolver
contract in [contracts.md](contracts.md).

`start_coords` and `end_coords` do take `"lat,lng"`, as the templates assumed.

## 7. Directions returns alternatives, and the first is not the fastest

From the Lynhaven building to the office:

```json
[
  {
    "travel_mode": "Cycling",
    "duration": 2026,
    "formatted_duration": "34 min",
    "via": "S Monroe St"
  },
  {
    "travel_mode": "Cycling",
    "duration": 1821,
    "formatted_duration": "30 min",
    "via": "San Tomas Aquino Creek Trail"
  }
]
```

Taking `directions[0]` would report 34 minutes for a place you can reach in 30.
On a 25 minute constraint that is the difference between a rejection and a near
miss, and the rejection list is where a judge decides whether to trust the thing.

**The verdict takes the minimum duration across the returned routes for the
requested mode.** The question is "can I get there in 25 minutes", so any route
that achieves it answers yes.

`duration` is already in seconds and `distance` in meters, so both go straight
into `value_canonical` with no conversion.

A `durations` array also comes back with one entry per mode, free, in the same
call. Worth knowing if a second commute constraint in a different mode ever
appears: it is answerable without a second call.

## 8. Pagination works and page counts are not knowable in advance

`page=2` returns 41 listings with zero overlap against page 1, and every response
carries `total_pages` plus a `serpapi_pagination.next` link.

Which means the plan cannot say how many pages there are. It was emitting a fixed
number of page ops from an estimate, which spends a call on a page that may not
exist. The candidates stage now emits one op and a **page budget**: the executor
repeats it while the response reports more pages, up to the capability's
`max_fanout`. Stage fanout `paged` says so explicitly.

`total_results` also drifted between the two calls, 4,517 then 4,495. Live
inventory moves under you, which is another reason the plan states a budget and
the run reports what it actually spent.

## 9. The news query was reading a field that does not exist

`area_signal.news.region` was enabled and had never been called. Its template
asked for `$stage.bounds.region_name`, and the bounding box is arithmetic over a
coordinate: it has no name and never could.

The region name comes from the candidate search, at
`search_information.region.name`, which for this query is "San Jose CA 95110".
So the news capability now reads `$stage.candidates.region_name` and cannot run
until listings have been found. The access pattern check catches it either way,
which is what it is for.

Google News itself takes a plain `q` and returns 100 results with `iso_date` on
every one, which is what `lookback_days` needs. No location parameter.

## 10. Geocoding is clean

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
the observation rows written by later runs stand in for all of it once a
capability has ten decisive answers.

## Still open

- Yelp is unrecorded and disabled in the registry. It answers the same question
  as Google Local at lower coverage and is first on the cut list, so it stays off
  until something needs it.
- Maps Reviews is unrecorded and disabled. It exists to confirm opening hours
  when Google Local returns a string we cannot parse, and structured
  `operating_hours` turned out to be present on every result, so it may never be
  needed.

Nothing enabled in the registry is now unverified.
