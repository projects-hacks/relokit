import { useEffect, useState } from 'react'
import type { AskEvent } from '@relokit/client'
import { applyRelaxation } from '@relokit/evidence'
import { useAsk } from './useAsk.ts'
import { useDeferred } from './lib/deferred.ts'
import { useSaved } from './lib/saved.ts'
import { Toast, useToast } from './lib/toast.tsx'
import { ago, money } from './lib/format.ts'
import { Ask } from './panels/Ask.tsx'
import { Plan } from './panels/Plan.tsx'
import { Ledger } from './panels/Ledger.tsx'
import { Counter } from './panels/Counter.tsx'
import { Working } from './panels/Working.tsx'
import { Brief } from './panels/Brief.tsx'
import { Watch } from './panels/Watch.tsx'
import { Findings } from './findings/Findings.tsx'
import { Detail } from './findings/Detail.tsx'
import { Nothing } from './findings/Nothing.tsx'
import { FindingsSkeleton } from './findings/Skeleton.tsx'
import { Offers } from './findings/Offers.tsx'
import { Map } from './map/Map.tsx'

export function App() {
  const { status, events, result, error, restored, run, dismiss, configured } = useAsk()
  const [openId, setOpenId] = useState<string | null>(null)
  // Selecting shows a home on the map. Opening covers the map, so it is a
  // separate act rather than the same click doing both.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // Whether the pointer is over the map or the list, the same home is lit in
  // both. Pointing at a pin should not mean hunting for its card.
  const [fromMap, setFromMap] = useState(false)
  const saved = useSaved(result?.constraint_set.raw_query ?? '')
  const working = useDeferred(status === 'running' && !result)
  const notice = useToast()
  // On a phone the answer comes first and the map is asked for. Above that it
  // is always open and the control is not rendered at all.
  const [mapShut, setMapShut] = useState(true)
  // The end of the run is as much a thing to be told as the middle of it.
  const progress =
    status === 'running'
      ? describe(events)
      : result
        ? `${result.buckets.results.length} of ${result.entities.length} homes cleared every requirement`
        : status === 'failed'
          ? `The run stopped: ${error ?? 'no reason given'}`
          : ''

  const planned = events.find(
    (event): event is Extract<AskEvent, { kind: 'planned' }> => event.kind === 'planned',
  )
  // A restored run carries no events, so the plan comes off the result instead.
  // Without this the map never fits its bounds and sits on a hardcoded centre.
  const plan = planned?.plan ?? result?.plan ?? null
  useEffect(() => {
    if (!fromMap || !hoveredId) return
    document
      .querySelector(`[data-entity="${CSS.escape(hoveredId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [fromMap, hoveredId])

  const open = openId ? result?.entities.find((e) => e.entity_id === openId) : undefined
  const openEvidence =
    result && openId
      ? [
          ...result.buckets.results,
          ...result.buckets.unverified,
          ...result.buckets.rejections,
        ].find((entry) => entry.entity_id === openId)?.evidence
      : undefined

  return (
    <div className="shell" data-answered={String(Boolean(result))}>
      {/* One region, present from the start, so a reader is told how the run is
          going rather than left with a page that silently rearranges itself. */}
      <div className="sr-only" role="status" aria-live="polite">
        {progress}
      </div>

      <a className="skip" href="#results">
        Skip to results
      </a>

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
              <b>{result.buckets.results.length}</b>{' '}
              {result.constraint_set.constraints.some((c) => c.hardness === 'hard')
                ? 'verified'
                : 'found'}
            </span>
            <span>
              <b>{result.entities.length}</b> looked at
            </span>
            {saved.homes.length > 0 && (
              <span>
                <b>{saved.homes.length}</b> saved
              </span>
            )}
          </div>
        )}
      </header>

      <div className="columns">
        <aside className="rail">
          <Ask onAsk={run} busy={status === 'running'} configured={configured} />
          {!configured && (
            <p className="note">
              No backend is configured. Set VITE_RELOKIT_API and VITE_RELOKIT_ORG_KEY, then reload.
            </p>
          )}
          <Plan plan={plan} events={events} />
        </aside>

        <main className="stage" data-shut={String(mapShut)}>
          <button
            className="stage-toggle"
            onClick={() => setMapShut((current) => !current)}
            aria-expanded={!mapShut}
          >
            {mapShut ? 'Show the map' : 'Hide the map'}
          </button>
          <Map
            shut={mapShut}
            plan={plan}
            result={result}
            selected={selectedId}
            hovered={hoveredId}
            onSelect={setSelectedId}
            onHover={(id) => {
              setFromMap(id !== null)
              setHoveredId(id)
            }}
            onOpen={setOpenId}
          />
          <Counter events={events} />
        </main>

        <section className="paper" id="results">
          {status === 'idle' && saved.homes.length === 0 && <Brief />}

          {status === 'idle' && saved.homes.length > 0 && (
            <section>
              <p className="eyebrow">Kept for later</p>
              <div className="saved-strip">
                {saved.homes.map((home) => (
                  <a
                    className="saved-card"
                    key={home.entity_id}
                    href={home.url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {home.photo_url && (
                      <img
                        src={home.photo_url}
                        alt=""
                        width={96}
                        height={64}
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                    <span>
                      <b>{money(home.price_cents) ?? '—'}</b>
                      <br />
                      {home.title.slice(0, 48)}
                    </span>
                  </a>
                ))}
              </div>
              <button
                className="as-link"
                onClick={() => {
                  const restore = saved.clear()
                  notice.show('Shortlist cleared.', restore)
                }}
              >
                Clear the shortlist
              </button>
            </section>
          )}

          {working && (
            <>
              <p className="pending">{progress}</p>
              <FindingsSkeleton />
            </>
          )}

          {status === 'failed' && (
            <div className="failure">
              <p className="eyebrow">The run stopped</p>
              <p className="note">{error}</p>
            </div>
          )}

          {restored && (
            <div className="restored">
              <span>
                Showing what you asked {ago(restored.at)}: “{restored.query.slice(0, 54)}
                {restored.query.length > 54 ? '…' : ''}”
              </span>
              <button onClick={dismiss}>Clear</button>
            </div>
          )}

          {result && result.problems.length > 0 && result.entities.length > 0 && (
            <p className="note partial">
              {result.problems.length} {result.problems.length === 1 ? 'call' : 'calls'} did not
              happen, so some homes were checked less thoroughly than others.
            </p>
          )}

          {result && !working && (
            <>
              {result.entities.length === 0 ? (
                <Nothing result={result} />
              ) : (
                <Findings
                  result={result}
                  isSaved={saved.isSaved}
                  onSave={(home) => {
                    notice.show(saved.isSaved(home.entity_id) ? 'Removed.' : 'Saved.')
                    saved.toggle(home)
                  }}
                  onOpen={setOpenId}
                  onSelect={setSelectedId}
                  onHover={(id) => {
                    setFromMap(false)
                    setHoveredId(id)
                  }}
                  selected={selectedId}
                  hovered={hoveredId}
                />
              )}
              <Offers
                result={result}
                onRelax={(constraintId, to) => {
                  // Asking again with one bound moved. Only that bound changes,
                  // and it is marked as ours so the interface can say the
                  // number stopped being theirs.
                  run(result.constraint_set.raw_query, {
                    ...result.constraint_set,
                    constraints: applyRelaxation(
                      result.constraint_set.constraints,
                      constraintId,
                      to,
                    ),
                  })
                }}
              />
              <Watch result={result} />
              <Working result={result} />
              <Ledger result={result} />
            </>
          )}
        </section>
      </div>

      <Toast toast={notice.toast} onDismiss={notice.dismiss} />

      {open && openEvidence && result && (
        <Detail
          entity={open}
          evidence={openEvidence}
          result={result}
          saved={saved.isSaved(open.entity_id)}
          onSave={() => saved.toggle(open)}
          onClose={() => setOpenId(null)}
        />
      )}
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
