# Making it a search engine rather than a rental tool

## What was already general

The planner, the cost ordering, the feasibility fixpoint, the three buckets,
provenance and TTL, the ledger, proximity and area intersection, the geometric
bounds, and opening hours. None of it knows what a home is.

## What was not

| | |
| --- | --- |
| One candidate source | Zillow alone could produce results; everything else answers questions about them |
| No subject | The question said where to look, never what to look for |
| Rental shaped entity | `beds`, `baths`, `price_cents` on the core type |
| Three rental constraints | `budget`, `unit_attribute`, `listing_feature` |

## Decisions

**Subject is explicit.** `ConstraintSet.subject` says what is being looked for.
Candidate sources declare which subjects they can produce, and selection filters
on it before cost ordering. Adding a source for an existing subject stays a
registry row. A new subject is a row and one enum value.

**One entity, open attributes.** A result carries a title, a point, a link,
photos and a price. Everything else is `attributes`, a flat record the mappers
fill and the interface renders through a table of known keys. Bedrooms and star
ratings are the same kind of thing to everything between.

**Constraints name what they constrain.** `budget` becomes `price` with a basis,
`unit_attribute` becomes `attribute` with a key, `listing_feature` becomes
`feature` with a key. One type each instead of one per vertical.

**Phone first.** The layout is written for a phone and widened at breakpoints
rather than the reverse, because that is where this is used.

**Installable.** A manifest and a service worker, so it can be added to a home
screen and opens without a browser around it.

## What adding a vertical costs

1. A subject value.
2. A candidate source row in the registry.
3. A mapper turning that provider's response into entities.
4. Attribute renderers for anything new worth showing.

No change to the planner, the executor, the cost model or the evidence rules.
