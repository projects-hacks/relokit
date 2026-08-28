# Relokit

A cost-based query planner over walled gardens.

Relocation questions span data that no single site owns. Price and bedrooms live at
Zillow, commute time at Google Maps, gym hours at Google Local, groceries at Yelp.
Relokit takes one plain-language question, types it into constraints, orders those
constraints by how much they prune per API call, and evaluates them at the cheapest
granularity that can settle each one.

## Setup

```
corepack enable
pnpm install
pnpm test
```

Tests run offline against committed fixtures. No API keys required.

## Layout

| path | purpose |
| --- | --- |
| `packages/schema` | Shared contracts. Every other package depends on this one. |
| `packages/planner` | Pure planner. Constraints and a capability registry in, an execution plan out. |
| `packages/serpapi` | Typed SerpApi client with fixture record and replay. |
| `xano/` | Capability registry seed and table definitions. |
| `fixtures/serpapi/` | Recorded provider responses, redacted and committed. |

## Scripts

| command | does |
| --- | --- |
| `pnpm test` | Runs the suite offline. |
| `pnpm typecheck` | Typechecks every package in one pass. |
| `pnpm format` | Prettier. |
