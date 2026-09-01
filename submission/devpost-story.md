## Inspiration

I moved to a place I did not know, and I spent an evening doing the same thing over and over. Open a listing. Copy the address into Google Maps. Check the ride to work. Open another tab for the gym down the road to see when it opens. Go back. Realise I had lost track of which of the six places I liked actually had the laundry. Start again.

The frustrating part was not that the information was missing. It was that every piece of it existed, just never in the same place. The rental site knew the rent and had no idea how long the ride to work took. The routing engine knew the ride and had never heard of the apartment. The maps index knew the gym opened at five thirty and did not know I cared.

In a city you already know, you fill that gap with instinct. You know that commute is optimistic. You know that neighbourhood is dead after nine. Somewhere new you have none of that, and every listing looks equally plausible until you check it yourself.

So the question I wanted to answer was not "show me apartments". It was "show me the ones that actually work for me", and have something else do the checking.

## What it does

You ask in one sentence, the way you would ask someone who lives there:

"2 bed in San Jose under $3,500, 20 minutes by bike to work, gym open past 9pm"

Relokit turns that into typed constraints, works out the cheapest order to check them in, and then checks each one against whatever source actually holds the answer. The price comes from the listing. The ride comes from a routing engine, door to door, in the travel mode you asked for. The opening hours come from the maps index.

The answer comes back in three groups, and the third one is the point:

- **Verified**: every requirement met, each fact showing where it came from and how old it is.
- **Unconfirmed**: something could not be settled. A price quoted as a range settles nothing against a cap, so it is neither a pass nor a rejection, and the card says which fact and why.
- **Ruled out**: the one requirement that decided it, named on the card.

Nothing is ever ruled out because a check failed. That rule is enforced in code and pinned by tests: a listing is rejected only when a source actually answered and the answer did not meet the requirement. If the run degrades, verified places fall back to unconfirmed. They never become rejections. I watched that hold during a real backend failure mid demo, which is the moment I stopped worrying about it.

It works for twelve kinds of place, not just rentals: apartments, homes for sale, restaurants, cafes, bars, gyms, groceries, hotels, parks, pharmacies, schools and universities.

## How I built it

The core is a cost based query planner, the kind a database uses to decide join order, pointed at web APIs instead of tables.

Every source is described as a capability row: what constraint type it answers, what it costs in calls, what fraction of candidates it typically eliminates, how often it can answer at all, and at what granularity. Region level capabilities cover a whole search area in one call. Cluster level ones cover a neighbourhood. Entity level ones cost one call per listing and always run last.

The planner scores each candidate:

```
score = ((1 - selectivity_prior) * coverage) / (cost_units * entities_requiring_evaluation)
```

Then it orders the stages so the cheapest, most eliminating checks run first, and the expensive per listing calls only ever run on what survived. On the demo question, checking everything the naive way would take 13,662 calls. The plan does it in 76.

There are a few ideas underneath that I think are the interesting part:

**Free filters first.** Some constraints cost nothing because the provider already applies them inside a search you were making anyway. A price cap and a bedroom count are filters on the listing search itself. Running those first shrinks the candidate set before a single paid call happens.

**Geometry before network.** A straight line distance is a hard lower bound on a real journey. If the crow flies further than your time limit allows, no route will fit, and the listing is ruled out with no call at all and no guessing.

**Clusters before listings.** Listings near each other have nearly the same commute. Measuring one point per cluster, with slack so a listing is only ruled out when even the nearest corner of its cell fails, replaces dozens of per listing calls.

**A ledger, not a cache.** Every fact is stored per fact with the expiry the source deserves, not per run. A price is good for two days. Opening hours are good for a month. The next question about the same listing does not pay for what the last one already learned. Repeat questions now cost nothing.

**Xano is the backend, and it holds the money.** Every metered call goes through one Xano function that checks the ledger, checks the provider cache, enforces a hard per run spend ceiling, then calls out and records what it did as an append only row. The browser never holds an API key. A public URL cannot be used to burn my credits, because the ceiling is enforced server side.

**Work is queued, not held open.** A run used to hold a connection open for every call while a third party thought about it, and the requests themselves became the load. Now a whole stage is handed over in one request and short polls work it off. Attempts are recorded before anything executes, so a call that outlives its poll is finished by the next one instead of being lost.

The frontend is React and TypeScript with a MapLibre map that draws the actual route the number was measured on, not a straight line. Results stream in as each stage finishes, so cards appear early instead of leaving you at a blank screen.

Stack: TypeScript across eight packages, React and Vite, Xano for the backend with 16 tables, 27 endpoints and 4 shared functions, SerpApi for seven engines, 421 tests.

## Why not just ask an LLM with web search?

This is the first question anyone asks, so here is the honest answer.

Relokit is not a language model given live data. It is close to the opposite.
The model is called once, at the start, and it does one job: read your sentence
and say which phrase is a budget, which is a commute, which is an opening time.
It never sees a listing, never sees a search result, and never decides whether
anything passes. Even its own numbers are not trusted. Every number is re-read
from the words you actually wrote, because the model once read "open past 10pm"
as thirty six thousand seconds, which is ten in the morning, and filed it as an
opening time rather than a closing one. The planner, the executor and the
verdicts never touch a model at all.

So the model understands the question, and ordinary tested code answers it.
That split is the design, and it is there for four reasons.

**The work is combinatorial and a model will not do it.** Six requirements
across ninety listings is 13,662 calls done the naive way. The planner gets it
to 76 by ordering the work: filters the provider already applies for free,
then geometry, because a straight line is a hard lower bound on a real journey
and rules places out for no calls at all, then one call per neighbourhood, then
one call per listing only for what survived. An agent looping over tools has no
cost model. It makes a handful of calls and asserts the rest.

**A model cannot tell you what it failed to check.** It produces one confident
narrative. It has no way to say "for this listing the price is quoted as a range,
so it settles nothing against your cap, and that is the one fact I could not
get". Relokit can, because it tracks per listing and per requirement whether a
source actually answered. The three buckets are a data structure, not a
prompting trick.

**Every fact carries its source and its age.** You can follow any of them back.
A generated answer is a blend of whatever was in the context window.

**The same question gives the same answer.** Same plan, same identifier, same
result. That matters when the decision is a lease.

Where a model with search is genuinely better: one fact, asked once. What time
does this gym close. It will beat this comfortably. The moment it becomes many
places times many requirements, and being wrong costs you a year of rent,
guessing quietly stops being acceptable, and that is the part this is built for.

## Challenges I ran into

**Retrying a metered call spends twice.** I assumed a repeated call would be free because the first attempt would have filled the cache. Then I measured it: 46 planned calls spent 50 real searches. When a gateway gives up after the provider has already answered, the money is gone and the cache write never happened, so asking again pays again. Free calls now retry patiently with jitter. Metered ones are asked exactly once, whatever else the run does, and a failed one is reported as unchecked rather than quietly repeated.

**Two optimisers can each be right and still be wrong together.** A question about a ten minute bike ride came back with nothing verified and no mention of the ride anywhere. The planner had decided the cluster stage settled the constraint, so it never scheduled per listing calls. The executor then decided the cluster stage did not pay for itself and skipped it. Each decision was correct on its own, and together they dropped the requirement silently. The rule now is that an optimisation may only ever remove cost, never remove an answer, and any requirement left unreached leaves a row on every listing explaining why.

**Xano requests are not transactions.** I did not want to guess at this, so I built a probe endpoint that writes a row and then deliberately fails a precondition. The write survives. That single measured fact is what makes the queue safe, because a poll that dies still counted its attempt, so a poisoned job gets passed over after two strikes instead of looping forever.

**The slowest thing in the product was one query I wrote.** A repeat question that spent nothing still took five minutes and twelve seconds. The 502s on the live site were the tail of it, calls drifting past the gateway's patience. The cause was the check for facts already known: it asked for every unexpired evidence row the account owned, 18,637 of them, then sifted them one conditional at a time to find the two the call was about. Roughly four seconds on every call that named a listing, and worse every day as the ledger grew. Moving those two conditions into the where clause, where an index answers them, took the same question from 312 seconds to 16.

**A listing with no photograph.** Cards showed broken images for some homes. The listing had no photo of its own, so what came back was a signed static map, and the signature was for the site that made it. Requested from my page it answered 403. Requested without a referrer it answers fine.

## Accomplishments that I am proud of

The three buckets. It would have been much easier to show a ranked list and let people assume the ranking meant something. Reporting "I could not confirm this, and here is which fact" is harder to build and harder to sell, and it is the only version of this I would actually trust when deciding where to live.

The honesty survives failure. When the backend faltered mid run, verified listings became unconfirmed and the rejections stayed exactly the same. Degradation costs certainty, never a wrong answer.

And the planner is not decoration. 13,662 calls down to 76 is the difference between a demo and something that could run for real people.

## What I learned

Measure, do not reason. I was wrong three times in a row about things I was confident about: that retries were free, that the cache lookups were slow because of a missing index, that the images were blocked by an ad blocker. Every one of those was settled by a measurement that took ten minutes and pointed somewhere else.

The second thing is about honesty as a product decision rather than an engineering one. Once you allow yourself to say "unconfirmed", a lot of hard problems become easy, because you are no longer forced to invent an answer to keep the interface tidy.

## What is next

Learned priors are already in: every run records what each source actually did, and the planner uses measured numbers in a place it has seen before, falls back to what it has measured everywhere, and otherwise says plainly that the number is an estimate. It is honest about which of the three it is using. What it needs now is more runs in more cities to be worth much.

After that: saved comparisons between places, and support for more of the world than the sources currently cover well.

## Build story, for the Xano challenge

**What software did I replace?** The apartment and place search sites, and more precisely the evening of manual cross checking they force on you. Zillow knows the rent. Google Maps knows the ride. Yelp knows the hours. None of them will answer one question, so you become the integration layer, with fifteen tabs open and a notes file.

**Why did I choose it?** Because I had just done it myself and it was miserable, and because the failure is structural rather than lazy. No single company owns the answer to a multi part question about a place, so no single company can fix it. That is exactly the shape of problem an API layer should solve.

**Which AI tools did I use?** Claude Code, for the whole build.

**How long did it take?** Five days, from the first commit on 28 August to submission, 144 commits.

**What would have taken significantly longer without AI and Xano?** The backend. 16 tables, 27 endpoints and 4 shared functions, including a job queue, a per fact caching ledger with real expiry, a server enforced spend ceiling, and the append only accounting that makes the ledger safe under concurrent writes. Building and hosting that by hand would have taken most of the five days on its own, and the planner would never have been written. Xano's CLI mattered more than I expected: the backend lives in the repository as files, so it reviews and versions like the rest of the code instead of being clicked together in a console and forgotten.
