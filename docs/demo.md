# Running the demo

## Before the day

**Warm the cache.** Answers expire. A question answered from the ledger costs
nothing and returns in seconds; the same question after its answers have aged out
costs a full run and takes about three minutes. Run the demo query once the
morning of, and check the spend afterwards:

```
pnpm ask "Under $2,800, one bedroom, no more than 25 minutes by bike to 2788 San Tomas Expressway, gym within half a mile open before 6am, in-unit laundry, grocery open past 10pm."
curl -s "https://serpapi.com/account?api_key=$SERPAPI_API_KEY" | jq .total_searches_left
```

**Know what a new question costs.** A tightly specified question spends about 40.
A loose one spends more, not less: "apartments close to San Jose State University"
matched 95 homes and measured a journey for every one of them, at 48 searches.
Nothing is being wasted there, but it is worth knowing before inviting anyone to
type whatever they like.

## The five minutes

1. **Ask the question.** Plain words, six requirements, five sources. The plan
   appears before any of it runs: four stages, what each will ask, and what it
   expects to be left with.

2. **The answer, not the machinery.** Three lists. What cleared everything, what
   could not be checked, and what was ruled out with the reason on it. Every fact
   carries the source that answered it and how old that answer is.

3. **The bucket that matters.** Open "couldn't verify". A rent quoted as a band
   settles nothing against a cap, so it is neither a pass nor a rejection. An
   error can never reject a home. This is the one thing a spreadsheet of scraped
   listings cannot do.

4. **Pick a home.** The map draws the journey the number was measured on, and
   names the far end of it. Not a straight line: the road.

5. **What one change would buy.** One minute more on the commute adds a home.
   Click it and the question re-runs with that bound moved.

6. **Keep asking.** Turn the watch on. It re-asks every night and reports what
   moved. The first answer cost a run; the next one costs almost nothing, because
   most of it is still known.

7. **The cost, last.** 18,179 searches to check every requirement against every
   listing. 88 planned. 39 actually made. `pnpm replay` proves it offline.

## If the network is against you

`pnpm replay` runs the whole thing from committed responses and touches nothing.
It prints the same buckets, the same rejections and the same numbers.
