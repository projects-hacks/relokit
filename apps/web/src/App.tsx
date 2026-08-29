import type { AskEvent } from '@relokit/client'
import { useAsk } from './useAsk.ts'
import { Ask } from './panels/Ask.tsx'
import { Plan } from './panels/Plan.tsx'
import { Ledger } from './panels/Ledger.tsx'
import { Counter } from './panels/Counter.tsx'
import { Brief } from './panels/Brief.tsx'
import { Findings } from './findings/Findings.tsx'
import { Offers } from './findings/Offers.tsx'
import { Map } from './map/Map.tsx'

export function App() {
  const { status, events, result, error, run, configured } = useAsk()
  const planned = events.find(
    (event): event is Extract<AskEvent, { kind: 'planned' }> => event.kind === 'planned',
  )
  const plan = planned?.plan ?? null

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">
          Relo<span>kit</span>
        </h1>
        <p className="strapline">
          Every requirement checked against the place that actually holds the answer
        </p>
        {result && (
          <div className="ledger-inline">
            <span>
              spent <b>{result.cost.actual_units}</b>
            </span>
            <span>
              instead of <b>{result.cost.naive_units.toLocaleString()}</b>
            </span>
          </div>
        )}
      </header>

      <div className="columns">
        <aside className="rail">
          <Ask onAsk={run} busy={status === 'running'} />
          {!configured && (
            <p className="note">
              No backend is configured. Set VITE_RELOKIT_API and VITE_RELOKIT_ORG_KEY, then reload.
            </p>
          )}
          <Plan plan={plan} events={events} />
          {result && <Ledger result={result} />}
        </aside>

        <main className="stage">
          <Map plan={plan} result={result} />
          <Counter events={events} />
        </main>

        <section className="paper">
          {status === 'idle' && <Brief />}

          {status === 'running' && !result && (
            <div className="pending">
              <span className="pulse" />
              {describe(events)}
            </div>
          )}

          {status === 'failed' && (
            <div className="failure">
              <p className="eyebrow">The run stopped</p>
              <p className="note">{error}</p>
            </div>
          )}

          {result && (
            <>
              <Findings result={result} />
              <Offers result={result} />
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/** Says what is happening now, in the same words the plan used. */
function describe(events: AskEvent[]): string {
  const last = events[events.length - 1]
  if (!last) return 'Reading your requirements'
  if (last.kind === 'parsed')
    return `Understood ${last.constraint_set.constraints.length} requirements`
  if (last.kind === 'planned') return 'Working out the cheapest order to check them'
  if (last.kind === 'accepted') return 'Checking'
  if (last.kind === 'stage') return `${last.entities_out} still standing`
  return 'Checking'
}
