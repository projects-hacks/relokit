# Relokit

A cost-based query planner over walled gardens.

Relocation questions span data no single site owns. Price and bedrooms belong to
Zillow, commute time to Google Maps, gym hours to Google Local, groceries to Yelp.
Every one of those filters covers only the facts its owner holds, and the
constraint you actually care about is usually in someone else's database.

Relokit takes one plain-language question, types it into constraints, orders those
constraints by how many candidates each removes per API call, and evaluates each
one at the cheapest granularity that can settle it. Every fact it reports carries
a source, a timestamp and an expiry.

For the demo query that is **60 searches instead of 18,179**.

## Try it

```
corepack enable
pnpm install
pnpm test
```

No API keys required. Tests replay from committed fixtures and never reach the
network.

```
pnpm plan       # print the plan and the cost trace for the demo query
pnpm dev:web    # the plan trace, cost bars, search box and cluster grid
```

## The question it answers

> Under $2,800, one bedroom, no more than 25 minutes by bike to 2788 San Tomas
> Expressway, gym within half a mile open before 6am, in-unit laundry, grocery
> open past 10pm.

Six constraints across five sources. Zillow can answer three of them.

## How it works

```
plain language
    |  one LLM call, constrained JSON
typed constraint set
    |  registry lookup and cost ordering, pure code
staged execution plan
    |  Xano function stacks calling SerpApi
evidence rows with provenance and TTL
    |  SQL
verified, unverified and rejected
```

The language model appears twice: once to type the question, once to write a
sentence per result. Everything between is deterministic, which is what makes the
plan reproducible, cheap to reason about and safe to run live.

### Ordering

Capabilities compete to answer a constraint. The winner removes the most
candidates per call:

```
score = ((1 - selectivity_prior) * coverage) / (cost_units * entities_to_evaluate)
```

Execution runs free predicates first, then region, then cluster, then entity.
The per-entity tier is the only one that scales with the candidate count, so it
runs last against the smallest set that is still correct.

For the San Jose query that means Zillow's own filters take 4,517 rentals to 58
for nothing, twelve cluster centroids settle the commute and the amenities, and
only the survivors get an exact door-to-door route.

### Three buckets, not two

| bucket     | rule                                                    |
| ---------- | ------------------------------------------------------- |
| verified   | every hard constraint passed and was actually evaluated |
| unverified | something could not be checked                          |
| rejected   | something was checked and failed                        |

An error can never reject a listing. If a provider fails, the entity moves to
unverified with the reason attached, because "we could not check" and "it does
not qualify" are different answers and conflating them is how a tool starts
lying.

A price like `$2,495+` on a multi-unit building is the common case, not an edge
case, and it settles nothing against a $2,800 cap. Those go to unverified with
the band shown, never to a guess.

### Adding a source is a row, not a deploy

`xano/registry.seed.json` holds one row per capability: which source answers which
constraint, at what granularity, cost, TTL, coverage and precedence. The planner
reads it as data. Pointing the same engine at a different vertical is a registry
change.

## Layout

| path                   | purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `packages/schema`      | Frozen contracts. Everything depends on this and it depends on nothing. |
| `packages/planner`     | The planner. Pure, synchronous, one dependency, no I/O.                 |
| `packages/serpapi`     | Typed client with fixture record and replay.                            |
| `packages/mcp`         | MCP server. `relokit_plan` runs locally and costs nothing.              |
| `apps/web`             | Plan trace, cost trace, map.                                            |
| `tools/record-fixture` | The only thing that can spend a SerpApi search.                         |
| `xano/`                | Registry seed and table definitions.                                    |
| `docs/`                | Contracts, cost model, provider findings.                               |

Start with [docs/contracts.md](docs/contracts.md) for the wire format,
[docs/cost-model.md](docs/cost-model.md) for the arithmetic, and
[docs/smoke-test-2026-08-28.md](docs/smoke-test-2026-08-28.md) for what the
providers actually return.

## Fixtures

Recorded responses live in `fixtures/serpapi`, redacted and committed, so the
whole repo works offline.

```
pnpm record san-jose-1bed
```

That spends a real search. Replay is the default everywhere else, and a fixture
miss throws with the command to record it rather than quietly falling through to
the network.

## Scripts

| command                  | does                                    |
| ------------------------ | --------------------------------------- |
| `pnpm test`              | Full suite, offline.                    |
| `pnpm typecheck`         | Every package in one pass.              |
| `pnpm plan`              | Plan and cost trace for the demo query. |
| `pnpm dev:web`           | Web app on port 5173.                   |
| `pnpm record <scenario>` | Records a fixture. Spends a search.     |

## MCP

```json
{
  "mcpServers": {
    "relokit": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/relokit/packages/mcp/src/index.ts"]
    }
  }
}
```

`relokit_plan` returns a full plan with its cost trace without making a single
API call, so an agent can find out what a question costs before answering it.
