import { useCallback, useEffect, useState } from 'react'
import {
  httpTransport,
  readWatch,
  setWatch,
  type AskResult,
  type WatchState,
} from '@relokit/client'
import type { Place } from '@relokit/schema'
import { ago, money } from '../lib/format.ts'

const api = import.meta.env.VITE_RELOKIT_API ?? ''
const orgKey = import.meta.env.VITE_RELOKIT_ORG_KEY ?? ''

/**
 * Keep asking, and say what moved.
 *
 * The market answers whether or not anyone is looking, and the reason this is
 * worth doing rather than just re-running by hand is the number underneath: the
 * answers are mostly still good, so asking again costs a fraction of asking the
 * first time.
 */
export function Watch({ result }: { result: AskResult }) {
  const [state, setState] = useState<WatchState | null>(null)
  const [busy, setBusy] = useState(false)
  const transport = httpTransport(api, orgKey)

  const load = useCallback(async () => {
    try {
      setState(await readWatch(transport, result.run_id))
    } catch {
      // A question nobody has watched has nothing to report, which is not a
      // failure worth putting on screen.
      setState(null)
    }
  }, [result.run_id])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async () => {
    setBusy(true)
    try {
      await setWatch(
        transport,
        result.run_id,
        result.constraint_set.raw_query.slice(0, 60),
        !state?.watching,
      )
      await load()
    } finally {
      setBusy(false)
    }
  }

  const changes = state?.changes ?? []

  return (
    <section className="watch">
      <div className="watch-head">
        <div>
          <p className="eyebrow">Keep asking</p>
          <p className="note">
            {!state?.watching
              ? 'The market changes whether or not you are looking.'
              : state.asked_at
                ? `Asked again every night. Last asked ${ago(state.asked_at)}.`
                : 'Asked again every night. You will see what moved here.'}
          </p>
        </div>
        <button
          className={state?.watching ? 'watching' : 'watch-on'}
          onClick={toggle}
          disabled={busy}
          aria-pressed={Boolean(state?.watching)}
        >
          {state?.watching ? 'Watching' : 'Watch this search'}
        </button>
      </div>

      {state && state.re_asked > 0 && (
        <p className="note watch-cost">
          Asked again {state.re_asked === 1 ? 'once' : `${state.re_asked} times`}. The first answer
          took <b>{state.first_cost}</b> {state.first_cost === 1 ? 'search' : 'searches'}; the last
          took <b>{state.last_cost ?? 0}</b>, because most of it was already known.
        </p>
      )}

      {state?.watching && changes.length === 0 && state.re_asked > 0 && (
        <p className="note">Nothing moved. Which is an answer, not a blank.</p>
      )}

      {changes.length > 0 && (
        <ul className="changes">
          {changes.slice(0, 8).map((change, index) => (
            <li key={index} data-kind={change.change_type}>
              {describe(change, result.entities)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The watch records a home by the id the provider gave it. A listing split into
 * one entry per bedroom count carries that id with the count appended, so the
 * title is found by what the two share.
 */
function describe(change: Change, entities: Place[]): string {
  const home = entities.find(
    (entity) =>
      entity.entity_id === change.entity_id || entity.entity_id.startsWith(`${change.entity_id}#`),
  )
  const name = home ? home.title.slice(0, 44) : 'A home'

  if (change.change_type === 'entered_pass') {
    const price = money(change.after?.price ? change.after.price * 100 : null)
    return `${name} came on the market${price ? ` at ${price}` : ''}.`
  }
  if (change.change_type === 'left_pass') return `${name} is no longer listed.`

  const was = money(change.before?.price ? change.before.price * 100 : null)
  const now = money(change.after?.price ? change.after.price * 100 : null)
  return `${name} moved from ${was ?? 'an unstated rent'} to ${now ?? 'an unstated rent'}.`
}

type Change = WatchState['changes'][number]
