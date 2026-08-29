# Working notes on Xano

Things that cost time, so they only cost it once. Each was found by running
something rather than by reading, and several contradict the documentation.

## A push validates the script, not the run

`xano workspace push` parses XanoScript and will reject bad syntax, but it does
not check that a filter exists. `|hash_sha256` pushed cleanly, survived a pull,
and failed at runtime with `Unable to locate func entry`. Treat a successful push
as a spell check.

## sha256 takes an argument, and the reference has it backwards

The filter reference says `"data"|sha256:true` returns hex. It returns raw bytes,
which Postgres refuses with `CHARACTER NOT IN REPERTOIRE`.

Bare `|sha256` and `|sha256:false` both return hex, and it matches what Node
produces for the same input:

```
"relokit"|sha256  ->  6a4f129e65e66e0a6d99a7dcb1ebf9d9f38548f8fc1052971b6588ec349ed0e5
```

That agreement is what lets the seeder hash a key locally and the backend
recognise it.

## $request_auth_token is not a header reader

It is Xano's own token format, and it tries to decode whatever it is handed. Sent
six characters it returns six; sent twenty it returns nothing at all; sent a
sixty four character key it returns sixty three characters.

So an API key does not travel in an Authorization header here. Relokit takes it
as an input field, which is plain, and over HTTPS a body is no more exposed than
a header.

A user defined environment variable is read with one dollar: `$env.relokit_admin_key`.
The doubled form is for Xano's own built-ins.

## Reading a key an object does not have is an error

`$capability.selectivity_observed` raises `Unable to locate var` when the key is
absent, rather than answering null. Anything optional has to be read with a
default: `$capability|get:"selectivity_observed":null`.

## db.add data will not take a variable

`data = $row` fails with `Invalid kind for data`. It must be an object literal, so
every column is written out. That turned out to be the better shape anyway: a key
the seed grows by accident cannot quietly land in a table.

## What api.request returns

```
{ request:  { url, method, headers, params }
  response: { status, result, headers } }
```

`response.result` is the parsed body and `response.status` is the HTTP status.
The documentation shows how to make a call and not how to read one.

## The included model is reached through an agent

There is no plain "call an LLM" statement. Xano's own key is exposed through
`llm = { type: "xano-free" }` on an agent, invoked with `ai.agent.run`, which
answers `{finishReason, providerMetadata, reasoningDetails, result}`. The text is
`result`.

Those credits are documented as development credits that do not reset once used,
so Relokit caches parse answers and falls through to a paid provider when nothing
comes back.

## The sandbox cannot serve traffic

`xano sandbox get -o json` reports `ingress: false` and `tasks: false`. It
validates a push and creates tables, and it cannot answer an HTTP request or run
a background task. Direct workspace push is the setting that matters, under
Workspace Settings, CLI.

## Ordering became part of a cache key, invisibly

The call identity was `sha256(endpoint + json_encode(params))`. `json_encode`
preserves insertion order, so the same call written two ways hashed two ways. The
cache was warmed with `engine` written last and the executor asked with `engine`
written first, nothing matched, and thirty eight searches were spent proving it.

The key is now built from sorted parameter names in `Relokit/params_hash`, which
both the executor and the warmer call, so there is one definition of what makes
two calls the same. The property is checkable directly: warm the same parameters
in two orders and the second reports `warmed: false`.

## Other things that bite

A query parameter arrives as text. `db.get` on an int column with one fails with
`Not numeric.`, which names the symptom and not the cause. Use `|to_int`.

A counter incremented inside nested conditionals inside a `foreach` stops being
numeric. Totals that matter are kept on a row and updated as they change, rather
than recomputed by walking rows in a stack.
